import { createSyncEventsForUsers } from "../sync.js";
import { badRequest } from "../validators.js";
import {
  REVERSIBLE_AUTOMATIC_ACTIONS,
  createSafetyCaseSyncEvents,
  rollbackSafetyAction
} from "./actionService.js";
import { lockSafetyTarget } from "./safetyTargetLock.js";

const TRANSACTION_PROBE = "publish_content_revision_probe";
const TERMINAL_CASE_STATUSES = ["resolved_no_action", "resolved_restored", "resolved_actioned"];
const NON_RESTRICTIVE_ACTIONS = new Set(["notify_owner"]);
const QWEN_RESULT_KEYS = [
  "category", "confidence", "evidence", "impactScope", "recommendedAction",
  "requiresHuman", "riskLevel", "subjectType", "summary"
];

export async function publishApprovedRevision(client, revisionId, approval) {
  assertTransactionClient(client);
  await assertActiveTransaction(client);
  const metadata = await loadRevisionMetadata(client, requiredText(revisionId, "整改版本 ID", 160));
  await lockSafetyTarget(client, metadata.target_type, metadata.target_id);
  const targetMetadata = await loadTargetMetadata(client, metadata);
  const safetyCase = await lockCase(client, metadata.case_id);
  const { target, parentCollection } = await lockTarget(client, metadata, safetyCase, targetMetadata);
  const revision = await lockRevision(client, metadata);
  if (revision.status === "published") {
    return {
      published: true,
      restored: safetyCase.status === "resolved_restored",
      unchanged: true,
      syncEvents: []
    };
  }
  if (revision.status !== "approved") throw conflict("整改版本尚未获准发布", "revision_not_approved");

  const normalizedApproval = normalizeApproval(approval, revision, safetyCase);
  await updateTarget(client, revision, target, parentCollection);
  const restoration = await restorationDecision(client, revision, safetyCase, target);
  const syncEvents = [];
  if (restoration.allowed) {
    for (const action of restoration.actions) {
      const rollback = await rollbackSafetyAction(client, {
        actionId: action.id,
        ...normalizedApproval.rollbackActor,
        emitSyncEvents: false
      });
      syncEvents.push(...rollback.syncEvents);
    }
    if (restoration.actions.length) {
      syncEvents.push(...await createSafetyCaseSyncEvents(client, {
        caseId: revision.case_id,
        ownerId: revision.owner_id
      }));
    }
    if (await isEffectivelyVisible(client, revision)) {
      await client.query(
        `UPDATE safety_cases
         SET status = 'resolved_restored', correction_due_at = NULL,
             resolved_at = now(), updated_at = now()
         WHERE id = $1`,
        [revision.case_id]
      );
    } else {
      await markWaitingForManualRestore(client, revision);
      restoration.allowed = false;
    }
  } else {
    await markWaitingForManualRestore(client, revision);
  }

  await client.query(
    `UPDATE content_revisions
     SET status = 'published', published_at = now(), updated_at = now()
     WHERE id = $1`,
    [revision.id]
  );
  syncEvents.push(...await createEntitySyncEvents(client, revision, restoration.allowed));
  return { published: true, restored: restoration.allowed, unchanged: false, syncEvents };
}

async function loadRevisionMetadata(client, revisionId) {
  const { rows } = await client.query(
    `SELECT id, case_id, target_type, target_id, owner_id
     FROM content_revisions WHERE id = $1`,
    [revisionId]
  );
  if (!rows[0]) throw httpError(404, "整改版本不存在", "content_revision_not_found");
  return rows[0];
}

async function lockCase(client, caseId) {
  const { rows } = await client.query("SELECT * FROM safety_cases WHERE id = $1 FOR UPDATE", [caseId]);
  if (!rows[0]) throw httpError(404, "安全案件不存在", "safety_case_not_found");
  return rows[0];
}

async function loadTargetMetadata(client, metadata) {
  const source = metadata.target_type === "post"
    ? { sql: "SELECT author_id AS owner_id, collection_id FROM posts WHERE id = $1" }
    : metadata.target_type === "collection"
      ? { sql: "SELECT owner_id, NULL::text AS collection_id FROM group_collections WHERE id = $1" }
      : null;
  if (!source) throw badRequest("该内容类型不支持发布整改");
  const { rows } = await client.query(source.sql, [metadata.target_id]);
  if (!rows[0]) throw httpError(404, "整改目标不存在", "revision_target_not_found");
  return rows[0];
}

async function lockTarget(client, metadata, safetyCase, targetMetadata) {
  if (safetyCase.subject_type !== metadata.target_type || safetyCase.subject_id !== metadata.target_id) {
    throw conflict("整改版本与案件目标不一致", "revision_target_changed");
  }
  const source = metadata.target_type === "post"
    ? { table: "posts", owner: "author_id" }
    : metadata.target_type === "collection" ? { table: "group_collections", owner: "owner_id" } : null;
  if (!source) throw badRequest("该内容类型不支持发布整改");
  let parentCollection = null;
  if (metadata.target_type === "post" && targetMetadata.collection_id) {
    const parent = await client.query(
      "SELECT * FROM group_collections WHERE id = $1 FOR UPDATE",
      [targetMetadata.collection_id]
    );
    if (!parent.rows[0]) throw conflict("整改目标所属合集已变化", "revision_target_changed");
    parentCollection = parent.rows[0];
  }
  const { rows } = await client.query(
    `SELECT *, ${source.owner} AS revision_owner_id FROM ${source.table} WHERE id = $1 FOR UPDATE`,
    [metadata.target_id]
  );
  if (!rows[0]) throw httpError(404, "整改目标不存在", "revision_target_not_found");
  if (rows[0].revision_owner_id !== metadata.owner_id ||
      rows[0].revision_owner_id !== targetMetadata.owner_id ||
      (metadata.target_type === "post" && rows[0].collection_id !== targetMetadata.collection_id)) {
    throw conflict("整改版本所有者已变化", "revision_target_changed");
  }
  return { target: rows[0], parentCollection };
}

async function lockRevision(client, metadata) {
  const { rows } = await client.query("SELECT * FROM content_revisions WHERE id = $1 FOR UPDATE", [metadata.id]);
  const revision = rows[0];
  if (!revision) throw httpError(404, "整改版本不存在", "content_revision_not_found");
  for (const key of ["case_id", "target_type", "target_id", "owner_id"]) {
    if (revision[key] !== metadata[key]) throw conflict("整改版本元数据已变化", "revision_target_changed");
  }
  return revision;
}

function normalizeApproval(approval, revision, safetyCase) {
  if (!isPlainObject(approval)) throw invalidApproval();
  if (approval.actorType === "admin") {
    assertExactKeys(approval, ["actorId", "actorType", "reason"]);
    return {
      rollbackActor: {
        actorType: "admin",
        actorId: approvalText(approval.actorId, 160),
        reason: approvalText(approval.reason, 1000)
      }
    };
  }
  if (approval.actorType !== "policy") throw invalidApproval();
  assertExactKeys(approval, ["actorType", "policyVersion", "qwenResult"]);
  const policyVersion = approvalText(approval.policyVersion, 153);
  if (!reviewProvesAliyunPass(revision.review_summary) ||
      !validExplicitQwenPass(approval.qwenResult, revision, safetyCase)) throw invalidApproval();
  return {
    rollbackActor: {
      actorType: "ai",
      actorId: `policy:${policyVersion}`,
      reason: `Approved restoration under policy ${policyVersion}`
    }
  };
}

function reviewProvesAliyunPass(summary) {
  return isPlainObject(summary) && summary.status === "active" && summary.outcome === "pass" &&
    summary.hardSafety?.provider === "aliyun" && summary.hardSafety?.passed === true;
}

function validExplicitQwenPass(result, revision, safetyCase) {
  if (!isPlainObject(result) || !hasExactKeys(result, QWEN_RESULT_KEYS)) return false;
  if (result.category !== safetyCase.category || result.subjectType !== revision.target_type ||
      result.impactScope !== safetyCase.impact_scope || result.riskLevel !== "none" ||
      result.recommendedAction !== "no_action" || result.requiresHuman !== false) return false;
  if (typeof result.confidence !== "number" || !Number.isFinite(result.confidence) ||
      result.confidence < 0 || result.confidence > 1) return false;
  if (!approvalTextOrFalse(result.summary, 1000)) return false;
  return Array.isArray(result.evidence) && result.evidence.length > 0 && result.evidence.length <= 20 &&
    result.evidence.every((item) => isPlainObject(item) && hasExactKeys(item, ["fact", "source"]) &&
      approvalTextOrFalse(item.source, 80) && approvalTextOrFalse(item.fact, 1000));
}

async function updateTarget(client, revision, target, parentCollection) {
  if (revision.target_type === "post") return updatePost(client, revision, target, parentCollection);
  if (revision.target_type === "collection") return updateCollection(client, revision);
  throw badRequest("该内容类型不支持发布整改");
}

async function updatePost(client, revision, target, parentCollection) {
  const snapshot = revision.snapshot;
  await client.query(
    `UPDATE posts SET
       title = $2, image_names = $3, image_object_keys = $4,
       preview_image_object_keys = $5, group_type = $6, category_tags = $7,
       fandom_tags = $8, price = $9, deposit = $10, condition = $11,
       is_formed = $12, description = $13, external_link = $14,
       image_aspect = $15, pinggu_average_price = $16, pinggu_note = $17,
       unsold_roles = $18::jsonb,
       wechat = COALESCE($19, wechat), qq = COALESCE($20, qq),
       group_number = COALESCE($21, group_number), group_info = COALESCE($22, group_info),
       deadline = COALESCE($23, deadline), updated_at = now()
     WHERE id = $1`,
    [
      revision.target_id, snapshot.title, snapshot.imageNames, snapshot.imageObjectKeys,
      snapshot.previewImageObjectKeys, snapshot.groupType, snapshot.categoryTags, snapshot.fandomTags,
      snapshot.price, snapshot.deposit, snapshot.condition, snapshot.isFormed, snapshot.description,
      snapshot.externalLink, snapshot.imageAspect, snapshot.pingguAveragePrice, snapshot.pingguNote,
      JSON.stringify(snapshot.unsoldRoles), parentCollection?.contact_wechat ?? null,
      parentCollection?.contact_qq ?? null, parentCollection?.contact_group_number ?? null,
      parentCollection?.group_info ?? null, parentCollection?.deadline ?? null
    ]
  );
}

async function updateCollection(client, revision) {
  const snapshot = revision.snapshot;
  await client.query(
    `UPDATE group_collections SET
       name = $2, contact_wechat = $3, contact_qq = $4, contact_group_number = $5,
       group_info = $6, deadline = $7, default_note = $8, updated_at = now()
     WHERE id = $1`,
    [revision.target_id, snapshot.name, snapshot.contactWechat, snapshot.contactQQ,
      snapshot.contactGroupNumber, snapshot.groupInfo, snapshot.deadline, snapshot.defaultNote]
  );
  await client.query(
    `UPDATE posts SET wechat = $2, qq = $3, group_number = $4,
       group_info = $5, deadline = $6, updated_at = now()
     WHERE collection_id = $1`,
    [revision.target_id, snapshot.contactWechat, snapshot.contactQQ,
      snapshot.contactGroupNumber, snapshot.groupInfo, snapshot.deadline]
  );
}

async function restorationDecision(client, revision, safetyCase, target) {
  const { rows: actions } = await client.query(
    `SELECT * FROM safety_actions
     WHERE target_type = $1 AND target_id = $2 AND execution_status = 'applied'
     ORDER BY applied_at ASC NULLS LAST, created_at ASC, id ASC
     FOR UPDATE`,
    [revision.target_type, revision.target_id]
  );
  const eligible = actions.filter((action) =>
    action.case_id === revision.case_id && ["system", "ai"].includes(action.actor_type) &&
      REVERSIBLE_AUTOMATIC_ACTIONS.has(action.action_type));
  const siblingRestriction = actions.some((action) =>
    action.case_id !== revision.case_id && !NON_RESTRICTIVE_ACTIONS.has(action.action_type));
  const unsafeCurrentRestriction = actions.some((action) =>
    action.case_id === revision.case_id && !NON_RESTRICTIVE_ACTIONS.has(action.action_type) &&
      !eligible.includes(action));
  const adminOrManualAction = actions.some((action) => ["admin", "manual"].includes(action.actor_type));
  const { rows: openCases } = await client.query(
    `SELECT id FROM safety_cases
     WHERE subject_type = $1 AND subject_id = $2 AND id <> $3
       AND status <> ALL($4::text[])
     FOR UPDATE`,
    [revision.target_type, revision.target_id, revision.case_id, TERMINAL_CASE_STATUSES]
  );
  const canBecomeVisible = await targetCanBecomeVisible(client, revision, target, eligible);
  return {
    allowed: !safetyCase.manual_hold && !adminOrManualAction && !openCases.length &&
      !siblingRestriction && !unsafeCurrentRestriction && canBecomeVisible,
    actions: eligible
  };
}

async function targetCanBecomeVisible(client, revision, target, eligible) {
  if (target.status !== "active") return false;
  if (revision.target_type === "collection") {
    return canRestoreColumn(target.safety_status, eligible, "suspend_collection", "safety_status") &&
      canRestoreColumn(target.contact_visibility, eligible, "hide_collection_contact", "contact_visibility");
  }
  if (!canRestoreColumn(target.safety_status, eligible, "hide_post", "safety_status")) return false;
  if (!target.collection_id) return true;
  const { rows } = await client.query(
    "SELECT status, safety_status FROM group_collections WHERE id = $1",
    [target.collection_id]
  );
  return rows[0]?.status === "active" && rows[0]?.safety_status === "active";
}

function canRestoreColumn(currentValue, eligible, actionType, column) {
  if (currentValue === "active") return true;
  const actions = eligible.filter((action) => action.action_type === actionType);
  return actions.length > 0 && actions[0].before_snapshot?.[column] === "active";
}

async function isEffectivelyVisible(client, revision) {
  if (revision.target_type === "post") {
    const { rows } = await client.query(
      `SELECT p.status, p.safety_status,
              COALESCE(c.status, 'active') AS collection_status,
              COALESCE(c.safety_status, 'active') AS collection_safety_status
       FROM posts p LEFT JOIN group_collections c ON c.id = p.collection_id
       WHERE p.id = $1`,
      [revision.target_id]
    );
    return rows[0]?.status === "active" && rows[0]?.safety_status === "active" &&
      rows[0]?.collection_status === "active" && rows[0]?.collection_safety_status === "active";
  }
  const { rows } = await client.query(
    "SELECT status, safety_status, contact_visibility FROM group_collections WHERE id = $1",
    [revision.target_id]
  );
  return rows[0]?.status === "active" && rows[0]?.safety_status === "active" &&
    rows[0]?.contact_visibility === "active";
}

async function markWaitingForManualRestore(client, revision) {
  await client.query(
    `UPDATE safety_cases
     SET status = 'manual_review', resolved_at = NULL, updated_at = now()
     WHERE id = $1`,
    [revision.case_id]
  );
  await client.query(
    `INSERT INTO safety_case_events (case_id, actor_type, event_type, event_data)
     SELECT $1, 'system', 'revision.approved_waiting_manual_restore', $2::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM safety_case_events WHERE case_id = $1
         AND event_type = 'revision.approved_waiting_manual_restore'
         AND event_data->>'revisionId' = $3
     )`,
    [revision.case_id, JSON.stringify({ revisionId: revision.id }), revision.id]
  );
}

async function createEntitySyncEvents(client, revision, includeAudience) {
  const audience = includeAudience ? [null] : [];
  return createSyncEventsForUsers(client, {
    userIds: [revision.owner_id, ...audience],
    eventType: `${revision.target_type}.updated`,
    entityType: revision.target_type,
    entityId: revision.target_id
  });
}

async function knownAudience(client, revision) {
  const postAudience = revision.target_type === "post";
  const sql = postAudience
    ? `SELECT DISTINCT audience.user_id
       FROM (
         SELECT user_id FROM post_likes WHERE post_id = $1
         UNION ALL SELECT user_id FROM post_favorites WHERE post_id = $1
         UNION ALL SELECT author_id FROM comments
           WHERE post_id = $1 AND status = 'active' AND safety_status = 'active'
         UNION ALL SELECT reporter_id FROM reports WHERE case_id = $2
       ) audience
       JOIN users u ON u.id = audience.user_id
       WHERE audience.user_id <> $3 AND u.status = 'active' AND u.deleted_at IS NULL
       ORDER BY audience.user_id`
    : `SELECT DISTINCT audience.user_id
       FROM (
         SELECT pl.user_id FROM post_likes pl JOIN posts p ON p.id = pl.post_id WHERE p.collection_id = $1
         UNION ALL SELECT pf.user_id FROM post_favorites pf JOIN posts p ON p.id = pf.post_id WHERE p.collection_id = $1
         UNION ALL SELECT cm.author_id FROM comments cm JOIN posts p ON p.id = cm.post_id
           WHERE p.collection_id = $1 AND cm.status = 'active' AND cm.safety_status = 'active'
         UNION ALL SELECT r.reporter_id FROM reports r JOIN posts p ON p.id = r.subject_id
           WHERE p.collection_id = $1 AND r.subject_type = 'post'
         UNION ALL SELECT reporter_id FROM reports WHERE case_id = $2
       ) audience
       JOIN users u ON u.id = audience.user_id
       WHERE audience.user_id <> $3 AND u.status = 'active' AND u.deleted_at IS NULL
       ORDER BY audience.user_id`;
  const { rows } = await client.query(sql, [revision.target_id, revision.case_id, revision.owner_id]);
  return rows.map((row) => row.user_id);
}

function assertExactKeys(value, keys) {
  if (!hasExactKeys(value, keys)) throw invalidApproval();
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function approvalText(value, limit) {
  const text = approvalTextOrFalse(value, limit);
  if (!text) throw invalidApproval();
  return text;
}

function approvalTextOrFalse(value, limit) {
  if (typeof value !== "string" || !value.trim()) return false;
  const text = value.trim();
  return Array.from(text).length <= limit ? text : false;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value, label, limit) {
  if (typeof value !== "string" || !value.trim()) throw badRequest(`${label}不能为空`);
  const text = value.trim();
  if (Array.from(text).length > limit) throw badRequest(`${label}不能超过 ${limit} 个字符`);
  return text;
}

function invalidApproval() {
  return httpError(400, "发布批准信息无效", "invalid_policy_approval");
}

function assertTransactionClient(client) {
  if (!client || typeof client.query !== "function" || typeof client.release !== "function") {
    throw new TypeError(
      "publishApprovedRevision requires a transaction-scoped pg PoolClient; caller must BEGIN and own COMMIT/ROLLBACK"
    );
  }
}

async function assertActiveTransaction(client) {
  try {
    await client.query(`SAVEPOINT ${TRANSACTION_PROBE}`);
    await client.query(`RELEASE SAVEPOINT ${TRANSACTION_PROBE}`);
  } catch (error) {
    const developerError = new TypeError(
      "publishApprovedRevision requires an active transaction; caller must BEGIN before invoking it"
    );
    developerError.cause = error;
    throw developerError;
  }
}

function conflict(message, apiCode) {
  return httpError(409, message, apiCode);
}

function httpError(status, message, apiCode) {
  const error = new Error(message);
  error.status = status;
  if (apiCode) error.apiCode = apiCode;
  return error;
}
