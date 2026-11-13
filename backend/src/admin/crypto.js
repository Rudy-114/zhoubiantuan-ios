import { createHash, createPublicKey, verify } from "node:crypto";

export function canonicalChallengePayload({ challengeId, purpose, nonce, targetId = "" } = {}) {
  const fields = [
    requiredString(challengeId, "challengeId", 160),
    requiredString(purpose, "purpose", 40),
    requiredString(nonce, "nonce", 256),
    optionalString(targetId, "targetId", 160)
  ];
  return Buffer.from(["zbt-admin-v1", ...fields].join("\n"), "utf8");
}

export function publicKeyFingerprint(jwk) {
  const key = validatedP256Jwk(jwk);
  const canonical = JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y });
  return createHash("sha256").update(canonical).digest("hex");
}

export function verifyDeviceSignature({ publicKeyJwk, payload, signature } = {}) {
  try {
    const key = validatedP256Jwk(publicKeyJwk);
    if (!Buffer.isBuffer(payload)) return false;
    const signatureBytes = strictBase64url(signature);
    if (signatureBytes.length !== 64) return false;
    const publicKey = createPublicKey({ key, format: "jwk" });
    return verify("sha256", payload, {
      key: publicKey,
      dsaEncoding: "ieee-p1363"
    }, signatureBytes);
  } catch {
    return false;
  }
}

function validatedP256Jwk(value) {
  if (!isPlainObject(value) || value.kty !== "EC" || value.crv !== "P-256" ||
      strictBase64url(value.x).length !== 32 || strictBase64url(value.y).length !== 32 ||
      (value.key_ops !== undefined &&
        (!Array.isArray(value.key_ops) || !value.key_ops.includes("verify")))) {
    throw new TypeError("A valid P-256 public key is required");
  }
  return value;
}

function strictBase64url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("Invalid base64url value");
  }
  const decoded = Buffer.from(value, "base64url");
  if (!decoded.length || decoded.toString("base64url") !== value) {
    throw new TypeError("Invalid base64url value");
  }
  return decoded;
}

function requiredString(value, name, limit) {
  if (typeof value !== "string" || !value || Array.from(value).length > limit || /[\r\n\u0000]/u.test(value)) {
    throw new TypeError(`${name} must be a non-empty single-line string`);
  }
  return value;
}

function optionalString(value, name, limit) {
  if (value == null) return "";
  if (typeof value !== "string" || Array.from(value).length > limit || /[\r\n\u0000]/u.test(value)) {
    throw new TypeError(`${name} must be a single-line string`);
  }
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
