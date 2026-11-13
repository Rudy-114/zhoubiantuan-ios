import express from "express";
import { canonicalChallengePayload, verifyDeviceSignature } from "./crypto.js";
import { consumeAdminChallenge, createAdminChallenge } from "./challengeService.js";
import {
  adminError,
  consumeRecoveryCode,
  createPendingDeviceRequest,
  deviceResponse,
  enrollRootDevice,
  hashDeviceShortCode,
  listAdminDevices,
  listPendingAdminDeviceRequests,
  loadApprovedAdminDevice,
  normalizeAdminUsername,
  resetAdminLoginFailures,
  sameSecretHash,
  validateAdminDeviceInput,
  verifyAdminPassword
} from "./deviceService.js";
import { recordAdminAuditEvent } from "./auditService.js";
import { createAdminSession, revokeAdminSession } from "./sessionService.js";
import { adminSessionCookieHeaders, clearAdminSessionCookieHeaders } from "./cookies.js";
import { requireAdminCSRF, requireAdminSession } from "./adminMiddleware.js";
import { withTransaction } from "../db.js";
import { createRateLimiter } from "../rateLimit.js";
import { assertRecoveryPepper } from "./recoveryCodes.js";

const GENERIC_AUTH_ERROR = "管理员凭据或设备验证失败";

export function createAdminAuthRouter() {
  const router = express.Router();
  const deviceRequestLimiter = adminLimiter("admin_device_request", 15 * 60 * 1000, 30);
  const challengeLimiter = adminLimiter("admin_challenge", 15 * 60 * 1000, 60);
  const loginLimiter = adminLimiter("admin_login", 15 * 60 * 1000, 30);
  const recoveryLimiter = adminLimiter("admin_recovery", 60 * 60 * 1000, 5);

  router.post("/auth/device-requests", deviceRequestLimiter, async (req, res, next) => {
    try {
      assertRecoveryPepper(process.env.ADMIN_RECOVERY_PEPPER);
      const device = validateAdminDeviceInput(req.body);
      const hasBootstrapCode = req.body?.bootstrapCode != null && req.body.bootstrapCode !== "";
      const result = await withTransaction(async (client) => {
        const verified = await verifyAdminPassword(client, req.body);
        if (!verified.ok) {
          await audit(client, req, {
            adminUserId: verified.admin?.id,
            eventType: "admin.device_request_failed",
            eventData: { outcome: "invalid_credentials" }
          });
          return { error: invalidAuth() };
        }
        try {
          if (hasBootstrapCode) {
            const enrolled = await enrollRootDevice(client, {
              admin: verified.admin,
              device,
              bootstrapCode: req.body.bootstrapCode,
              pepper: process.env.ADMIN_RECOVERY_PEPPER
            });
            await audit(client, req, {
              adminUserId: verified.admin.id,
              deviceId: device.id,
              eventType: "admin.root_enrolled",
              subjectType: "device",
              subjectId: device.id,
              eventData: { outcome: "approved", deviceIsRoot: true }
            });
            return { status: 201, body: { status: "approved", device: enrolled } };
          }
          const pending = await createPendingDeviceRequest(client, {
            admin: verified.admin,
            device,
            ip: req.ip,
            userAgent: req.headers["user-agent"],
            pepper: process.env.ADMIN_RECOVERY_PEPPER
          });
          await audit(client, req, {
            adminUserId: verified.admin.id,
            eventType: "admin.device_requested",
            subjectType: "device_request",
            subjectId: pending.requestId,
            eventData: { outcome: "pending" }
          });
          return {
            status: 202,
            body: {
              status: "pending",
              requestID: pending.requestId,
              shortCode: pending.shortCode,
              expiresAt: pending.expiresAt.toISOString()
            }
          };
        } catch (error) {
          if (!isClientError(error)) throw error;
          await audit(client, req, {
            adminUserId: verified.admin.id,
            eventType: "admin.device_request_failed",
            eventData: { outcome: error.apiCode }
          });
          return { error };
        }
      });
      if (result.error) throw result.error;
      return res.status(result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/challenges", challengeLimiter, async (req, res, next) => {
    if (req.body?.purpose !== "login") return next("route");
    try {
      const username = normalizeAdminUsername(req.body.username).normalized;
      const deviceId = requiredIdentifier(req.body.deviceID, "deviceID");
      const result = await withTransaction(async (client) => {
        const identity = await client.query(
          `SELECT au.id AS admin_user_id
           FROM admin_users au
           JOIN admin_devices device ON device.admin_user_id = au.id
           WHERE au.username_normalized = $1 AND au.status = 'active'
             AND device.id = $2 AND device.status = 'approved'`,
          [username, deviceId]
        );
        if (!identity.rows[0]) return { error: invalidAuth() };
        const challenge = await createAdminChallenge(client, {
          adminUserId: identity.rows[0].admin_user_id,
          deviceId,
          purpose: "login"
        });
        await audit(client, req, {
          adminUserId: identity.rows[0].admin_user_id,
          deviceId,
          eventType: "admin.challenge_created",
          subjectType: "challenge_purpose",
          subjectId: "login",
          eventData: { outcome: "created" }
        });
        return { challenge };
      });
      if (result.error) {
        await auditUnauthenticatedFailure(req, "admin.challenge_failed", "invalid_device");
        throw result.error;
      }
      return res.status(201).json(challengeResponse(result.challenge));
    } catch (error) {
      if (isClientError(error) && error.apiCode !== "admin_auth_invalid") return next(invalidAuth());
      next(error);
    }
  });

  router.post(
    "/auth/challenges",
    requireAdminSession,
    requireAdminCSRF,
    requireRoot,
    async (req, res, next) => {
      try {
        const purpose = req.body?.purpose;
        if (!["approve_device", "reject_device", "revoke_device"].includes(purpose)) {
          throw adminError(400, "admin_request_invalid", "挑战用途无效");
        }
        const targetId = requiredIdentifier(req.body.targetID, "targetID");
        const challenge = await withTransaction(async (client) => {
          const created = await createAdminChallenge(client, {
            adminUserId: req.adminUser.id,
            deviceId: req.adminDevice.id,
            purpose,
            targetId
          });
          await audit(client, req, {
            adminUserId: req.adminUser.id,
            deviceId: req.adminDevice.id,
            sessionId: req.adminSession.id,
            eventType: "admin.challenge_created",
            subjectType: purpose === "revoke_device" ? "device" : "device_request",
            subjectId: targetId,
            eventData: { outcome: purpose }
          });
          return created;
        });
        res.status(201).json(challengeResponse(challenge));
      } catch (error) {
        if (error?.apiCode === "invalid_admin_challenge") return next(invalidAuth());
        next(error);
      }
    }
  );

  router.post("/auth/login", loginLimiter, async (req, res, next) => {
    try {
      const deviceId = requiredIdentifier(req.body?.deviceID, "deviceID");
      const result = await withTransaction(async (client) => {
        const verified = await verifyAdminPassword(client, req.body);
        if (!verified.ok) {
          await audit(client, req, {
            adminUserId: verified.admin?.id,
            eventType: "admin.login_failed",
            eventData: { outcome: "invalid_credentials" }
          });
          return { error: invalidAuth() };
        }
        try {
          const device = await loadApprovedAdminDevice(client, {
            adminUserId: verified.admin.id,
            deviceId,
            lock: true
          });
          if (!device) throw invalidAuth();
          const challengeInput = loginChallengeInput(req.body, verified.admin.id, deviceId);
          const payload = canonicalChallengePayload({
            challengeId: challengeInput.challengeId,
            purpose: "login",
            nonce: challengeInput.nonce,
            targetId: ""
          });
          if (!verifyDeviceSignature({
            publicKeyJwk: device.public_key_jwk,
            payload,
            signature: req.body.signature
          })) throw invalidAuth();
          await consumeAdminChallenge(client, challengeInput);
          const session = await createAdminSession(client, {
            adminUserId: verified.admin.id,
            deviceId
          });
          await client.query("UPDATE admin_devices SET last_used_at = now() WHERE id = $1", [deviceId]);
          await resetAdminLoginFailures(client, verified.admin.id);
          await audit(client, req, {
            adminUserId: verified.admin.id,
            deviceId,
            sessionId: session.sessionId,
            eventType: "admin.login_succeeded",
            subjectType: "device",
            subjectId: deviceId,
            eventData: { outcome: "authenticated" }
          });
          return { admin: verified.admin, device, session };
        } catch (error) {
          if (!isClientError(error) && error?.apiCode !== "invalid_admin_challenge") throw error;
          await audit(client, req, {
            adminUserId: verified.admin.id,
            eventType: "admin.login_failed",
            eventData: { outcome: "invalid_device_proof" }
          });
          return { error: invalidAuth() };
        }
      });
      if (result.error) throw result.error;
      res.setHeader("Set-Cookie", adminSessionCookieHeaders({
        sessionToken: result.session.sessionToken,
        csrfToken: result.session.csrfToken,
        hostname: req.hostname
      }));
      res.json({ session: loginSessionResponse(result.admin, result.device, result.session) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/auth/session", requireAdminSession, (req, res) => {
    res.json({ session: middlewareSessionResponse(req) });
  });

  router.get("/auth/devices", requireAdminSession, requireRoot, async (req, res, next) => {
    try {
      const devices = await withTransaction((client) => listAdminDevices(client, req.adminUser.id));
      res.json({ devices });
    } catch (error) {
      next(error);
    }
  });

  router.get("/auth/device-requests", requireAdminSession, requireRoot, async (req, res, next) => {
    try {
      const requests = await withTransaction((client) => listPendingAdminDeviceRequests(client, req.adminUser.id));
      res.json({ requests });
    } catch (error) {
      next(error);
    }
  });

  for (const decision of ["approve", "reject"]) {
    router.post(
      `/auth/device-requests/:requestId/${decision}`,
      requireAdminSession,
      requireAdminCSRF,
      requireRoot,
      async (req, res, next) => {
        try {
          assertRecoveryPepper(process.env.ADMIN_RECOVERY_PEPPER);
          const requestId = requiredIdentifier(req.params.requestId, "requestID");
          const purpose = decision === "approve" ? "approve_device" : "reject_device";
          const reason = decision === "reject" ? requiredReason(req.body?.reason) : "";
          const result = await withTransaction(async (client) => {
            try {
              await client.query(
                "SELECT id FROM admin_users WHERE id = $1 FOR UPDATE",
                [req.adminUser.id]
              );
              const pending = await client.query(
                `SELECT * FROM admin_device_requests
                 WHERE id = $1 AND admin_user_id = $2 AND status = 'pending'
                   AND expires_at > now()
                 FOR UPDATE`,
                [requestId, req.adminUser.id]
              );
              const requestRow = pending.rows[0];
              if (!requestRow) {
                throw adminError(409, "admin_device_request_invalid", "设备申请已失效");
              }
              const suppliedShortHash = hashDeviceShortCode(
                req.body?.shortCode,
                process.env.ADMIN_RECOVERY_PEPPER
              );
              if (!sameSecretHash(requestRow.short_code_hash, suppliedShortHash)) {
                throw adminError(401, "admin_device_confirmation_invalid", "设备校验码无效");
              }
              const actorDevice = await loadApprovedAdminDevice(client, {
                adminUserId: req.adminUser.id,
                deviceId: req.adminDevice.id,
                lock: true
              });
              const challengeId = requiredIdentifier(req.body?.challengeID, "challengeID");
              const nonce = requiredText(req.body?.nonce, 256, "nonce");
              const payload = canonicalChallengePayload({
                challengeId,
                purpose,
                nonce,
                targetId: requestId
              });
              if (!actorDevice || !verifyDeviceSignature({
                publicKeyJwk: actorDevice.public_key_jwk,
                payload,
                signature: req.body?.signature
              })) throw invalidAuth();
              await consumeAdminChallenge(client, {
                challengeId,
                adminUserId: req.adminUser.id,
                deviceId: req.adminDevice.id,
                purpose,
                targetId: requestId,
                nonce
              });

              let approvedDevice = null;
              if (decision === "approve") {
                const collision = await client.query(
                  `SELECT 1 FROM admin_devices
                   WHERE id = $1 OR (admin_user_id = $2 AND fingerprint_hash = $3)
                   LIMIT 1`,
                  [requestRow.proposed_device_id, req.adminUser.id, requestRow.fingerprint_hash]
                );
                if (collision.rows[0]) {
                  throw adminError(409, "admin_device_invalid", "设备已注册或不可用");
                }
                await client.query(
                  `INSERT INTO admin_devices (
                     id, admin_user_id, display_name, public_key_jwk, fingerprint_hash,
                     is_root, approved_by_device_id
                   ) VALUES ($1, $2, $3, $4::jsonb, $5, false, $6)`,
                  [requestRow.proposed_device_id, req.adminUser.id, requestRow.display_name,
                    JSON.stringify(requestRow.public_key_jwk), requestRow.fingerprint_hash, req.adminDevice.id]
                );
                approvedDevice = {
                  id: requestRow.proposed_device_id,
                  name: requestRow.display_name
                };
              }
              if (decision === "approve") {
                await client.query(
                  `UPDATE admin_device_requests
                   SET status = 'approved', handled_by_device_id = $2, handled_at = now()
                   WHERE id = $1`,
                  [requestId, req.adminDevice.id]
                );
              } else {
                await client.query("DELETE FROM admin_device_requests WHERE id = $1", [requestId]);
              }
              await audit(client, req, {
                adminUserId: req.adminUser.id,
                deviceId: req.adminDevice.id,
                sessionId: req.adminSession.id,
                eventType: decision === "approve" ? "admin.device_approved" : "admin.device_rejected",
                subjectType: "device_request",
                subjectId: requestId,
                eventData: { outcome: decision, reason }
              });
              return { approvedDevice };
            } catch (error) {
              if (!isClientError(error) && error?.apiCode !== "invalid_admin_challenge") throw error;
              await audit(client, req, {
                adminUserId: req.adminUser.id,
                deviceId: req.adminDevice.id,
                sessionId: req.adminSession.id,
                eventType: "admin.device_decision_failed",
                subjectType: "device_request",
                subjectId: requestId,
                eventData: { outcome: error.apiCode || "invalid_challenge" }
              });
              return { error: error?.apiCode === "invalid_admin_challenge" ? invalidAuth() : error };
            }
          });
          if (result.error) throw result.error;
          if (decision === "approve") {
            return res.json({
              status: "approved",
              device: deviceResponse(result.approvedDevice, false)
            });
          }
          return res.json({ status: "rejected" });
        } catch (error) {
          next(error);
        }
      }
    );
  }

  router.post(
    "/auth/devices/:deviceId/revoke",
    requireAdminSession,
    requireAdminCSRF,
    requireRoot,
    async (req, res, next) => {
      try {
        const deviceId = requiredIdentifier(req.params.deviceId, "deviceID");
        const reason = requiredReason(req.body?.reason);
        if (deviceId === req.adminDevice.id) {
          throw adminError(409, "admin_device_revoke_invalid", "不能撤销当前根设备");
        }
        const result = await withTransaction(async (client) => {
          try {
            await client.query("SELECT id FROM admin_users WHERE id = $1 FOR UPDATE", [req.adminUser.id]);
            const actorDevice = await loadApprovedAdminDevice(client, {
              adminUserId: req.adminUser.id,
              deviceId: req.adminDevice.id,
              lock: true
            });
            const targetResult = await client.query(
              `SELECT id, display_name
               FROM admin_devices
               WHERE id = $1 AND admin_user_id = $2 AND status = 'approved' AND is_root = false
               FOR UPDATE`,
              [deviceId, req.adminUser.id]
            );
            const targetDevice = targetResult.rows[0];
            if (!actorDevice || !targetDevice) {
              throw adminError(409, "admin_device_revoke_invalid", "设备已撤销或不可撤销");
            }
            const challengeId = requiredIdentifier(req.body?.challengeID, "challengeID");
            const nonce = requiredText(req.body?.nonce, 256, "nonce");
            const purpose = "revoke_device";
            const payload = canonicalChallengePayload({
              challengeId,
              purpose,
              nonce,
              targetId: deviceId
            });
            if (!verifyDeviceSignature({
              publicKeyJwk: actorDevice.public_key_jwk,
              payload,
              signature: req.body?.signature
            })) throw invalidAuth();
            await consumeAdminChallenge(client, {
              challengeId,
              adminUserId: req.adminUser.id,
              deviceId: req.adminDevice.id,
              purpose,
              targetId: deviceId,
              nonce
            });
            await client.query(
              `UPDATE admin_devices SET status = 'revoked', revoked_at = now()
               WHERE id = $1`,
              [deviceId]
            );
            await client.query(
              `UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, now())
               WHERE admin_user_id = $1 AND device_id = $2`,
              [req.adminUser.id, deviceId]
            );
            await audit(client, req, {
              adminUserId: req.adminUser.id,
              deviceId: req.adminDevice.id,
              sessionId: req.adminSession.id,
              eventType: "admin.device_revoked",
              subjectType: "device",
              subjectId: deviceId,
              eventData: { outcome: "revoked", reason }
            });
            return { device: { id: targetDevice.id, name: targetDevice.display_name } };
          } catch (error) {
            if (!isClientError(error) && error?.apiCode !== "invalid_admin_challenge") throw error;
            await audit(client, req, {
              adminUserId: req.adminUser.id,
              deviceId: req.adminDevice.id,
              sessionId: req.adminSession.id,
              eventType: "admin.device_revoke_failed",
              subjectType: "device",
              subjectId: deviceId,
              eventData: { outcome: error.apiCode || "invalid_challenge" }
            });
            return { error: error?.apiCode === "invalid_admin_challenge" ? invalidAuth() : error };
          }
        });
        if (result.error) throw result.error;
        return res.json({
          status: "revoked",
          device: deviceResponse(result.device, false)
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post("/auth/recover", recoveryLimiter, async (req, res, next) => {
    try {
      assertRecoveryPepper(process.env.ADMIN_RECOVERY_PEPPER);
      const device = validateAdminDeviceInput(req.body);
      const result = await withTransaction(async (client) => {
        const verified = await verifyAdminPassword(client, req.body);
        if (!verified.ok) {
          await audit(client, req, {
            adminUserId: verified.admin?.id,
            eventType: "admin.recovery_failed",
            eventData: { outcome: "invalid_credentials" }
          });
          return { error: invalidAuth() };
        }
        try {
          await consumeRecoveryCode(client, {
            adminUserId: verified.admin.id,
            recoveryCode: req.body?.recoveryCode,
            pepper: process.env.ADMIN_RECOVERY_PEPPER
          });
          const collision = await client.query("SELECT 1 FROM admin_devices WHERE id = $1", [device.id]);
          if (collision.rows[0]) throw adminError(409, "admin_device_invalid", "新根设备不可用");
          await client.query(
            `UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, now())
             WHERE admin_user_id = $1`,
            [verified.admin.id]
          );
          await client.query(
            `UPDATE admin_devices
             SET status = 'revoked', revoked_at = COALESCE(revoked_at, now())
             WHERE admin_user_id = $1`,
            [verified.admin.id]
          );
          await client.query(
            `UPDATE admin_device_requests SET status = 'expired', handled_at = now()
             WHERE admin_user_id = $1 AND status = 'pending'`,
            [verified.admin.id]
          );
          await client.query(
            `INSERT INTO admin_devices (
               id, admin_user_id, display_name, public_key_jwk, fingerprint_hash, is_root
             ) VALUES ($1, $2, $3, $4::jsonb, $5, true)`,
            [device.id, verified.admin.id, device.name,
              JSON.stringify(device.publicKeyJwk), device.fingerprint]
          );
          await resetAdminLoginFailures(client, verified.admin.id);
          await audit(client, req, {
            adminUserId: verified.admin.id,
            deviceId: device.id,
            eventType: "admin.root_recovered",
            subjectType: "device",
            subjectId: device.id,
            eventData: { outcome: "recovered", deviceIsRoot: true }
          });
          return { device: deviceResponse(device, true) };
        } catch (error) {
          if (!isClientError(error)) throw error;
          if (error.apiCode === "admin_device_invalid") throw error;
          await audit(client, req, {
            adminUserId: verified.admin.id,
            eventType: "admin.recovery_failed",
            eventData: { outcome: error.apiCode }
          });
          return { error };
        }
      });
      if (result.error) throw result.error;
      res.json({ status: "recovered", device: result.device });
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/logout", requireAdminSession, requireAdminCSRF, async (req, res, next) => {
    try {
      await withTransaction(async (client) => {
        await revokeAdminSession(client, { sessionId: req.adminSession.id });
        await audit(client, req, {
          adminUserId: req.adminUser.id,
          deviceId: req.adminDevice.id,
          sessionId: req.adminSession.id,
          eventType: "admin.logout",
          subjectType: "session",
          subjectId: req.adminSession.id,
          eventData: { outcome: "revoked" }
        });
      });
      res.setHeader("Set-Cookie", clearAdminSessionCookieHeaders({ hostname: req.hostname }));
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function requireRoot(req, res, next) {
  if (!req.adminDevice?.isRoot) {
    return res.status(403).json({ error: "仅根设备可执行此操作", code: "admin_root_required" });
  }
  return next();
}

function adminLimiter(name, windowMs, max) {
  return createRateLimiter({
    name,
    store: "postgres",
    windowMs,
    max,
    message: "管理员认证请求过于频繁",
    apiCode: "admin_rate_limited",
    keyGenerator: (req) => `${req.ip}:${String(req.body?.username || "").trim().toLowerCase()}`
  });
}

async function audit(client, req, input) {
  return recordAdminAuditEvent(client, {
    ...input,
    ip: req.ip,
    userAgent: req.headers["user-agent"]
  });
}

async function auditUnauthenticatedFailure(req, eventType, outcome) {
  await withTransaction((client) => audit(client, req, { eventType, eventData: { outcome } }));
}

function challengeResponse(challenge) {
  return {
    challengeID: challenge.challengeId,
    purpose: challenge.purpose,
    targetID: challenge.targetId,
    nonce: challenge.nonce,
    expiresAt: challenge.expiresAt
  };
}

function loginChallengeInput(body, adminUserId, deviceId) {
  return {
    challengeId: requiredIdentifier(body?.challengeID, "challengeID"),
    adminUserId,
    deviceId,
    purpose: "login",
    targetId: "",
    nonce: requiredText(body?.nonce, 256, "nonce")
  };
}

function loginSessionResponse(admin, device, session) {
  return {
    adminID: admin.id,
    username: admin.username,
    deviceID: device.id,
    deviceName: device.display_name,
    isRoot: device.is_root,
    idleExpiresAt: session.idleExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt
  };
}

function middlewareSessionResponse(req) {
  return {
    adminID: req.adminUser.id,
    username: req.adminUser.username,
    deviceID: req.adminDevice.id,
    deviceName: req.adminDevice.displayName,
    isRoot: req.adminDevice.isRoot,
    idleExpiresAt: req.adminSession.idleExpiresAt.toISOString(),
    absoluteExpiresAt: req.adminSession.absoluteExpiresAt.toISOString()
  };
}

function requiredIdentifier(value, name) {
  if (typeof value !== "string" || !value || value !== value.trim() ||
      Array.from(value).length > 160 || !/^[A-Za-z0-9._:-]+$/u.test(value)) {
    throw adminError(400, "admin_request_invalid", `${name} 无效`);
  }
  return value;
}

function requiredText(value, limit, name) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() ||
      Array.from(value).length > limit || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw adminError(400, "admin_request_invalid", `${name} 无效`);
  }
  return value;
}

function requiredReason(value) {
  return requiredText(value, 500, "reason");
}

function invalidAuth() {
  return adminError(401, "admin_auth_invalid", GENERIC_AUTH_ERROR);
}

function isClientError(error) {
  return Boolean(error?.isAdminClientError || (error?.status >= 400 && error?.status < 500));
}
