import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createReviewRevisionJobHandler } from "../../src/safety/jobWorker.js";
import { createSafetyServerRuntime } from "../../src/server.js";

test("documents report upload and supplement abuse defaults with the final migration order", async () => {
  const [environmentExample, deploymentPlan] = await Promise.all([
    readFile(new URL("../../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/superpowers/plans/2026-07-10-08-enforcement-deployment.md", import.meta.url), "utf8")
  ]);
  const defaults = [
    "SAFETY_REPORT_UPLOAD_OUTSTANDING_MAX=24",
    "SAFETY_REPORT_UPLOAD_ACCOUNT_MAX_24H=60",
    "SAFETY_REPORT_SUPPLEMENT_ACCOUNT_MAX_24H=40",
    "SAFETY_REPORT_SUPPLEMENT_IP_MAX_24H=120",
    "SAFETY_REPORT_SUPPLEMENT_BURST_MAX_MINUTE=10"
  ];

  for (const setting of defaults) {
    assert.match(environmentExample, new RegExp(`^${setting}$`, "m"));
    assert.ok(deploymentPlan.includes(setting));
  }
  assert.match(
    deploymentPlan,
    /013, core off, intake on\/AI off, iOS, 014 report-upload cleanup, 015 content remediation, 016 admin auth, admin web\/root, 017 safety AI/
  );
});

test("feature-off runtime starts only the report upload cleanup worker", async () => {
  let workerOptions;
  const runtime = createRuntime({
    safety: { enabled: false, aiMode: "off" },
    startSafetyWorker(options) {
      workerOptions = options;
      return { stop: async () => {} };
    }
  });

  await runtime.start({ port: 0, host: "127.0.0.1" });
  try {
    assert.deepEqual(Object.keys(workerOptions?.handlers || {}), ["cleanup_report_upload"]);
    assert.deepEqual(workerOptions?.deferredJobTypes, ["analyze_case", "review_revision", "case_received"]);
  } finally {
    await runtime.shutdown("test");
  }
});

test("worker starts only after HTTP listen and AI-off case_received moves the case to manual review", async () => {
  let runtime;
  let workerOptions;
  let workerStartedWhileListening = false;
  const updates = [];
  runtime = createRuntime({
    safety: { enabled: true, aiMode: "off" },
    startSafetyWorker(options) {
      workerOptions = options;
      workerStartedWhileListening = runtime.server.listening;
      return { stop: async () => {} };
    },
    withTransaction: async (callback) => callback({
      query: async (sql, params) => {
        updates.push({ sql, params });
        return { rowCount: 1 };
      }
    })
  });

  assert.equal(workerOptions, undefined);
  await runtime.start({ port: 0, host: "127.0.0.1" });
  assert.ok(workerOptions);
  assert.equal(workerStartedWhileListening, true);
  await workerOptions.handlers.case_received({ case_id: "case-off" });
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /status = 'manual_review'/);
  assert.deepEqual(updates[0].params, ["case-off"]);
  await runtime.shutdown("test");
});

test("non-off case_received idempotently enqueues pending analyze_case without a provider handler", async () => {
  let workerOptions;
  const jobs = new Map();
  const runtime = createRuntime({
    safety: { enabled: true, aiMode: "shadow" },
    startSafetyWorker(options) {
      workerOptions = options;
      return { stop: async () => {} };
    },
    enqueueSafetyJob: async (_client, input) => {
      if (!jobs.has(input.uniqueKey)) jobs.set(input.uniqueKey, { ...input, status: "pending" });
      return jobs.get(input.uniqueKey);
    }
  });

  await runtime.start({ port: 0, host: "127.0.0.1" });
  await workerOptions.handlers.case_received({ case_id: "case-shadow" });
  await workerOptions.handlers.case_received({ case_id: "case-shadow" });
  assert.deepEqual([...jobs.values()], [{
    type: "analyze_case",
    caseId: "case-shadow",
    uniqueKey: "analyze_case:case-shadow",
    payload: {},
    status: "pending"
  }]);
  assert.deepEqual(workerOptions.deferredJobTypes, ["analyze_case"]);
  assert.equal(workerOptions.handlers.analyze_case, undefined);
  assert.equal(typeof workerOptions.handlers.review_revision, "function");
  await runtime.shutdown("test");
});

test("review revision handler validates payload and notifies realtime only after commit", async () => {
  let transactionCalls = 0;
  let committed = false;
  const notifications = [];
  const handler = createReviewRevisionJobHandler({
    withTransaction: async (callback) => {
      transactionCalls += 1;
      const result = await callback({ query: async () => ({}) });
      committed = true;
      return result;
    },
    reviewContentRevision: async (_client, input) => ({
      published: false,
      revisionId: input.revisionId,
      syncEvents: [{ id: "sync-1" }]
    }),
    notifySyncEvents(events) {
      notifications.push({ committed, events });
    }
  });

  await assert.rejects(handler({ payload: {} }), /revisionId/);
  assert.equal(transactionCalls, 0);
  const result = await handler({ payload: { revisionId: "revision-1" } });
  assert.equal(result.revisionId, "revision-1");
  assert.deepEqual(notifications, [{ committed: true, events: [{ id: "sync-1" }] }]);
});

test("review revision notifier failures are sanitized and do not fail durable retries", async () => {
  let reviewCalls = 0;
  let notifyCalls = 0;
  const logs = [];
  const handler = createReviewRevisionJobHandler({
    withTransaction: async (callback) => callback({ query: async () => ({}) }),
    reviewContentRevision: async () => {
      reviewCalls += 1;
      return reviewCalls === 1
        ? { unchanged: false, syncEvents: [{ id: "sync-notify" }] }
        : { unchanged: true, syncEvents: [] };
    },
    async notifySyncEvents() {
      notifyCalls += 1;
      throw new Error("Authorization: Bearer raw-notifier-secret");
    },
    eventLogger: {
      error(event, fields) { logs.push({ event, fields }); }
    }
  });

  const first = await handler({ payload: { revisionId: "revision-retry" } });
  const second = await handler({ payload: { revisionId: "revision-retry" } });

  assert.equal(first.unchanged, false);
  assert.equal(second.unchanged, true);
  assert.equal(reviewCalls, 2);
  assert.equal(notifyCalls, 1);
  assert.deepEqual(logs, [{
    event: "safety_worker.review_revision_notify_failed",
    fields: { errorCode: "REVIEW_REVISION_NOTIFY_FAILED" }
  }]);
  assert.doesNotMatch(JSON.stringify(logs), /raw-notifier-secret|Bearer/);
});

test("feature-on runtime wires review_revision through injected transaction and notifier", async () => {
  let workerOptions;
  const calls = [];
  const runtime = createRuntime({
    safety: { enabled: true, aiMode: "off" },
    startSafetyWorker(options) {
      workerOptions = options;
      return { stop: async () => {} };
    },
    reviewContentRevision: async (_client, input) => {
      calls.push(["review", input.revisionId]);
      return { syncEvents: [{ id: "sync-runtime" }] };
    },
    notifySyncEvents(events) {
      calls.push(["notify", events[0].id]);
    }
  });

  await runtime.start({ port: 0, host: "127.0.0.1" });
  try {
    assert.equal(typeof workerOptions.handlers.review_revision, "function");
    assert.deepEqual(workerOptions.deferredJobTypes, ["analyze_case"]);
    await workerOptions.handlers.review_revision({ payload: { revisionId: "revision-runtime" } });
    assert.deepEqual(calls, [["review", "revision-runtime"], ["notify", "sync-runtime"]]);
  } finally {
    await runtime.shutdown("test");
  }
});

test("cleanup report upload worker deletes only unattached objects and retries deletion failures", async () => {
  let workerOptions;
  const attached = new Set(["report/u-reporter/2026-07-12/attached.jpg"]);
  const deleted = [];
  const runtime = createRuntime({
    safety: { enabled: true, aiMode: "off" },
    startSafetyWorker(options) {
      workerOptions = options;
      return { stop: async () => {} };
    },
    cleanupReportUpload: async (objectKey, { deleteObject }) => {
      if (attached.has(objectKey)) return "preserve";
      await deleteObject(objectKey);
    },
    deleteReportUpload: async (objectKey) => {
      if (objectKey.endsWith("retry.jpg")) throw new Error("delete unavailable");
      deleted.push(objectKey);
    }
  });

  await runtime.start({ port: 0, host: "127.0.0.1" });
  try {
    const handler = workerOptions.handlers.cleanup_report_upload;
    assert.equal(typeof handler, "function");
    await handler({ payload: { objectKey: "report/u-reporter/2026-07-12/unattached.jpg" } });
    await handler({ payload: { objectKey: "report/u-reporter/2026-07-12/attached.jpg" } });
    await assert.rejects(
      handler({ payload: { objectKey: "report/u-reporter/2026-07-12/retry.jpg" } }),
      /delete unavailable/
    );
    assert.deepEqual(deleted, ["report/u-reporter/2026-07-12/unattached.jpg"]);
  } finally {
    await runtime.shutdown("test");
  }
});

test("shutdown is ordered and repeated signals share cleanup while listeners stay active", async () => {
  const events = [];
  const signals = new EventEmitter();
  const workerStop = deferred();
  let stopCalls = 0;
  const runtime = createRuntime({
    safety: { enabled: true, aiMode: "off" },
    events,
    startSafetyWorker() {
      return {
        stop() {
          stopCalls += 1;
          events.push("worker");
          return workerStop.promise;
        }
      };
    }
  });
  runtime.installSignalHandlers(signals);
  await runtime.start({ port: 0, host: "127.0.0.1" });

  signals.emit("SIGTERM");
  await waitFor(() => stopCalls === 1);
  assert.equal(signals.listenerCount("SIGTERM"), 1);
  assert.equal(signals.listenerCount("SIGINT"), 1);
  signals.emit("SIGINT");
  assert.equal(stopCalls, 1);
  workerStop.resolve();
  await runtime.shutdown("test");

  assert.deepEqual(events, ["http", "worker", "rate-pruner", "sync-pruner", "realtime", "pool"]);
});

test("listen failure cleans up runtime resources before rejecting and never starts a worker", async () => {
  const events = [];
  const failingServer = new EventEmitter();
  failingServer.listening = false;
  failingServer.listen = () => {
    queueMicrotask(() => failingServer.emit("error", new Error("listen failed")));
  };
  failingServer.close = (callback) => callback();
  let workerStarts = 0;
  const runtime = createRuntime({
    events,
    createHttpServer: () => failingServer,
    startSafetyWorker() {
      workerStarts += 1;
      return { stop: async () => {} };
    }
  });

  await assert.rejects(runtime.start(), /listen failed/);
  assert.equal(workerStarts, 0);
  assert.deepEqual(events, ["http", "rate-pruner", "sync-pruner", "realtime", "pool"]);
});

test("concurrent starts share one listen and create one worker", async () => {
  const server = controllableServer();
  let workerStarts = 0;
  const runtime = createRuntime({
    createHttpServer: () => server,
    startSafetyWorker() {
      workerStarts += 1;
      return { stop: async () => {} };
    }
  });

  const first = runtime.start();
  const second = runtime.start();
  assert.strictEqual(first, second);
  assert.equal(server.listenCalls, 1);
  server.succeedListen();
  await Promise.all([first, second]);
  assert.equal(workerStarts, 1);
  await runtime.shutdown("test");
});

test("shutdown during listen prevents worker creation and future starts", async () => {
  const events = [];
  const server = controllableServer();
  let workerStarts = 0;
  const runtime = createRuntime({
    events,
    createHttpServer: () => server,
    startSafetyWorker() {
      workerStarts += 1;
      return { stop: async () => {} };
    }
  });

  const starting = runtime.start();
  const stopping = runtime.shutdown("test");
  server.succeedListen();
  await assert.rejects(starting, /stopping|stopped/i);
  await stopping;
  assert.equal(workerStarts, 0);
  assert.equal(server.closeCalls, 1);
  await assert.rejects(runtime.start(), /stopped/i);
  assert.deepEqual(events, ["http", "rate-pruner", "sync-pruner", "realtime", "pool"]);
});

test("worker construction errors clean up and preserve the startup error", async () => {
  const events = [];
  const server = controllableServer();
  const runtime = createRuntime({
    events,
    createHttpServer: () => server,
    startSafetyWorker() {
      throw new Error("worker construction failed");
    }
  });

  const starting = runtime.start();
  server.succeedListen();
  await assert.rejects(starting, /worker construction failed/);
  assert.equal(server.closeCalls, 1);
  assert.deepEqual(events, ["http", "rate-pruner", "sync-pruner", "realtime", "pool"]);
});

test("direct shutdown exposes and shares cleanup failures", async () => {
  const runtime = createRuntime({
    safety: { enabled: true, aiMode: "off" },
    startSafetyWorker: () => ({ stop: async () => { throw new Error("cleanup failed"); } })
  });
  await runtime.start({ port: 0, host: "127.0.0.1" });

  const first = runtime.shutdown("test");
  const second = runtime.shutdown("test");
  assert.strictEqual(first, second);
  await assert.rejects(first, /cleanup failed/);
});

test("signal cleanup failures set exit state and log only a generic code", async () => {
  const logs = [];
  const signals = new EventEmitter();
  let exitMarks = 0;
  const runtime = createRuntime({
    safety: { enabled: true, aiMode: "off" },
    startSafetyWorker: () => ({ stop: async () => { throw new Error("raw cleanup detail"); } }),
    logger: { info() {}, error(event, fields) { logs.push({ event, fields }); } },
    markProcessExit() { exitMarks += 1; }
  });
  runtime.installSignalHandlers(signals);
  await runtime.start({ port: 0, host: "127.0.0.1" });

  signals.emit("SIGTERM");
  await waitFor(() => logs.length === 1);
  assert.equal(exitMarks, 1);
  assert.deepEqual(logs, [{ event: "server.shutdown_failed", fields: { errorCode: "SERVER_SHUTDOWN_FAILED" } }]);
  assert.doesNotMatch(JSON.stringify(logs), /raw|detail/i);
  await assert.rejects(runtime.shutdown("test"), /raw cleanup detail/);
});

function createRuntime({ safety = { enabled: true, aiMode: "off" }, events = [], ...overrides } = {}) {
  return createSafetyServerRuntime({
    app: (_request, response) => response.end(),
    runtimeConfig: { port: 0, safety },
    attachRealtime: () => ({ close: async () => { events.push("realtime"); } }),
    startRateLimitEventPruner: () => "rate-handle",
    startSyncEventPruner: () => "sync-handle",
    clearInterval(handle) {
      events.push(handle === "rate-handle" ? "rate-pruner" : "sync-pruner");
    },
    closeHttpServer: async (server) => {
      events.push("http");
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
    pool: { end: async () => { events.push("pool"); } },
    logger: { info() {}, error() {} },
    withTransaction: async (callback) => callback({ query: async () => ({ rowCount: 1 }) }),
    enqueueSafetyJob: async () => {},
    startSafetyWorker: () => ({ stop: async () => {} }),
    markProcessExit() {},
    ...overrides
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

function controllableServer() {
  const server = new EventEmitter();
  server.listening = false;
  server.listenCalls = 0;
  server.closeCalls = 0;
  server.listen = (_port, _host, callback) => {
    server.listenCalls += 1;
    server.listenCallback = callback;
  };
  server.succeedListen = () => {
    server.listening = true;
    server.listenCallback();
  };
  server.close = (callback) => {
    server.closeCalls += 1;
    server.listening = false;
    callback();
  };
  return server;
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("timed out waiting for lifecycle result");
}
