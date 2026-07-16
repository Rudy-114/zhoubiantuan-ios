import { query, withTransaction } from "../db.js";

const STALE_LOCK_INTERVAL = "5 minutes";
const REPORT_UPLOAD_REACTIVATION_INTERVAL = "24 hours";
const REPORT_UPLOAD_JOB_RETENTION_INTERVAL = "30 days";
const ERROR_CODE = "SAFETY_JOB_FAILED";
const ERROR_SUMMARY = "Safety job failed (SAFETY_JOB_FAILED).";

export async function enqueueSafetyJob(clientOrInput, maybeInput) {
  const [client, input] = resolveClientAndInput(clientOrInput, maybeInput);
  const values = normalizeEnqueueInput(input);
  const inserted = await client.query(
    `INSERT INTO safety_jobs (job_type, case_id, unique_key, payload, max_attempts, run_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, COALESCE($6::timestamptz, now()))
     ON CONFLICT (unique_key) DO NOTHING
     RETURNING *`,
    [values.type, values.caseId, values.uniqueKey, JSON.stringify(values.payload), values.maxAttempts, values.runAt]
  );
  if (inserted.rows[0]) return inserted.rows[0];

  const existing = await client.query("SELECT * FROM safety_jobs WHERE unique_key = $1", [values.uniqueKey]);
  if (!existing.rows[0]) throw new Error("Safety job enqueue conflict could not be loaded");
  return existing.rows[0];
}

export async function claimSafetyJobs({ limit = 1, workerId, deferredJobTypes = [] } = {}) {
  const safeLimit = positiveInteger(limit, "limit", 100);
  const safeWorkerId = boundedString(workerId, "workerId", 128);
  const safeDeferredJobTypes = normalizeDeferredJobTypes(deferredJobTypes);
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE safety_jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
           locked_at = NULL,
           locked_by = NULL,
           error_code = CASE WHEN attempts >= max_attempts THEN $2 ELSE error_code END,
           error_summary = CASE WHEN attempts >= max_attempts THEN $3 ELSE error_summary END,
           updated_at = now()
       WHERE status = 'running'
         AND locked_at < now() - ($1::text)::interval`,
      [STALE_LOCK_INTERVAL, ERROR_CODE, ERROR_SUMMARY]
    );
    await reactivateFailedReportUploadCleanups(client);
    await pruneResolvedReportUploadCleanupJobs(client);
    const { rows } = await client.query(
      `WITH candidates AS (
         SELECT id FROM safety_jobs
         WHERE status='pending' AND run_at<=now()
           AND attempts < max_attempts
           AND NOT (job_type = ANY($3::text[]))
         ORDER BY run_at,id
         FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE safety_jobs j
       SET status='running',locked_at=now(),locked_by=$2,
        attempts=attempts+1,updated_at=now()
       FROM candidates WHERE j.id=candidates.id RETURNING j.*;`,
      [safeLimit, safeWorkerId, safeDeferredJobTypes]
    );
    return rows;
  });
}

async function reactivateFailedReportUploadCleanups(client) {
  await client.query(
    `WITH eligible AS MATERIALIZED (
       SELECT j.id, u.object_key
       FROM report_uploads u
       JOIN safety_jobs j ON j.unique_key = 'cleanup_report_upload:' || u.object_key
       WHERE u.state IN ('pending', 'deleting')
         AND j.job_type = 'cleanup_report_upload'
         AND j.status = 'failed'
         AND j.updated_at < now() - ($1::text)::interval
       ORDER BY j.updated_at, j.id
       FOR UPDATE OF j, u SKIP LOCKED
       LIMIT 100
     ), reactivated AS (
       UPDATE safety_jobs j
       SET status = 'pending', attempts = 0, run_at = now(),
           locked_at = NULL, locked_by = NULL, completed_at = NULL,
           error_code = NULL, error_summary = NULL, updated_at = now()
       FROM eligible e
       WHERE j.id = e.id
       RETURNING e.object_key
     )
     UPDATE report_uploads u
     SET reactivation_count = reactivation_count + 1,
         last_reactivated_at = now(), updated_at = now()
     FROM reactivated r
     WHERE u.object_key = r.object_key`,
    [REPORT_UPLOAD_REACTIVATION_INTERVAL]
  );
}

async function pruneResolvedReportUploadCleanupJobs(client) {
  await client.query(
    `WITH expired AS MATERIALIZED (
       SELECT j.id
       FROM safety_jobs j
       JOIN report_uploads u ON j.unique_key = 'cleanup_report_upload:' || u.object_key
       WHERE j.job_type = 'cleanup_report_upload'
         AND u.state IN ('attached', 'deleted')
         AND (
           (j.status = 'completed' AND j.completed_at < now() - ($1::text)::interval)
           OR (j.status = 'failed' AND j.updated_at < now() - ($1::text)::interval)
         )
       ORDER BY COALESCE(j.completed_at, j.updated_at), j.id
       FOR UPDATE OF j SKIP LOCKED
       LIMIT 500
     )
     DELETE FROM safety_jobs j
     USING expired e
     WHERE j.id = e.id`,
    [REPORT_UPLOAD_JOB_RETENTION_INTERVAL]
  );
}

export async function completeSafetyJob({ jobId, workerId, leaseAttempt } = {}) {
  const safeJobId = jobIdentifier(jobId);
  const safeWorkerId = boundedString(workerId, "workerId", 128);
  const safeLeaseAttempt = positiveInteger(leaseAttempt, "leaseAttempt", 20);
  const { rows } = await query(
    `UPDATE safety_jobs
     SET status = 'completed', completed_at = now(), locked_at = NULL, locked_by = NULL,
         error_code = NULL, error_summary = NULL,
         payload = CASE
           WHEN job_type = 'delete_retained_evidence_objects' THEN '{}'::jsonb
           ELSE payload
         END,
         updated_at = now()
     WHERE id = $1 AND status = 'running' AND locked_by = $2 AND attempts = $3
     RETURNING *`,
    [safeJobId, safeWorkerId, safeLeaseAttempt]
  );
  return rows[0] || null;
}

export async function failSafetyJob({ jobId, workerId, leaseAttempt, error } = {}) {
  const safeJobId = jobIdentifier(jobId);
  const safeWorkerId = boundedString(workerId, "workerId", 128);
  const safeLeaseAttempt = positiveInteger(leaseAttempt, "leaseAttempt", 20);
  const safeError = sanitizeSafetyJobError(error);
  const { rows } = await query(
    `UPDATE safety_jobs
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
         run_at = CASE
           WHEN attempts >= max_attempts THEN run_at
           WHEN job_type = 'cleanup_report_upload' AND attempts = 1 THEN now() + interval '5 minutes'
           WHEN job_type = 'cleanup_report_upload' AND attempts = 2 THEN now() + interval '30 minutes'
           WHEN job_type = 'cleanup_report_upload' AND attempts = 3 THEN now() + interval '2 hours'
           WHEN job_type = 'cleanup_report_upload' THEN now() + interval '8 hours'
           WHEN attempts = 1 THEN now() + interval '30 seconds'
           ELSE now() + interval '120 seconds'
         END,
         locked_at = NULL,
         locked_by = NULL,
         error_code = $4,
         error_summary = $5,
         updated_at = now()
     WHERE id = $1 AND status = 'running' AND locked_by = $2 AND attempts = $3
     RETURNING *`,
    [safeJobId, safeWorkerId, safeLeaseAttempt, safeError.code, safeError.summary]
  );
  return rows[0] || null;
}

export async function releaseSafetyJob({ jobId, workerId, leaseAttempt } = {}) {
  const safeJobId = jobIdentifier(jobId);
  const safeWorkerId = boundedString(workerId, "workerId", 128);
  const safeLeaseAttempt = positiveInteger(leaseAttempt, "leaseAttempt", 20);
  const { rows } = await query(
    `UPDATE safety_jobs
     SET status = 'pending', locked_at = NULL, locked_by = NULL,
         attempts = attempts - 1, updated_at = now()
     WHERE id = $1 AND status = 'running' AND locked_by = $2
       AND attempts = $3 AND attempts > 0
     RETURNING *`,
    [safeJobId, safeWorkerId, safeLeaseAttempt]
  );
  return rows[0] || null;
}

export function sanitizeSafetyJobError(_error) {
  return { code: ERROR_CODE, summary: ERROR_SUMMARY };
}

function resolveClientAndInput(clientOrInput, maybeInput) {
  if (clientOrInput && typeof clientOrInput.query === "function") {
    return [clientOrInput, maybeInput];
  }
  return [{ query }, clientOrInput];
}

function normalizeEnqueueInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Safety job input must be an object");
  const payload = input.payload === undefined ? {} : input.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("Safety job payload must be an object");
  const runAt = input.runAt ?? null;
  if (runAt !== null && Number.isNaN(new Date(runAt).getTime())) throw new TypeError("runAt must be a valid date");
  return {
    type: token(input.type, "type", 64),
    caseId: input.caseId == null ? null : boundedString(input.caseId, "caseId", 128),
    uniqueKey: boundedString(input.uniqueKey, "uniqueKey", 256),
    payload,
    maxAttempts: input.maxAttempts === undefined ? 3 : positiveInteger(input.maxAttempts, "maxAttempts", 20),
    runAt: runAt === null ? null : new Date(runAt).toISOString()
  };
}

function jobIdentifier(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new TypeError("jobId must be a positive integer");
  return parsed;
}

function positiveInteger(value, name, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new TypeError(`${name} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

function token(value, name, maximum) {
  const text = boundedString(value, name, maximum);
  if (!/^[a-z][a-z0-9_]*$/.test(text)) throw new TypeError(`${name} must be a lowercase token`);
  return text;
}

function normalizeDeferredJobTypes(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("deferredJobTypes must be an array");
  return [...new Set(value.map((jobType) => token(jobType, "deferredJobTypes entry", 64)))];
}

function boundedString(value, name, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new TypeError(`${name} must be a non-empty string up to ${maximum} characters`);
  }
  return value;
}
