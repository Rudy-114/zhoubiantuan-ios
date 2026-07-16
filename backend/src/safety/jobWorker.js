import {
  claimSafetyJobs,
  completeSafetyJob,
  enqueueSafetyJob,
  failSafetyJob,
  releaseSafetyJob,
  sanitizeSafetyJobError
} from "./jobQueue.js";
import { logger } from "../logger.js";
import {
  clearExpiredEvidence as clearExpiredEvidenceDefault,
  closeLowRiskCases as closeLowRiskCasesDefault,
  deidentifyExpiredAudit as deidentifyExpiredAuditDefault,
  processCorrectionDeadlines as processCorrectionDeadlinesDefault
} from "./maintenanceService.js";

export const MAINTENANCE_JOB_TYPES = Object.freeze([
  "maintenance_correction_deadlines",
  "maintenance_low_risk_cases",
  "maintenance_evidence_retention",
  "maintenance_audit_retention"
]);
export const RETAINED_EVIDENCE_DELETE_JOB_TYPE = "delete_retained_evidence_objects";

export function startSafetyMaintenanceScheduler({
  withTransaction,
  enqueueSafetyJob: enqueueJob = enqueueSafetyJob,
  now = () => new Date(),
  setInterval: scheduleInterval = globalThis.setInterval,
  clearInterval: cancelInterval = globalThis.clearInterval,
  eventLogger = logger
} = {}) {
  if (typeof withTransaction !== "function") throw new TypeError("withTransaction must be a function");
  if (typeof enqueueJob !== "function") throw new TypeError("enqueueSafetyJob must be a function");
  if (typeof now !== "function") throw new TypeError("now must be a function");
  if (typeof scheduleInterval !== "function" || typeof cancelInterval !== "function") {
    throw new TypeError("maintenance interval functions are required");
  }
  if (!eventLogger || typeof eventLogger.error !== "function") throw new TypeError("eventLogger must expose error");

  let stopped = false;
  let tail = Promise.resolve();
  const intervalHandle = scheduleInterval(() => { void scheduleRun(); }, 60 * 60 * 1000);
  const ready = scheduleRun();

  return {
    ready,
    async stop() {
      if (!stopped) {
        stopped = true;
        cancelInterval(intervalHandle);
      }
      await tail;
    }
  };

  function scheduleRun() {
    const run = tail.then(async () => {
      if (stopped) return;
      const hour = maintenanceHour(now());
      await withTransaction(async (client) => {
        for (const type of MAINTENANCE_JOB_TYPES) {
          await enqueueJob(client, {
            type,
            uniqueKey: `${type}:${hour}`,
            payload: { hour }
          });
        }
      });
    }).catch(() => {
      eventLogger.error("safety_worker.maintenance_schedule_failed", {
        errorCode: "MAINTENANCE_SCHEDULE_FAILED"
      });
    });
    tail = run;
    return run;
  }
}

export function createMaintenanceJobHandlers({
  withTransaction,
  processCorrectionDeadlines = processCorrectionDeadlinesDefault,
  closeLowRiskCases = closeLowRiskCasesDefault,
  clearExpiredEvidence = clearExpiredEvidenceDefault,
  deidentifyExpiredAudit = deidentifyExpiredAuditDefault,
  deleteEvidenceObject = async () => { throw new Error("evidence object deletion is unavailable"); },
  notifySyncEvents,
  eventLogger = logger
} = {}) {
  const operations = {
    maintenance_correction_deadlines: processCorrectionDeadlines,
    maintenance_low_risk_cases: closeLowRiskCases,
    maintenance_evidence_retention: clearExpiredEvidence,
    maintenance_audit_retention: deidentifyExpiredAudit
  };
  if (typeof withTransaction !== "function") throw new TypeError("withTransaction must be a function");
  for (const operation of Object.values(operations)) {
    if (typeof operation !== "function") throw new TypeError("maintenance operations must be functions");
  }
  if (typeof deleteEvidenceObject !== "function") throw new TypeError("deleteEvidenceObject must be a function");
  if (typeof notifySyncEvents !== "function") throw new TypeError("notifySyncEvents must be a function");
  if (!eventLogger || typeof eventLogger.error !== "function") throw new TypeError("eventLogger must expose error");

  return {
    maintenance_correction_deadlines: () => runExclusive(
      "maintenance_correction_deadlines",
      operations.maintenance_correction_deadlines
    ),
    maintenance_low_risk_cases: async () => {
      const result = await runExclusive(
        "maintenance_low_risk_cases",
        operations.maintenance_low_risk_cases
      );
      if (result?.syncEvents?.length) {
        try {
          await notifySyncEvents(result.syncEvents);
        } catch {
          eventLogger.error("safety_worker.maintenance_low_risk_notify_failed", {
            errorCode: "MAINTENANCE_LOW_RISK_NOTIFY_FAILED"
          });
        }
      }
      return result;
    },
    maintenance_evidence_retention: async () => {
      const result = await runExclusive(
        "maintenance_evidence_retention",
        operations.maintenance_evidence_retention
      );
      for (const objectKey of result?.objectKeys || []) {
        try {
          await deleteEvidenceObject(objectKey);
        } catch {
          eventLogger.error("safety_worker.evidence_delete_failed", {
            errorCode: "EVIDENCE_DELETE_FAILED"
          });
        }
      }
      return result;
    },
    maintenance_audit_retention: () => runExclusive(
      "maintenance_audit_retention",
      operations.maintenance_audit_retention
    ),
    [RETAINED_EVIDENCE_DELETE_JOB_TYPE]: async (job) => {
      const objectKeys = retainedEvidenceObjectKeys(job?.payload?.objectKeys);
      for (const objectKey of objectKeys) await deleteEvidenceObject(objectKey);
      return { deleted: objectKeys.length };
    }
  };

  function runExclusive(type, operation) {
    return withTransaction(async (client) => {
      const { rows } = await client.query(
        "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked",
        [`safety-maintenance:${type}`]
      );
      if (rows[0]?.locked !== true) throw new Error("maintenance lock is busy");
      return operation(client);
    });
  }
}

function retainedEvidenceObjectKeys(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error("retained evidence object keys are invalid");
  }
  const keys = [...new Set(value.map((objectKey) => {
    if (typeof objectKey !== "string" || !objectKey || objectKey.length > 1024 || /[\u0000-\u001F\u007F]/u.test(objectKey)) {
      throw new Error("retained evidence object keys are invalid");
    }
    return objectKey;
  }))];
  return keys;
}

export function createAnalyzeCaseJobHandler({
  analyzeSafetyCase,
  notifySyncEvents,
  eventLogger = logger
} = {}) {
  if (typeof analyzeSafetyCase !== "function") throw new TypeError("analyzeSafetyCase must be a function");
  if (typeof notifySyncEvents !== "function") throw new TypeError("notifySyncEvents must be a function");
  if (!eventLogger || typeof eventLogger.error !== "function") throw new TypeError("eventLogger must expose error");

  return async function handleAnalyzeCaseJob(job) {
    const caseId = requiredCaseId(job?.case_id);
    const revisionId = optionalRevisionId(job?.payload?.revisionId);
    const recoverInterruptedRun = Number.isSafeInteger(job?.attempts) && job.attempts > 1;
    const result = await analyzeSafetyCase({ caseId, revisionId, recoverInterruptedRun });
    if (result?.status === "failed" && result.retryable === true) {
      const retryError = new Error("Safety AI analysis requires retry");
      retryError.code = "SAFETY_AI_RETRYABLE";
      throw retryError;
    }
    if (result?.syncEvents?.length) {
      try {
        await notifySyncEvents(result.syncEvents);
      } catch {
        eventLogger.error("safety_worker.analyze_case_notify_failed", {
          errorCode: "ANALYZE_CASE_NOTIFY_FAILED"
        });
      }
    }
    return result;
  };
}

export function createReviewRevisionJobHandler({
  withTransaction,
  reviewContentRevision,
  enqueueSafetyJob: enqueueJob = enqueueSafetyJob,
  aiMode = "off",
  notifySyncEvents,
  eventLogger = logger
} = {}) {
  if (typeof withTransaction !== "function") throw new TypeError("withTransaction must be a function");
  if (typeof reviewContentRevision !== "function") throw new TypeError("reviewContentRevision must be a function");
  if (!["off", "shadow", "enforce"].includes(aiMode)) throw new TypeError("aiMode must be off, shadow, or enforce");
  if (aiMode !== "off" && typeof enqueueJob !== "function") throw new TypeError("enqueueSafetyJob must be a function");
  if (typeof notifySyncEvents !== "function") throw new TypeError("notifySyncEvents must be a function");
  if (!eventLogger || typeof eventLogger.error !== "function") throw new TypeError("eventLogger must expose error");

  return async function handleReviewRevisionJob(job) {
    const revisionId = requiredRevisionId(job?.payload?.revisionId);
    const result = await withTransaction(async (client) => {
      const review = await reviewContentRevision(client, { revisionId });
      if (aiMode !== "off" && review?.awaiting === "human_or_qwen") {
        const caseId = requiredCaseId(job?.case_id);
        await enqueueJob(client, {
          type: "analyze_case",
          caseId,
          uniqueKey: `analyze_revision:${revisionId}`,
          payload: { revisionId }
        });
      }
      return review;
    });
    if (result?.syncEvents?.length) {
      try {
        await notifySyncEvents(result.syncEvents);
      } catch {
        eventLogger.error("safety_worker.review_revision_notify_failed", {
          errorCode: "REVIEW_REVISION_NOTIFY_FAILED"
        });
      }
    }
    return result;
  };
}

export function startSafetyWorker({
  concurrency = 2,
  pollIntervalMs = 1000,
  handlers = {},
  deferredJobTypes = [],
  workerId = `worker-${process.pid}`,
  queue = { claimSafetyJobs, completeSafetyJob, failSafetyJob, releaseSafetyJob },
  eventLogger = logger
} = {}) {
  const safeConcurrency = positiveInteger(concurrency, "concurrency", 20);
  const safePollIntervalMs = positiveInteger(pollIntervalMs, "pollIntervalMs", 60_000);
  const safeWorkerId = requiredString(workerId, "workerId");
  if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) throw new TypeError("handlers must be an object");
  const safeDeferredJobTypes = deferredTypes(deferredJobTypes, handlers);

  let stopping = false;
  let wakeSleep = null;
  const runPromise = run();

  return {
    async stop() {
      stopping = true;
      wakeSleep?.();
      await runPromise;
    }
  };

  async function run() {
    while (!stopping) {
      let jobs;
      try {
        jobs = await queue.claimSafetyJobs({ limit: safeConcurrency, workerId: safeWorkerId, deferredJobTypes: safeDeferredJobTypes });
      } catch (_error) {
        logFailure("safety_worker.claim_failed");
        await sleep();
        continue;
      }
      if (stopping) {
        await releaseClaimedJobs(jobs);
        break;
      }
      if (!jobs.length) {
        await sleep();
        continue;
      }
      await Promise.all(jobs.map(executeJob));
    }
  }

  async function executeJob(job) {
    try {
      const handler = handlers[job.job_type];
      if (typeof handler !== "function") throw new Error("Unknown safety job type");
      await handler(job);
      await queue.completeSafetyJob({ jobId: job.id, workerId: safeWorkerId, leaseAttempt: job.attempts });
    } catch (error) {
      try {
        await queue.failSafetyJob({ jobId: job.id, workerId: safeWorkerId, leaseAttempt: job.attempts, error });
      } catch (_failureError) {
        logFailure("safety_worker.job_update_failed");
      }
    }
  }

  async function releaseClaimedJobs(jobs) {
    await Promise.all(jobs.map(async (job) => {
      try {
        await queue.releaseSafetyJob({ jobId: job.id, workerId: safeWorkerId, leaseAttempt: job.attempts });
      } catch (_error) {
        logFailure("safety_worker.release_failed");
      }
    }));
  }

  function sleep() {
    if (stopping) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, safePollIntervalMs);
      wakeSleep = done;
      function done() {
        clearTimeout(timer);
        if (wakeSleep === done) wakeSleep = null;
        resolve();
      }
    });
  }

  function logFailure(event) {
    const sanitized = sanitizeSafetyJobError();
    eventLogger.error(event, { errorCode: sanitized.code });
  }
}

function positiveInteger(value, name, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new TypeError(`${name} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 128) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function requiredRevisionId(value) {
  if (typeof value !== "string" || !value.trim() || Array.from(value.trim()).length > 160) {
    throw new TypeError("review_revision payload.revisionId must be a non-empty string of at most 160 characters");
  }
  return value.trim();
}

function requiredCaseId(value) {
  if (typeof value !== "string" || !value.trim() || Array.from(value.trim()).length > 160) {
    throw new TypeError("analyze_case case_id must be a non-empty string of at most 160 characters");
  }
  return value.trim();
}

function optionalRevisionId(value) {
  return value == null ? null : requiredRevisionId(value);
}

function maintenanceHour(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("maintenance time must be a valid date");
  return date.toISOString().slice(0, 13);
}

function deferredTypes(value, handlers) {
  if (!Array.isArray(value)) throw new TypeError("deferredJobTypes must be an array");
  return [...new Set(value.filter((jobType) => {
    if (typeof jobType !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(jobType)) {
      throw new TypeError("deferredJobTypes entries must be lowercase tokens");
    }
    return !Object.hasOwn(handlers, jobType);
  }))];
}
