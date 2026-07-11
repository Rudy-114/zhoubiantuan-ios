import { query } from "../db.js";
import { enqueueSafetyJob } from "./jobQueue.js";

const REPORT_UPLOAD_KEY = /^report\/[^/]+\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+$/;

export function reportUploadKeyFromJob(job) {
  const objectKey = job?.payload?.objectKey;
  if (typeof objectKey !== "string" || objectKey.length > 512 ||
      objectKey.includes("..") || !REPORT_UPLOAD_KEY.test(objectKey)) {
    throw new Error("Cleanup report upload job payload is invalid");
  }
  return objectKey;
}

export async function isReportUploadReferenced(objectKey) {
  const safeObjectKey = reportUploadKeyFromJob({ payload: { objectKey } });
  const { rows } = await query(
    `SELECT EXISTS (
       SELECT 1 FROM safety_evidence WHERE object_keys @> ARRAY[$1]::text[]
     ) AS referenced`,
    [safeObjectKey]
  );
  return rows[0]?.referenced === true;
}

export async function registerReportUpload(client, { ownerUserID, objectKey, runAt, maxOutstanding, maxIssued24h }) {
  const safeObjectKey = reportUploadKeyFromJob({ payload: { objectKey } });
  if (safeObjectKey.split("/")[1] !== ownerUserID) throw new Error("Report upload owner does not match object key");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`report-upload-quota:${ownerUserID}`]);
  const issued = await client.query(
    `SELECT count(*)::int AS count
     FROM report_uploads
     WHERE owner_user_id = $1 AND created_at >= now() - interval '24 hours'`,
    [ownerUserID]
  );
  if (issued.rows[0].count >= maxIssued24h) throw reportUploadIssuanceExceeded();
  const outstanding = await client.query(
    `SELECT count(*)::int AS count
     FROM report_uploads
     WHERE owner_user_id = $1 AND state IN ('pending', 'deleting')`,
    [ownerUserID]
  );
  if (outstanding.rows[0].count >= maxOutstanding) throw reportUploadQuotaExceeded();
  await client.query(
    `INSERT INTO report_uploads (object_key, owner_user_id)
     VALUES ($1, $2)
     ON CONFLICT (object_key) DO NOTHING`,
    [safeObjectKey, ownerUserID]
  );
  return enqueueSafetyJob(client, {
    type: "cleanup_report_upload",
    uniqueKey: `cleanup_report_upload:${safeObjectKey}`,
    payload: { objectKey: safeObjectKey },
    maxAttempts: 5,
    runAt
  });
}

export async function cleanupRegisteredReportUpload(objectKey, { transaction, deleteObject }) {
  const safeObjectKey = reportUploadKeyFromJob({ payload: { objectKey } });
  const decision = await transaction((client) => beginReportUploadCleanup(client, safeObjectKey));
  if (decision !== "delete") return decision;

  try {
    await deleteObject(safeObjectKey);
  } catch (error) {
    await transaction((client) => recordReportUploadCleanupFailure(client, safeObjectKey));
    throw error;
  }

  await transaction((client) => markReportUploadDeleted(client, safeObjectKey));
  return "deleted";
}

export async function claimReportUploadsForAttachment(client, { ownerUserID, objectKeys }) {
  const keys = [...new Set(objectKeys || [])];
  if (!keys.length) return;

  const { rows } = await client.query(
    `SELECT object_key, owner_user_id, state
     FROM report_uploads
     WHERE object_key = ANY($1::text[])
     ORDER BY object_key
     FOR UPDATE`,
    [keys]
  );
  const byKey = new Map(rows.map((row) => [row.object_key, row]));
  for (const key of keys) {
    const upload = byKey.get(key);
    if (!upload || upload.owner_user_id !== ownerUserID || !["pending", "attached"].includes(upload.state)) {
      throw reportUploadUnavailable();
    }
  }

  await client.query(
    `UPDATE report_uploads
     SET state = 'attached', attached_at = COALESCE(attached_at, now()), updated_at = now()
     WHERE object_key = ANY($1::text[]) AND owner_user_id = $2 AND state = 'pending'`,
    [keys, ownerUserID]
  );
}

async function beginReportUploadCleanup(client, objectKey) {
  const { rows } = await client.query(
    `SELECT state
     FROM report_uploads
     WHERE object_key = $1
     FOR UPDATE`,
    [objectKey]
  );
  const upload = rows[0];
  if (!upload || upload.state === "attached") return "preserve";
  if (upload.state === "deleted") return "deleted";
  if (upload.state === "pending") {
    await client.query(
      `UPDATE report_uploads
       SET state = 'deleting', delete_started_at = now(), updated_at = now()
       WHERE object_key = $1`,
      [objectKey]
    );
  }
  return "delete";
}

async function recordReportUploadCleanupFailure(client, objectKey) {
  await client.query(
    `UPDATE report_uploads
     SET failure_count = failure_count + 1, last_failure_at = now(), updated_at = now()
     WHERE object_key = $1 AND state = 'deleting'`,
    [objectKey]
  );
}

async function markReportUploadDeleted(client, objectKey) {
  await client.query(
    `UPDATE report_uploads
     SET state = 'deleted', deleted_at = now(), updated_at = now()
     WHERE object_key = $1 AND state = 'deleting'`,
    [objectKey]
  );
}

function reportUploadUnavailable() {
  const error = new Error("上传证据已失效，请重新上传");
  error.status = 409;
  error.apiCode = "report_upload_unavailable";
  return error;
}

function reportUploadQuotaExceeded() {
  const error = new Error("待处理的举报图片过多，请稍后再试");
  error.status = 429;
  error.apiCode = "report_upload_quota";
  return error;
}

function reportUploadIssuanceExceeded() {
  const error = new Error("举报图片上传过于频繁，请稍后再试");
  error.status = 429;
  error.apiCode = "report_upload_rate_limited";
  return error;
}
