import assert from "node:assert/strict";
import test from "node:test";
import { createMaintenanceJobHandlers } from "../../src/safety/jobWorker.js";

test("low-risk maintenance notifies committed sync events and sanitizes notifier failures", async () => {
  let committed = false;
  const notifications = [];
  const logs = [];
  const handlers = createMaintenanceJobHandlers({
    withTransaction: async (callback) => {
      const result = await callback({
        query: async () => ({ rows: [{ locked: true }] })
      });
      committed = true;
      return result;
    },
    processCorrectionDeadlines: async () => ({ processed: 0 }),
    closeLowRiskCases: async () => ({
      processed: 1,
      syncEvents: [{ id: "sync-low-risk" }]
    }),
    clearExpiredEvidence: async () => ({ processed: 0, objectKeys: [] }),
    deidentifyExpiredAudit: async () => ({ deidentified: 0, deleted: 0 }),
    notifySyncEvents: async (events) => {
      notifications.push({ committed, events });
      throw new Error("Bearer private-notifier-value");
    },
    eventLogger: {
      error(event, fields) { logs.push({ event, fields }); }
    }
  });

  const result = await handlers.maintenance_low_risk_cases({});

  assert.equal(result.processed, 1);
  assert.deepEqual(notifications, [{
    committed: true,
    events: [{ id: "sync-low-risk" }]
  }]);
  assert.deepEqual(logs, [{
    event: "safety_worker.maintenance_low_risk_notify_failed",
    fields: { errorCode: "MAINTENANCE_LOW_RISK_NOTIFY_FAILED" }
  }]);
  assert.doesNotMatch(JSON.stringify(logs), /private-notifier-value|Bearer/);
});
