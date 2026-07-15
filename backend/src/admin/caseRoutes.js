import express from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { requireAdminCSRF, requireAdminSession } from "./adminMiddleware.js";
import {
  loadAdminAIHealth,
  loadCaseAIComparison,
  recordAdminAIEvaluation
} from "./aiHealthService.js";
import {
  authorizeAdminEvidenceObject,
  decideAdminCase,
  listAdminAuditEvents,
  listAdminCases,
  loadAdminCaseDetail,
  revealAdminCaseEvidence,
  setAdminUserRestriction
} from "./caseService.js";
import { withTransaction } from "../db.js";
import { logger } from "../logger.js";
import { signedReadUrl } from "../oss.js";
import { notifySyncEvents } from "../realtime.js";

const EVIDENCE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function createAdminCaseRouter({
  notifyEvents = notifySyncEvents,
  eventLogger = logger,
  fetchObject,
  signObjectURL = signedReadUrl,
  evidenceTimeoutMs = 10_000,
  aiHealthOptions
} = {}) {
  const router = express.Router();
  const fetchEvidenceObject = fetchObject || ((...args) => globalThis.fetch(...args));

  router.get("/audit-events", requireAdminSession, async (req, res, next) => {
    try {
      const result = await withTransaction((client) => listAdminAuditEvents(client, req.query));
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/ai-health", requireAdminSession, async (_req, res, next) => {
    try {
      const result = await withTransaction((client) => loadAdminAIHealth(client, aiHealthOptions));
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/cases", requireAdminSession, async (req, res, next) => {
    try {
      const result = await withTransaction((client) => listAdminCases(client, req.query));
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/cases/:caseId", requireAdminSession, async (req, res, next) => {
    try {
      const safetyCase = await withTransaction(async (client) => {
        const detail = await loadAdminCaseDetail(client, req.params.caseId);
        const aiComparison = await loadCaseAIComparison(client, req.params.caseId);
        return { ...detail, aiComparison };
      });
      res.json({ case: safetyCase });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/cases/:caseId/evidence/:evidenceId/objects/:objectIndex",
    requireAdminSession,
    async (req, res, next) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), evidenceTimeoutMs);
      timeout.unref?.();
      const abortUpstream = () => controller.abort();
      req.once("aborted", abortUpstream);
      try {
        const { objectKey } = await withTransaction((client) =>
          authorizeAdminEvidenceObject(client, {
            caseId: req.params.caseId,
            evidenceId: req.params.evidenceId,
            objectIndex: req.params.objectIndex,
            accessReason: req.query.reason || req.headers["x-evidence-access-reason"],
            adminUserId: req.adminUser.id,
            deviceId: req.adminDevice.id,
            sessionId: req.adminSession.id,
            ip: req.ip,
            userAgent: req.headers["user-agent"]
          }));
        const upstream = await fetchEvidenceObject(signObjectURL(objectKey, 300), {
          redirect: "error",
          signal: controller.signal
        });
        if (!upstream.ok || !upstream.body) {
          await upstream.body?.cancel();
          throw adminEvidenceError(404, "admin_evidence_object_not_found", "案件证据图片不存在");
        }
        const contentType = String(upstream.headers.get("content-type") || "")
          .split(";", 1)[0]
          .trim()
          .toLowerCase();
        if (!EVIDENCE_IMAGE_TYPES.has(contentType)) {
          await upstream.body.cancel();
          throw adminEvidenceError(415, "admin_evidence_type_invalid", "案件证据图片格式不受支持");
        }
        res.setHeader("Content-Type", contentType);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Cache-Control", "no-store");
        await pipeline(Readable.fromWeb(upstream.body), res);
      } catch (error) {
        if (res.headersSent) {
          res.destroy(error);
          return;
        }
        next(error?.name === "AbortError"
          ? adminEvidenceError(504, "admin_evidence_timeout", "案件证据图片读取超时")
          : error?.status
            ? error
            : adminEvidenceError(502, "admin_evidence_upstream_failed", "案件证据图片读取失败"));
      } finally {
        clearTimeout(timeout);
        req.off("aborted", abortUpstream);
      }
    }
  );

  router.get(
    "/cases/:caseId/evidence/:evidenceId",
    requireAdminSession,
    async (req, res, next) => {
      try {
        const evidence = await withTransaction((client) => revealAdminCaseEvidence(client, {
          caseId: req.params.caseId,
          evidenceId: req.params.evidenceId,
          accessReason: req.query.reason || req.headers["x-evidence-access-reason"],
          adminUserId: req.adminUser.id,
          deviceId: req.adminDevice.id,
          sessionId: req.adminSession.id,
          ip: req.ip,
          userAgent: req.headers["user-agent"]
        }));
        res.json({ evidence });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/cases/:caseId/ai-evaluation",
    requireAdminSession,
    requireAdminCSRF,
    async (req, res, next) => {
      try {
        const evaluation = await withTransaction((client) => recordAdminAIEvaluation(client, {
          caseId: req.params.caseId,
          aiRunID: req.body?.aiRunID,
          categoryCorrect: req.body?.categoryCorrect,
          actionCorrect: req.body?.actionCorrect,
          scopeExpansionError: req.body?.scopeExpansionError,
          notes: req.body?.notes,
          adminUserId: req.adminUser.id,
          deviceId: req.adminDevice.id,
          sessionId: req.adminSession.id,
          ip: req.ip,
          userAgent: req.headers["user-agent"]
        }));
        res.status(201).json({ evaluation });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/cases/:caseId/decision",
    requireAdminSession,
    requireAdminCSRF,
    adminDecisionHandler({ notifyEvents, eventLogger })
  );

  router.post(
    "/cases/:caseId/request-correction",
    requireAdminSession,
    requireAdminCSRF,
    adminDecisionHandler({ fixedDecision: "request_correction", notifyEvents, eventLogger })
  );

  router.post(
    "/cases/:caseId/restore",
    requireAdminSession,
    requireAdminCSRF,
    adminDecisionHandler({ fixedDecision: "restore", notifyEvents, eventLogger })
  );

  router.post(
    "/cases/:caseId/restrict-user",
    requireAdminSession,
    requireAdminCSRF,
    async (req, res, next) => {
      try {
        const result = await withTransaction((client) => setAdminUserRestriction(client, {
          caseId: req.params.caseId,
          userID: req.body?.userID,
          restricted: req.body?.restricted,
          reason: req.body?.reason,
          expectedVersion: req.body?.expectedVersion,
          adminUserId: req.adminUser.id,
          deviceId: req.adminDevice.id,
          sessionId: req.adminSession.id,
          ip: req.ip,
          userAgent: req.headers["user-agent"]
        }));
        await notifyAdminEvents({ notifyEvents, eventLogger, syncEvents: result.syncEvents });
        res.json({ case: result.case });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

function adminDecisionHandler({ fixedDecision = "", notifyEvents, eventLogger }) {
  return async (req, res, next) => {
    try {
      const result = await withTransaction((client) => decideAdminCase(client, {
        ...req.body,
        ...(fixedDecision ? { decision: fixedDecision } : {}),
        caseId: req.params.caseId,
        adminUserId: req.adminUser.id,
        deviceId: req.adminDevice.id,
        sessionId: req.adminSession.id,
        ip: req.ip,
        userAgent: req.headers["user-agent"]
      }));
      await notifyAdminEvents({ notifyEvents, eventLogger, syncEvents: result.syncEvents });
      res.json({ case: result.case });
    } catch (error) {
      next(error);
    }
  };
}

async function notifyAdminEvents({ notifyEvents, eventLogger, syncEvents }) {
  if (!syncEvents?.length) return;
  try {
    await notifyEvents(syncEvents);
  } catch {
    try {
      await eventLogger.error("admin_case_routes.sync_notify_failed", {
        errorCode: "ADMIN_CASE_SYNC_NOTIFY_FAILED",
        eventCount: syncEvents.length
      });
    } catch {}
  }
}

function adminEvidenceError(status, apiCode, message) {
  const error = new Error(message);
  error.status = status;
  error.apiCode = apiCode;
  return error;
}
