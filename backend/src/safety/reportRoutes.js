import express from "express";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { withTransaction } from "../db.js";
import { createRateLimiter } from "../rateLimit.js";
import { notifySyncEvents } from "../realtime.js";
import { safetyReportToClient } from "./reportMapper.js";
import { submitSafetyReport, supplementSafetyReport } from "./caseService.js";

export function createSafetyReportRouter() {
  const router = express.Router();
  const store = config.nodeEnv === "production" ? "postgres" : "memory";
  const limiterOptions = { store, apiCode: "report_rate_limited", message: "举报操作太频繁，请稍后再试" };
  const ipDailyLimiter = createRateLimiter({
    ...limiterOptions,
    name: "report_ip_daily",
    windowMs: 24 * 60 * 60 * 1000,
    max: config.safety.reportIpMax24h,
    keyGenerator: (req) => req.ip
  });
  const accountDailyLimiter = createRateLimiter({
    ...limiterOptions,
    name: "report_account_daily",
    windowMs: 24 * 60 * 60 * 1000,
    max: config.safety.reportAccountMax24h,
    keyGenerator: (req) => req.user.id
  });
  const accountBurstLimiter = createRateLimiter({
    ...limiterOptions,
    name: "report_account_burst",
    windowMs: 60 * 1000,
    max: config.safety.reportBurstMaxMinute,
    keyGenerator: (req) => req.user.id
  });

  router.post("/reports", ipDailyLimiter, requireAuth, accountDailyLimiter, accountBurstLimiter, async (req, res, next) => {
    try {
      const result = await withTransaction((client) => submitSafetyReport(client, {
        reporterId: req.user.id,
        body: req.body
      }));
      if (result.syncEvents.length) notifySyncEvents(result.syncEvents);
      res.status(result.created ? 201 : 200).json({ report: safetyReportToClient(result.report), duplicate: result.duplicate });
    } catch (error) {
      if (req.body?.sourceType === "direct_message" && error.status === 400 && error.message === "举报目标不存在或不可见") {
        error.status = 403;
      }
      next(error);
    }
  });

  router.get("/me/reports", requireAuth, async (req, res, next) => {
    try {
      const { rows } = await withTransaction((client) => client.query(
        `SELECT r.*, sc.status AS case_status
         FROM reports r
         LEFT JOIN safety_cases sc ON sc.id = r.case_id
         WHERE r.reporter_id = $1
         ORDER BY r.created_at DESC
         LIMIT 100`,
        [req.user.id]
      ));
      res.json({ reports: rows.map(safetyReportToClient) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/reports/:id/evidence", requireAuth, async (req, res, next) => {
    try {
      const result = await withTransaction((client) => supplementSafetyReport(client, {
        reportId: req.params.id,
        reporterId: req.user.id,
        body: req.body
      }));
      if (result.syncEvents.length) notifySyncEvents(result.syncEvents);
      res.status(result.supplemented ? 201 : 200).json({ report: safetyReportToClient(result.report), duplicate: result.duplicate });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
