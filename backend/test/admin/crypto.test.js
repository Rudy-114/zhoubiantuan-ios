import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  canonicalChallengePayload,
  publicKeyFingerprint,
  verifyDeviceSignature
} from "../../src/admin/crypto.js";

test("verifies an IEEE-P1363 P-256 signature over canonical challenge bytes", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyJwk = publicKey.export({ format: "jwk" });
  const payload = canonicalChallengePayload({
    challengeId: "ch-1",
    purpose: "login",
    nonce: "nonce-value",
    targetId: "device-1"
  });
  const signature = sign("sha256", payload, {
    key: privateKey,
    dsaEncoding: "ieee-p1363"
  }).toString("base64url");

  assert.equal(
    payload.toString("utf8"),
    "zbt-admin-v1\nch-1\nlogin\nnonce-value\ndevice-1"
  );
  assert.equal(verifyDeviceSignature({ publicKeyJwk, payload, signature }), true);
  assert.equal(verifyDeviceSignature({
    publicKeyJwk,
    payload: Buffer.from("changed"),
    signature
  }), false);
});

test("fingerprints only strict P-256 verify keys in canonical field order", () => {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const reordered = { y: jwk.y, x: jwk.x, crv: jwk.crv, kty: jwk.kty };

  assert.equal(publicKeyFingerprint(jwk), publicKeyFingerprint(reordered));
  assert.match(publicKeyFingerprint(jwk), /^[a-f0-9]{64}$/);
  assert.equal(publicKeyFingerprint({ ...jwk, key_ops: ["verify"] }), publicKeyFingerprint(jwk));

  for (const invalid of [
    null,
    [],
    { ...jwk, kty: "RSA" },
    { ...jwk, crv: "P-384" },
    { ...jwk, x: "AA" },
    { ...jwk, y: "AA" },
    { ...jwk, key_ops: ["sign"] },
    { ...jwk, key_ops: "verify" }
  ]) {
    assert.throws(() => publicKeyFingerprint(invalid), /P-256 public key/i);
  }
});

test("signature verification fails closed for malformed keys, payloads, and signatures", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyJwk = publicKey.export({ format: "jwk" });
  const payload = canonicalChallengePayload({
    challengeId: "ch-2",
    purpose: "approve_device",
    nonce: "nonce-two",
    targetId: "request-2"
  });
  const signature = sign("sha256", payload, {
    key: privateKey,
    dsaEncoding: "ieee-p1363"
  }).toString("base64url");

  assert.equal(verifyDeviceSignature({ publicKeyJwk: { ...publicKeyJwk, x: "AA" }, payload, signature }), false);
  assert.equal(verifyDeviceSignature({ publicKeyJwk, payload: "not-a-buffer", signature }), false);
  assert.equal(verifyDeviceSignature({ publicKeyJwk, payload, signature: "not*base64url" }), false);
  assert.equal(verifyDeviceSignature({ publicKeyJwk, payload, signature: signature.slice(1) }), false);
  assert.throws(
    () => canonicalChallengePayload({ challengeId: "", purpose: "login", nonce: "nonce" }),
    /challengeId/
  );
});
