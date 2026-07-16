import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool, withTransaction } from "./db.js";
import { logger } from "./logger.js";
import { deleteObject } from "./oss.js";
import { startRateLimitEventPruner } from "./rateLimit.js";
import { attachRealtime, notifySyncEvents } from "./realtime.js";
import { analyzeSafetyCase } from "./safety/aiService.js";
import { enqueueSafetyJob } from "./safety/jobQueue.js";
import {
  createAnalyzeCaseJobHandler,
  createMaintenanceJobHandlers,
  createReviewRevisionJobHandler,
  MAINTENANCE_JOB_TYPES,
  RETAINED_EVIDENCE_DELETE_JOB_TYPE,
  startSafetyMaintenanceScheduler,
  startSafetyWorker
} from "./safety/jobWorker.js";
import { cleanupRegisteredReportUpload, reportUploadKeyFromJob } from "./safety/reportUploadCleanup.js";
import { reviewContentRevision } from "./safety/revisionService.js";
import { startSyncEventPruner } from "./sync.js";

const DEFERRED_SAFETY_JOB_TYPES = [
  "analyze_case",
  ...MAINTENANCE_JOB_TYPES,
  RETAINED_EVIDENCE_DELETE_JOB_TYPE
];

export function createSafetyServerRuntime({
  app = createApp(),
  runtimeConfig = config,
  createHttpServer = http.createServer,
  attachRealtime: attachRealtimeDependency = attachRealtime,
  startRateLimitEventPruner: startRateLimitPruner = startRateLimitEventPruner,
  startSyncEventPruner: startSyncPruner = startSyncEventPruner,
  startSafetyWorker: startWorker = startSafetyWorker,
  startSafetyMaintenanceScheduler: startMaintenanceScheduler = startSafetyMaintenanceScheduler,
  withTransaction: transaction = withTransaction,
  enqueueSafetyJob: enqueueJob = enqueueSafetyJob,
  analyzeSafetyCase: analyzeCase = analyzeSafetyCase,
  reviewContentRevision: reviewRevision = reviewContentRevision,
  notifySyncEvents: notifyEvents = notifySyncEvents,
  cleanupReportUpload: cleanupUpload = cleanupRegisteredReportUpload,
  deleteReportUpload: deleteUpload = deleteObject,
  deleteEvidenceObject: deleteEvidence = deleteObject,
  pool: databasePool = pool,
  logger: eventLogger = logger,
  clearInterval: clearPruner = clearInterval,
  closeHttpServer: closeServer = closeHttpServer,
  markProcessExit = () => { process.exitCode = 1; }
} = {}) {
  const server = createHttpServer(app);
  const realtimeHub = attachRealtimeDependency(server);
  const rateLimitPruner = startRateLimitPruner();
  const syncEventPruner = startSyncPruner();
  let lifecycle = "idle";
  let startPromise = null;
  let listenSettledPromise = Promise.resolve();
  let settleListen = null;
  let shutdownPromise = null;
  let signalCleanup = null;
  let signalFailureHandled = false;
  let safetyWorker = null;
  let maintenanceScheduler = null;

  return {
    server,
    start,
    shutdown,
    installSignalHandlers,
    handleCaseReceived
  };

  function start({ port = runtimeConfig.port, host = "0.0.0.0" } = {}) {
    if (lifecycle === "stopping" || lifecycle === "stopped") {
      return Promise.reject(new Error("Server runtime is stopped"));
    }
    if (startPromise) return startPromise;

    lifecycle = "starting";
    listenSettledPromise = new Promise((resolve) => { settleListen = resolve; });
    startPromise = (async () => {
      try {
        await listen(port, host);
        if (lifecycle !== "starting") throw new Error("Server runtime is stopping");
        eventLogger.info("server.started", { port });
        const handlers = { cleanup_report_upload: handleCleanupReportUpload };
        const deferredJobTypes = [...DEFERRED_SAFETY_JOB_TYPES];
        if (runtimeConfig.safety.enabled) {
          Object.assign(handlers, createMaintenanceJobHandlers({
            withTransaction: transaction,
            deleteEvidenceObject: deleteEvidence,
            notifySyncEvents: notifyEvents,
            eventLogger
          }));
          for (const jobType of [...MAINTENANCE_JOB_TYPES, RETAINED_EVIDENCE_DELETE_JOB_TYPE]) {
            deferredJobTypes.splice(deferredJobTypes.indexOf(jobType), 1);
          }
          handlers.case_received = handleCaseReceived;
          handlers.review_revision = createReviewRevisionJobHandler({
            withTransaction: transaction,
            reviewContentRevision: reviewRevision,
            enqueueSafetyJob: enqueueJob,
            aiMode: runtimeConfig.safety.aiMode,
            notifySyncEvents: notifyEvents,
            eventLogger
          });
          if (runtimeConfig.safety.aiMode !== "off") {
            handlers.analyze_case = createAnalyzeCaseJobHandler({
              analyzeSafetyCase: ({
                caseId,
                revisionId,
                jobId,
                jobAttempt,
                interruptedRunId,
                recoverInterruptedRun
              }) => analyzeCase({
                caseId,
                revisionId,
                jobId,
                jobAttempt,
                interruptedRunId,
                recoverInterruptedRun,
                mode: runtimeConfig.safety.aiMode,
                aiConfig: runtimeConfig.safetyAi,
                automaticActionsEnabled: runtimeConfig.safety.autoActionsEnabled === true
              }),
              notifySyncEvents: notifyEvents,
              eventLogger
            });
            deferredJobTypes.splice(deferredJobTypes.indexOf("analyze_case"), 1);
          }
          maintenanceScheduler = startMaintenanceScheduler({
            withTransaction: transaction,
            enqueueSafetyJob: enqueueJob,
            eventLogger
          });
          await maintenanceScheduler.ready;
        } else {
          deferredJobTypes.push("review_revision");
          deferredJobTypes.push("case_received");
        }
        safetyWorker = startWorker({ handlers, deferredJobTypes });
        lifecycle = "running";
        return server;
      } catch (error) {
        if (lifecycle === "starting") {
          try {
            await shutdown("start_failed");
          } catch {
            eventLogger.error("server.start_cleanup_failed", { errorCode: "SERVER_START_CLEANUP_FAILED" });
          }
        }
        throw error;
      }
    })();
    return startPromise;
  }

  function shutdown(signal) {
    if (shutdownPromise) return shutdownPromise;
    lifecycle = "stopping";
    shutdownPromise = (async () => {
      eventLogger.info("server.stopping", { signal });
      await listenSettledPromise;
      const httpClosed = cleanupStep(() => closeServer(server));
      const workerStopped = cleanupStep(() => safetyWorker?.stop());
      const maintenanceStopped = cleanupStep(() => maintenanceScheduler?.stop());
      const prunersCleared = cleanupStep(() => {
        clearPruner(rateLimitPruner);
        clearPruner(syncEventPruner);
      });
      const realtimeClosed = cleanupStep(() => realtimeHub.close());
      const results = await Promise.allSettled([
        httpClosed,
        workerStopped,
        maintenanceStopped,
        prunersCleared,
        realtimeClosed
      ]);
      const poolResult = await Promise.allSettled([cleanupStep(() => databasePool.end())]);
      const failed = [...results, ...poolResult].find((result) => result.status === "rejected");
      lifecycle = "stopped";
      if (failed) throw failed.reason;
      eventLogger.info("server.stopped", { signal });
    })();
    return shutdownPromise;
  }

  function installSignalHandlers(signalEmitter = process) {
    signalCleanup?.();
    const onSignal = (signal) => {
      void shutdown(signal).catch(() => {
        if (signalFailureHandled) return;
        signalFailureHandled = true;
        markProcessExit();
        eventLogger.error("server.shutdown_failed", { errorCode: "SERVER_SHUTDOWN_FAILED" });
      });
    };
    const onTerm = () => onSignal("SIGTERM");
    const onInterrupt = () => onSignal("SIGINT");
    signalEmitter.on("SIGTERM", onTerm);
    signalEmitter.on("SIGINT", onInterrupt);
    signalCleanup = () => {
      signalEmitter.off("SIGTERM", onTerm);
      signalEmitter.off("SIGINT", onInterrupt);
      signalCleanup = null;
    };
    return signalCleanup;
  }

  async function handleCaseReceived(job) {
    if (!job.case_id) throw new Error("Safety job case is required");
    await transaction(async (client) => {
      if (runtimeConfig.safety.aiMode === "off") {
        await client.query(
          `UPDATE safety_cases
           SET status = 'manual_review', updated_at = now()
           WHERE id = $1 AND status = 'received'`,
          [job.case_id]
        );
        return;
      }
      await enqueueJob(client, {
        type: "analyze_case",
        caseId: job.case_id,
        uniqueKey: analysisUniqueKey(job),
        payload: {}
      });
    });
  }

  async function handleCleanupReportUpload(job) {
    const objectKey = reportUploadKeyFromJob(job);
    await cleanupUpload(objectKey, { transaction, deleteObject: deleteUpload });
  }

  function listen(port, host) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        server.off("error", onError);
        settleListen?.();
        callback(value);
      };
      const onError = (error) => finish(reject, error);
      server.once("error", onError);
      try {
        server.listen(port, host, () => finish(resolve));
      } catch (error) {
        finish(reject, error);
      }
    });
  }
}

function analysisUniqueKey(job) {
  const reportId = job?.payload?.reportID;
  if (typeof reportId !== "string" || !reportId.trim() || Array.from(reportId.trim()).length > 160 ||
      /[\u0000-\u001F\u007F]/u.test(reportId)) {
    throw new Error("Safety case_received report ID is required");
  }
  return `analyze_case:${reportId.trim()}`;
}

function cleanupStep(callback) {
  try {
    return Promise.resolve(callback());
  } catch (error) {
    return Promise.reject(error);
  }
}

function closeHttpServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

if (isEntrypoint()) {
  const runtime = createSafetyServerRuntime();
  runtime.installSignalHandlers();
  runtime.start().catch(() => {
    process.exitCode = 1;
    logger.error("server.start_failed", { errorCode: "SERVER_START_FAILED" });
  });
}

function isEntrypoint() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
