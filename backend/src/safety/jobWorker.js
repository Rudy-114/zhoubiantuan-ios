import { claimSafetyJobs, completeSafetyJob, failSafetyJob, releaseSafetyJob, sanitizeSafetyJobError } from "./jobQueue.js";
import { logger } from "../logger.js";

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

function deferredTypes(value, handlers) {
  if (!Array.isArray(value)) throw new TypeError("deferredJobTypes must be an array");
  return [...new Set(value.filter((jobType) => {
    if (typeof jobType !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(jobType)) {
      throw new TypeError("deferredJobTypes entries must be lowercase tokens");
    }
    return !Object.hasOwn(handlers, jobType);
  }))];
}
