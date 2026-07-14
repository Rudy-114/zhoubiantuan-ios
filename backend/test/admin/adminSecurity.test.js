import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { recordAdminAuditEvent } from "../../src/admin/auditService.js";
import { validateAdminDeviceInput } from "../../src/admin/deviceService.js";

process.env.ADMIN_RECOVERY_PEPPER = "test-admin-recovery-pepper-with-32-plus-characters";

test("rejects an exported private JWK instead of silently accepting leaked key material", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateJwk = privateKey.export({ format: "jwk" });
  assert.ok(privateJwk.d);

  assert.throws(() => validateAdminDeviceInput({
    deviceID: "device-private-key",
    displayName: "Private Key Device",
    publicKeyJWK: privateJwk
  }), (error) => error?.status === 400 && error?.apiCode === "admin_request_invalid");
  assert.throws(() => validateAdminDeviceInput(null), (error) => {
    return error?.status === 400 && error?.apiCode === "admin_request_invalid";
  });
});

test("audit events hash IPs, coarsen user agents, and drop secret-shaped metadata", async () => {
  let captured;
  const client = {
    async query(text, params) {
      captured = { text, params };
      return { rows: [{ id: 1, created_at: new Date() }] };
    }
  };
  await recordAdminAuditEvent(client, {
    eventType: "admin.test",
    subjectType: "device",
    subjectId: "device-1",
    ip: "127.0.0.1",
    userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0",
    eventData: {
      outcome: "approved",
      signature: "must-not-persist",
      nonceValue: "must-not-persist",
      passwordHint: "must-not-persist",
      shortCode: "ABC123"
    }
  });

  assert.match(captured.text, /INSERT INTO admin_audit_events/);
  assert.match(captured.params[6], /^[a-f0-9]{64}$/);
  assert.notEqual(captured.params[6], "127.0.0.1");
  assert.equal(captured.params[7], "Chrome / macOS");
  assert.deepEqual(JSON.parse(captured.params[8]), { outcome: "approved" });
  assert.doesNotMatch(JSON.stringify(captured), /must-not-persist|ABC123/);
});
