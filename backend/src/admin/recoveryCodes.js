import { createHmac, randomInt } from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_PATTERN = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/;

export function generateRecoveryCodes(count = 10) {
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new TypeError("Recovery code count must be between 1 and 100");
  }
  const codes = new Set();
  while (codes.size < count) codes.add(generateHumanCode());
  return [...codes];
}

export function generateBootstrapCode() {
  return generateHumanCode();
}

export function hashRecoveryCode(code, pepper = process.env.ADMIN_RECOVERY_PEPPER) {
  return pepperedHash("recovery", normalizeHumanCode(code), pepper);
}

export function hashBootstrapCode(code, pepper = process.env.ADMIN_RECOVERY_PEPPER) {
  return pepperedHash("bootstrap", normalizeHumanCode(code), pepper);
}

export function assertRecoveryPepper(pepper = process.env.ADMIN_RECOVERY_PEPPER) {
  if (typeof pepper !== "string" || pepper.trim() !== pepper ||
      Array.from(pepper).length < 32 || /[\u0000-\u001f\u007f]/u.test(pepper)) {
    const error = new Error("ADMIN_RECOVERY_PEPPER 必须显式设置且至少为 32 个字符");
    error.safeToDisplay = true;
    throw error;
  }
  return pepper;
}

function generateHumanCode() {
  let raw = "";
  for (let index = 0; index < 16; index += 1) {
    raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return raw.match(/.{4}/g).join("-");
}

function normalizeHumanCode(value) {
  if (typeof value !== "string") throw new TypeError("Invalid one-time code");
  const normalized = value.trim().toUpperCase();
  if (!CODE_PATTERN.test(normalized)) throw new TypeError("Invalid one-time code");
  return normalized;
}

function pepperedHash(domain, code, pepper) {
  const secret = assertRecoveryPepper(pepper);
  return createHmac("sha256", secret)
    .update(`zbt-admin-v1\n${domain}\n${code}`, "utf8")
    .digest("hex");
}
