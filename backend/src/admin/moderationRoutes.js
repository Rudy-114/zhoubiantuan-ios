import { createSyncEventsForUsers } from "../sync.js";
import { notifySyncEvents } from "../realtime.js";
import express from "express";
import { requireAdminCSRF, requireAdminSession } from "./adminMiddleware.js";
import { recordAdminAuditEvent } from "./auditService.js";
import { adminError } from "./deviceService.js";
import { withTransaction } from "../db.js";
import { applyModerationDecision, assertReviewCurrent, moderationDecision } from "../moderation/decisionService.js";

const REVIEW_STATUSES = new Set([
  "review", "active", "rejected", "hidden", "removed", "ignored", "all"
]);

export function createAdminModerationRouter() {
  const router = express.Router();

  router.get("/moderation-reviews", requireAdminSession, async (req, res, next) => {
    try {
      const status = moderationStatus(req.query.status);
      const reviews = await withTransaction(async (client) => {
        const params = [];
        let where = "";
        if (status !== "all") {
          params.push(status);
          where = "WHERE status = $1";
        }
        const { rows } = await client.query(
          `SELECT * FROM moderation_reviews
           ${where}
           ORDER BY created_at DESC, id DESC
           LIMIT 200`,
          params
        );
        return rows.map(adminModerationReview);
      });
      res.json({ reviews });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/moderation-reviews/:reviewId/decision",
    requireAdminSession,
    requireAdminCSRF,
    async (req, res, next) => {
      try {
        const decision = moderationDecision(req.body?.decision, () =>
          adminError(400, "admin_moderation_decision_invalid", "审核处理动作无效"));
        const reason = requiredReason(req.body?.reason);
        const { review, syncEvents } = await withTransaction(async (client) => {
          const selected = await client.query(
            "SELECT * FROM moderation_reviews WHERE id = $1 FOR UPDATE",
            [req.params.reviewId]
          );
          const row = selected.rows[0];
          if (!row) {
            throw adminError(404, "admin_moderation_review_not_found", "审核记录不存在");
          }
          if (row.handled_at) throw adminError(409, "admin_review_already_handled", "审核记录已处理，请刷新");
          await assertReviewCurrent(client, row, decision);
          await applyModerationDecision(client, row, decision);
          const updated = await client.query(
            `UPDATE moderation_reviews
             SET status = $2, decision = $3, reason = $4,
                 handled_by = NULL, handled_at = now(), updated_at = now()
             WHERE id = $1
             RETURNING *`,
            [row.id, decision.reviewStatus, decision.name, reason]
          );
          await recordAdminAuditEvent(client, {
            adminUserId: req.adminUser.id,
            deviceId: req.adminDevice.id,
            sessionId: req.adminSession.id,
            eventType: "moderation.review_decided",
            subjectType: "moderation_review",
            subjectId: row.id,
            ip: req.ip,
            userAgent: req.headers["user-agent"],
            eventData: { decision: decision.name, reason }
          });
          const entityType = ["post", "comment", "collection"].includes(row.target_type) ? row.target_type : "user";
          const syncEvents = await createSyncEventsForUsers(client, { userIds: [row.owner_id, null], eventType: entityType + ".moderated", entityType, entityId: entityType === "user" ? row.owner_id : row.target_id });
          return { review: adminModerationReview(updated.rows[0]), syncEvents };
        });
        notifySyncEvents(syncEvents);
        res.json({ review });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

function moderationStatus(value) {
  const status = value == null || value === "" ? "review" : value;
  if (typeof status !== "string" || !REVIEW_STATUSES.has(status)) {
    throw adminError(400, "admin_filter_invalid", "审核状态无效");
  }
  return status;
}

function adminModerationReview(row) {
  return {
    id: row.id,
    targetType: row.target_type,
    targetID: row.target_id,
    ownerID: row.owner_id || "",
    status: row.status,
    decision: row.decision || null,
    source: row.source || "systemRule",
    riskLevel: row.risk_level || "none",
    reason: row.reason || "",
    textSnapshot: row.text_snapshot || "",
    imageURLs: (row.image_object_keys || []).map(sameOriginAssetURL),
    snapshot: safeObject(row.snapshot),
    rawSummary: safeObject(row.raw_summary),
    handledAt: row.handled_at?.toISOString() || null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function sameOriginAssetURL(objectKey) {
  const encoded = String(objectKey)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `/admin/api/assets/${encoded}`;
}

function requiredReason(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw adminError(400, "admin_request_invalid", "审核理由不能为空");
  }
  const reason = value.trim();
  if (Array.from(reason).length > 1000 || /[\u0000]/u.test(reason)) {
    throw adminError(400, "admin_request_invalid", "审核理由无效");
  }
  return reason;
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
