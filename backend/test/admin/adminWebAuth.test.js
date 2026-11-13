import assert from "node:assert/strict";
import test from "node:test";
import { AdminAPIError, adminFetch } from "../../admin-web/api.js";
import { canonicalChallengePayload } from "../../admin-web/deviceKeys.js";

test("surfaces structured admin API errors as readable messages", async () => {
  const originalLocation = globalThis.location;
  const originalFetch = globalThis.fetch;
  globalThis.location = { origin: "https://admin.example" };
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      code: "TEMPORARY_UNAVAILABLE",
      message: "AI 健康状态暂时不可用"
    }
  }), {
    status: 503,
    headers: { "content-type": "application/json" }
  });

  try {
    await assert.rejects(
      adminFetch("/admin/api/ai-health"),
      (error) => {
        assert.equal(error instanceof AdminAPIError, true);
        assert.equal(error.message, "AI 健康状态暂时不可用");
        assert.equal(error.code, "TEMPORARY_UNAVAILABLE");
        assert.equal(error.status, 503);
        return true;
      }
    );
  } finally {
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
    globalThis.fetch = originalFetch;
  }
});

test("builds the exact browser challenge payload expected by the server", () => {
  assert.equal(
    canonicalChallengePayload({
      challengeID: "challenge-1",
      purpose: "approve_device",
      nonce: "nonce-value",
      targetID: "request-1"
    }),
    "zbt-admin-v1\nchallenge-1\napprove_device\nnonce-value\nrequest-1"
  );
  assert.equal(
    canonicalChallengePayload({
      challengeID: "challenge-login",
      purpose: "login",
      nonce: "login-nonce"
    }),
    "zbt-admin-v1\nchallenge-login\nlogin\nlogin-nonce\n"
  );
  assert.equal(
    canonicalChallengePayload({
      challengeID: "challenge-revoke",
      purpose: "revoke_device",
      nonce: "revoke-nonce",
      targetID: "device-second"
    }),
    "zbt-admin-v1\nchallenge-revoke\nrevoke_device\nrevoke-nonce\ndevice-second"
  );
});

test("rejects malformed challenge metadata before signing", () => {
  assert.throws(
    () => canonicalChallengePayload({
      challengeID: "challenge-1\nforged",
      purpose: "login",
      nonce: "nonce"
    }),
    /挑战数据无效/u
  );
  assert.throws(
    () => canonicalChallengePayload({ challengeID: "", purpose: "login", nonce: "nonce" }),
    /挑战数据无效/u
  );
});
