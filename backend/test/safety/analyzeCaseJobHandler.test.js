import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyzeCaseJobHandler } from "../../src/safety/jobWorker.js";

test("retryable AI failures fail the durable job while settled failures complete", async () => {
  const notifications = [];
  const retryableHandler = createAnalyzeCaseJobHandler({
    analyzeSafetyCase: async () => ({
      status: "failed",
      reason: "qwen_timeout",
      retryable: true,
      providerCalled: true,
      syncEvents: [{ id: "must-not-notify" }]
    }),
    notifySyncEvents: async (events) => { notifications.push(events); }
  });

  await assert.rejects(
    retryableHandler({ case_id: "case-retry", payload: {} }),
    (error) => {
      assert.equal(error.code, "SAFETY_AI_RETRYABLE");
      assert.doesNotMatch(error.message, /qwen|timeout|provider/i);
      return true;
    }
  );
  assert.deepEqual(notifications, []);

  const settledHandler = createAnalyzeCaseJobHandler({
    analyzeSafetyCase: async () => ({
      status: "failed",
      reason: "qwen_not_configured",
      retryable: false,
      providerCalled: true,
      syncEvents: []
    }),
    notifySyncEvents: async () => assert.fail("settled failure must not notify")
  });
  assert.equal((await settledHandler({ case_id: "case-settled", payload: {} })).retryable, false);
});
