import express from "express";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { withTransaction } from "../db.js";
import { logger } from "../logger.js";
import { createRateLimiter } from "../rateLimit.js";
import { notifySyncEvents } from "../realtime.js";
import { createSyncEvent } from "../sync.js";
import { badRequest } from "../validators.js";
import { APPEAL_WINDOW_SQL, submitSafetyAppeal } from "./appealService.js";
import { contentActionToClient } from "./contentActionMapper.js";
import { submitContentRevision } from "./revisionService.js";

const OWNER_ACTION_STATUSES = [
  "monitoring", "manual_review", "awaiting_correction", "rechecking", "appealed",
  "resolved_restored", "resolved_actioned"
];
const MAX_CASE_ID_LENGTH = 160;
const CONTENT_ACTION_PAGE_SIZE = 100;
const MAX_CONTENT_ACTION_CURSOR_LENGTH = 512;
const UNSAFE_CASE_ID_CHARACTERS = /[\u0000-\u001F\u007F]/;

export function createSafetyRevisionRouter({
  notifySyncEvents: notifyEvents = notifySyncEvents,
  eventLogger = logger
} = {}) {
  if (typeof notifyEvents !== "function") throw new TypeError("notifySyncEvents must be a function");
  if (!eventLogger || typeof eventLogger.error !== "function") throw new TypeError("eventLogger must expose error");
  const router = express.Router();
  const store = config.nodeEnv === "production" ? "postgres" : "memory";
  const limiterOptions = {
    store,
    apiCode: "content_revision_rate_limited",
    message: "整改提交太频繁，请稍后再试"
  };
  const revisionIpDailyLimiter = createRateLimiter({
    ...limiterOptions,
    name: "content_revision_ip_daily",
    windowMs: 24 * 60 * 60 * 1000,
    max: config.safety.contentRevisionIpMax24h,
    keyGenerator: (req) => req.ip
  });
  const revisionAccountDailyLimiter = createRateLimiter({
    ...limiterOptions,
    name: "content_revision_account_daily",
    windowMs: 24 * 60 * 60 * 1000,
    max: config.safety.contentRevisionAccountMax24h,
    keyGenerator: (req) => req.user.id
  });
  const revisionAccountBurstLimiter = createRateLimiter({
    ...limiterOptions,
    name: "content_revision_account_burst",
    windowMs: 60 * 1000,
    max: config.safety.contentRevisionBurstMaxMinute,
    keyGenerator: (req) => req.user.id
  });

  router.get("/me/content-actions", requireAuth, async (req, res, next) => {
    try {
      const cursor = decodeContentActionCursor(req.query.cursor);
      const rows = await withTransaction((client) => loadOwnerContentActions(
        client,
        req.user.id,
        null,
        cursor,
        CONTENT_ACTION_PAGE_SIZE + 1
      ));
      const page = rows.slice(0, CONTENT_ACTION_PAGE_SIZE);
      const body = { actions: page.map(contentActionToClient) };
      if (rows.length > CONTENT_ACTION_PAGE_SIZE) {
        body.nextCursor = encodeContentActionCursor(page[page.length - 1]);
      }
      res.json(body);
    } catch (error) {
      next(error);
    }
  });
  router.post(
    "/content-actions/:caseId/revisions",
    revisionIpDailyLimiter,
    requireAuth,
    revisionAccountDailyLimiter,
    revisionAccountBurstLimiter,
    async (req, res, next) => {
      try {
        const caseId = normalizeContentActionCaseId(req.params.caseId);
        const input = normalizeRevisionRequest(req.body);
        const result = await withTransaction(async (client) => {
          await submitContentRevision(client, {
            caseId,
            ownerId: req.user.id,
            snapshot: input.snapshot,
            objectKeys: input.objectKeys
          });
          const syncEvent = await createSyncEvent(client, {
            userId: req.user.id,
            eventType: "safety.content_action.updated",
            entityType: "safety_case",
            entityId: caseId
          });
          const action = await loadOwnerContentAction(client, req.user.id, caseId);
          if (!action) throw new Error("Unable to load submitted content action");
          return { action: contentActionToClient(action), syncEvents: [syncEvent] };
        });
        await notifyContentActionEvents(notifyEvents, eventLogger, result.syncEvents);
        res.status(201).json({ action: result.action });
      } catch (error) {
        next(error);
      }
    }
  );
  router.post("/content-actions/:caseId/appeal", requireAuth, async (req, res, next) => {
    try {
      const caseId = normalizeContentActionCaseId(req.params.caseId);
      const input = normalizeAppealRequest(req.body);
      const result = await withTransaction(async (client) => {
        const appealResult = await submitSafetyAppeal(client, {
          caseId,
          ownerId: req.user.id,
          detail: input.detail,
          objectKeys: input.objectKeys
        });
        const action = await loadOwnerContentAction(client, req.user.id, caseId);
        if (!action) throw new Error("Unable to load appealed content action");
        return { action: contentActionToClient(action), syncEvents: appealResult.syncEvents };
      });
      await notifyContentActionEvents(notifyEvents, eventLogger, result.syncEvents);
      res.status(201).json({ action: result.action });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function notifyContentActionEvents(notifyEvents, eventLogger, syncEvents) {
  if (!syncEvents?.length) return;
  try {
    await notifyEvents(syncEvents);
  } catch {
    try {
      await eventLogger.error("safety_routes.content_action_notify_failed", {
        errorCode: "CONTENT_ACTION_NOTIFY_FAILED"
      });
    } catch {}
  }
}

async function loadOwnerContentAction(client, ownerId, caseId) {
  const actions = await loadOwnerContentActions(client, ownerId, caseId);
  return actions[0] || null;
}

async function loadOwnerContentActions(client, ownerId, caseId = null, cursor = null, limit = CONTENT_ACTION_PAGE_SIZE) {
  const { rows } = await client.query(
    `WITH owner_case_candidates AS (
       SELECT sc.id, sc.subject_type, sc.subject_id, sc.category, sc.status,
              sc.correction_due_at, sc.created_at, sc.updated_at,
              p.status AS target_status, p.safety_status AS target_safety_status,
              parent.status AS parent_status, parent.safety_status AS parent_safety_status,
              parent.contact_visibility AS parent_contact_visibility
       FROM safety_cases sc
       JOIN posts p ON sc.subject_type = 'post' AND p.id = sc.subject_id
       LEFT JOIN group_collections parent ON parent.id = p.collection_id
       WHERE p.author_id = $1
         AND sc.status = ANY($2::text[])
         AND ($3::text IS NULL OR sc.id = $3)
       UNION ALL
       SELECT sc.id, sc.subject_type, sc.subject_id, sc.category, sc.status,
              sc.correction_due_at, sc.created_at, sc.updated_at,
              c.status AS target_status, c.safety_status AS target_safety_status,
              NULL::text AS parent_status, NULL::text AS parent_safety_status,
              c.contact_visibility AS parent_contact_visibility
       FROM safety_cases sc
       JOIN group_collections c ON sc.subject_type = 'collection' AND c.id = sc.subject_id
       WHERE c.owner_id = $1
         AND sc.status = ANY($2::text[])
         AND ($3::text IS NULL OR sc.id = $3)
     ),
     owner_cases AS MATERIALIZED (
       SELECT *
       FROM owner_case_candidates
       WHERE (
         $4::numeric IS NULL
         OR (floor(extract(epoch FROM created_at) * 1000000), id) < ($4::numeric, $5::text)
       )
       ORDER BY created_at DESC, id DESC
       LIMIT $6
     ),
     report_fields AS (
       SELECT r.case_id,
              array_agg(DISTINCT r.reported_field ORDER BY r.reported_field) AS affected_fields
       FROM reports r
       JOIN owner_cases oc ON oc.id = r.case_id
       GROUP BY r.case_id
     ),
     revision_rows AS (
       SELECT cr.case_id, cr.status,
              row_number() OVER (
                PARTITION BY cr.case_id
                ORDER BY cr.revision_number DESC, cr.created_at DESC, cr.id DESC
              ) AS revision_rank
       FROM content_revisions cr
       JOIN owner_cases oc ON oc.id = cr.case_id
     ),
     latest_revisions AS (
       SELECT case_id, status
       FROM revision_rows
       WHERE revision_rank = 1
     ),
     decision_rows AS (
       SELECT a.case_id, a.id, (${APPEAL_WINDOW_SQL}) AS appeal_window_open,
              row_number() OVER (
                PARTITION BY a.case_id
                ORDER BY a.applied_at DESC NULLS LAST, a.created_at DESC, a.id DESC
              ) AS decision_rank
       FROM safety_actions a
       JOIN owner_cases oc
         ON oc.id = a.case_id
        AND oc.subject_type = a.target_type
        AND oc.subject_id = a.target_id
       WHERE a.actor_type = 'admin'
         AND a.execution_status = 'applied'
         AND a.action_type NOT IN ('notify_owner', 'request_correction')
     ),
     latest_decisions AS (
       SELECT case_id, id, appeal_window_open
       FROM decision_rows
       WHERE decision_rank = 1
     )
     SELECT oc.id AS case_id, oc.subject_type, oc.subject_id, oc.category, oc.status,
            oc.correction_due_at, oc.updated_at,
            floor(extract(epoch FROM oc.created_at) * 1000000)::bigint::text
              AS cursor_created_at_micros,
            oc.target_status, oc.target_safety_status, oc.parent_status,
            oc.parent_safety_status, oc.parent_contact_visibility,
            COALESCE(fields.affected_fields, ARRAY[]::text[]) AS affected_fields,
            revision.status AS revision_status,
            (
              oc.status = 'resolved_actioned'
              AND decision.id IS NOT NULL
              AND decision.appeal_window_open
              AND appeal.id IS NULL
            ) AS can_appeal
     FROM owner_cases oc
     LEFT JOIN report_fields fields ON fields.case_id = oc.id
     LEFT JOIN latest_revisions revision ON revision.case_id = oc.id
     LEFT JOIN latest_decisions decision ON decision.case_id = oc.id
     LEFT JOIN safety_appeals appeal ON appeal.decision_action_id = decision.id
     ORDER BY oc.created_at DESC, oc.id DESC`,
    [
      ownerId,
      OWNER_ACTION_STATUSES,
      caseId,
      cursor?.createdAtMicros || null,
      cursor?.caseID || null,
      caseId ? 1 : limit
    ]
  );
  return rows.map((row) => ({
    ...row,
    owner_reason: ownerReason(row.category, row.affected_fields),
    current_restriction: currentRestriction(row)
  }));
}

function encodeContentActionCursor(row) {
  return Buffer.from(JSON.stringify({
    createdAtMicros: row.cursor_created_at_micros,
    caseID: row.case_id
  })).toString("base64url");
}

function decodeContentActionCursor(value) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !value || value.length > MAX_CONTENT_ACTION_CURSOR_LENGTH ||
      !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw badRequest("内容操作游标不正确", "invalid_content_action_cursor");
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isPlainObject(parsed) || Object.keys(parsed).sort().join(",") !== "caseID,createdAtMicros") {
      throw new Error("invalid cursor shape");
    }
    const caseID = normalizeContentActionCaseId(parsed.caseID);
    if (typeof parsed.createdAtMicros !== "string" || !/^[1-9]\d{0,19}$/.test(parsed.createdAtMicros)) {
      throw new Error("invalid cursor timestamp");
    }
    return { caseID, createdAtMicros: parsed.createdAtMicros };
  } catch {
    throw badRequest("内容操作游标不正确", "invalid_content_action_cursor");
  }
}

function normalizeContentActionCaseId(value) {
  if (typeof value !== "string" || UNSAFE_CASE_ID_CHARACTERS.test(value)) {
    throw badRequest("案件 ID 不正确", "invalid_content_action_case_id");
  }
  const caseId = value.trim();
  if (!caseId || caseId !== value || Array.from(caseId).length > MAX_CASE_ID_LENGTH) {
    throw badRequest("案件 ID 不正确", "invalid_content_action_case_id");
  }
  return caseId;
}

function normalizeRevisionRequest(body) {
  if (!isPlainObject(body)) throw badRequest("请求体必须是对象");
  const keys = Object.keys(body);
  if (!Object.hasOwn(body, "snapshot") || keys.some((key) => !["snapshot", "objectKeys"].includes(key))) {
    throw badRequest("整改请求字段不正确");
  }
  if (Object.hasOwn(body, "objectKeys") && !Array.isArray(body.objectKeys)) {
    throw badRequest("整改附件必须是数组");
  }
  return { snapshot: body.snapshot, objectKeys: body.objectKeys || [] };
}

function normalizeAppealRequest(body) {
  if (!isPlainObject(body)) throw badRequest("请求体必须是对象");
  const keys = Object.keys(body);
  if (!Object.hasOwn(body, "detail") || keys.some((key) => !["detail", "objectKeys"].includes(key))) {
    throw badRequest("申诉请求字段不正确");
  }
  return {
    detail: body.detail,
    objectKeys: Object.hasOwn(body, "objectKeys") ? body.objectKeys : []
  };
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownerReason(category, affectedFields) {
  const fields = new Set(affectedFields || []);
  if (category === "invalid_contact" || ["contact_wechat", "contact_qq", "contact_group_number"].some((field) => fields.has(field))) {
    return "联系方式可能无效，请核实并更新相关信息";
  }
  if (category === "false_or_expired_group_buy" || fields.has("collection_deadline")) {
    return "拼团信息可能不准确或已失效，请更新相关内容";
  }
  return {
    suspected_scam: "内容可能涉及交易欺诈，请按平台规则核实并整改",
    copyright_or_stolen_media: "内容可能涉及版权或素材归属问题，请核实并整改",
    harassment_or_abuse: "内容可能包含骚扰或攻击性表达，请按平台规则整改",
    sexual_or_illegal: "内容可能违反平台内容安全规则，请删除或修改相关信息",
    spam_or_advertising: "内容可能属于垃圾信息或违规推广，请按平台规则整改",
    direct_message_risk: "内容可能存在私信交易风险，请按平台规则核实",
    other: "内容可能不符合平台规则，请核实并整改"
  }[category] || "内容需要整改";
}

function currentRestriction(row) {
  if (row.subject_type === "post") {
    if (row.target_status !== "active") {
      return row.target_status === "deleted" ? "帖子当前已删除" : "帖子当前不可公开查看";
    }
    if (row.target_safety_status === "removed") return "帖子当前已移除";
    if (row.target_safety_status === "hidden") return "帖子当前已隐藏";
    if (row.parent_status && row.parent_status !== "active") return "帖子所属合集当前不可公开查看";
    if (row.parent_safety_status === "removed") return "帖子所属合集当前已移除";
    if (row.parent_safety_status === "suspended") return "帖子所属合集当前已暂停";
    if (row.parent_contact_visibility === "hidden") return "帖子所属合集联系方式当前已隐藏";
    return "";
  }
  if (row.subject_type === "collection") {
    if (row.target_status !== "active") {
      return row.target_status === "deleted" ? "合集当前已删除" : "合集当前不可公开查看";
    }
    if (row.target_safety_status === "removed") return "合集当前已移除";
    if (row.target_safety_status === "suspended") return "合集当前已暂停";
    if (row.parent_contact_visibility === "hidden") return "合集联系方式当前已隐藏";
  }
  return "";
}
