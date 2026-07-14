import assert from "node:assert/strict";
import test from "node:test";
import { canonicalChallengePayload } from "../../admin-web/deviceKeys.js";

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
