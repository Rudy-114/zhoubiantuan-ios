import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSafetyCase } from "../../src/safety/aiService.js";
import { rollbackSafetyAction } from "../../src/safety/actionService.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";
import {
  ACTORS,
  E2E_AI_CONFIG,
  E2E_NOW,
  TARGETS,
  adminCase,
  adminDecision,
  cookiesFrom,
  deviceKeyPair,
  passModeration,
  qwenProvider,
  qwenResult,
  requestJSON,
  seedAdminBootstrap,
  seedLifecycleActors,
  signedChallengeBody,
  transaction,
  withE2EServer
} from "./helpers.js";

const credentials = Object.freeze({
  username: "RootAdminE2E",
  password: "Synthetic admin password 2026",
  bootstrapCode: "BCDF-GHJK-MNPQ-RSTW",
  recoveryCode: "WXYZ-2345-6789-BCDF",
  pepper: "synthetic-e2e-recovery-pepper-with-32-characters"
});

process.env.ADMIN_RECOVERY_PEPPER = credentials.pepper;

test.beforeEach(async () => {
  await resetDatabase();
  await seedLifecycleActors();
  await seedAdminBootstrap(credentials);
});
test.after(closeDatabase);

test("requires signed root approval, preserves human authority, bounds appeals, and revokes sessions on recovery", async () => {
  await withE2EServer(async (baseUrl) => {
    const rootKey = deviceKeyPair();
    const rootEnrollment = await requestJSON(baseUrl, "/admin/api/auth/device-requests", {
      method: "POST",
      body: {
        username: credentials.username,
        password: credentials.password,
        deviceID: "e2e-auth-root",
        displayName: "E2E root browser",
        publicKeyJWK: rootKey.jwk,
        bootstrapCode: credentials.bootstrapCode
      }
    });
    assert.equal(rootEnrollment.status, 201);
    const rootCookies = await login(baseUrl, "e2e-auth-root", rootKey.privateKey);

    const secondKey = deviceKeyPair();
    const pending = await requestJSON(baseUrl, "/admin/api/auth/device-requests", {
      method: "POST",
      body: {
        username: credentials.username,
        password: credentials.password,
        deviceID: "e2e-auth-second",
        displayName: "E2E second browser",
        publicKeyJWK: secondKey.jwk
      }
    });
    assert.equal(pending.status, 202);
    assert.equal(pending.body.status, "pending");
    const passwordOnlyLogin = await requestJSON(baseUrl, "/admin/api/auth/challenges", {
      method: "POST",
      body: {
        username: credentials.username,
        deviceID: "e2e-auth-second",
        purpose: "login"
      }
    });
    assert.equal(passwordOnlyLogin.status, 401);

    const approvalChallenge = await rootChallenge(
      baseUrl,
      rootCookies,
      "approve_device",
      pending.body.requestID
    );
    const approved = await requestJSON(
      baseUrl,
      `/admin/api/auth/device-requests/${pending.body.requestID}/approve`,
      {
        method: "POST",
        cookies: rootCookies,
        csrf: rootCookies.get("zbt_admin_csrf"),
        body: signedChallengeBody(approvalChallenge, rootKey.privateKey, {
          shortCode: pending.body.shortCode
        })
      }
    );
    assert.equal(approved.status, 200);
    const secondCookies = await login(baseUrl, "e2e-auth-second", secondKey.privateKey);

    await proveAppealBoundary(baseUrl, rootCookies);
    await proveHumanAuthorityBoundary(baseUrl, rootCookies);

    const activeBeforeRecovery = await pool.query(
      `SELECT count(*)::int AS count FROM admin_sessions
       WHERE admin_user_id = 'e2e-auth-admin' AND revoked_at IS NULL`
    );
    assert.equal(activeBeforeRecovery.rows[0].count, 2);
    assert.equal((await requestJSON(baseUrl, "/admin/api/auth/session", {
      cookies: secondCookies
    })).status, 200);

    const recoveryKey = deviceKeyPair();
    const recovered = await requestJSON(baseUrl, "/admin/api/auth/recover", {
      method: "POST",
      body: {
        username: credentials.username,
        password: credentials.password,
        recoveryCode: credentials.recoveryCode,
        deviceID: "e2e-auth-recovered-root",
        displayName: "E2E recovered root",
        publicKeyJWK: recoveryKey.jwk
      }
    });
    assert.equal(recovered.status, 200);
    assert.equal((await requestJSON(baseUrl, "/admin/api/auth/session", {
      cookies: rootCookies
    })).status, 401);
    assert.equal((await requestJSON(baseUrl, "/admin/api/auth/session", {
      cookies: secondCookies
    })).status, 401);

    const trust = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM admin_sessions
          WHERE admin_user_id = 'e2e-auth-admin' AND revoked_at IS NULL) AS active_sessions,
         (SELECT count(*)::int FROM admin_devices
          WHERE admin_user_id = 'e2e-auth-admin' AND status = 'approved') AS approved_devices,
         (SELECT count(*)::int FROM admin_devices
          WHERE admin_user_id = 'e2e-auth-admin' AND status = 'revoked') AS revoked_devices`
    );
    assert.deepEqual(trust.rows[0], {
      active_sessions: 0,
      approved_devices: 1,
      revoked_devices: 2
    });
  });
});

async function proveAppealBoundary(baseUrl, rootCookies) {
  const report = await requestJSON(baseUrl, "/api/reports", {
    method: "POST",
    userID: ACTORS.reporterA,
    body: {
      clientRequestID: "e2e-appeal-report",
      sourceType: "post",
      sourceID: TARGETS.cleanPost,
      reasonCode: "other",
      reportedField: "content",
      detail: "Synthetic appeal lifecycle report"
    }
  });
  assert.equal(report.status, 201);
  const caseID = report.body.report.caseID;
  const admin = {
    cookies: rootCookies,
    csrf: rootCookies.get("zbt_admin_csrf")
  };
  const detail = await adminCase(baseUrl, caseID, admin);
  const hidden = await adminDecision(
    baseUrl,
    caseID,
    "temporary_hide",
    "Human final decision for the appeal window",
    detail.version,
    admin
  );
  assert.equal(hidden.status, 200);

  const firstAppeal = await requestJSON(baseUrl, `/api/content-actions/${caseID}/appeal`, {
    method: "POST",
    userID: ACTORS.owner,
    body: { detail: "First and only appeal for this human decision" }
  });
  assert.equal(firstAppeal.status, 201);
  const secondAppeal = await requestJSON(baseUrl, `/api/content-actions/${caseID}/appeal`, {
    method: "POST",
    userID: ACTORS.owner,
    body: { detail: "Duplicate appeal must be rejected" }
  });
  assert.equal(secondAppeal.status, 409);
  assert.equal(secondAppeal.body.code, "appeal_already_submitted");
  const appeal = await pool.query(
    `SELECT count(*)::int AS count,
            bool_and(created_at >= now() - interval '7 days') AS within_window
     FROM safety_appeals WHERE case_id = $1`,
    [caseID]
  );
  assert.deepEqual(appeal.rows[0], { count: 1, within_window: true });

  let gateCalls = 0;
  const aiAttempt = await analyzeSafetyCase({
    caseId: caseID,
    mode: "enforce",
    automaticActionsEnabled: true,
    aiConfig: E2E_AI_CONFIG,
    withTransaction: transaction,
    moderation: async () => ({
      outcome: "block",
      status: "rejected",
      riskLevel: "high",
      source: "mockAliyun",
      reason: "Synthetic appealed-case signal"
    }),
    providerFactory: () => qwenProvider(qwenResult({
      category: "other",
      riskLevel: "high",
      confidence: 0.99,
      recommendedAction: "hide_content_temporarily"
    })),
    assertEnforcementAllowed: async () => {
      gateCalls += 1;
      return { passed: true };
    },
    now: E2E_NOW
  });
  assert.equal(aiAttempt.reason, "manual_hold");
  assert.equal(aiAttempt.applied, false);
  assert.equal(gateCalls, 0);
  const appealedAuthority = await pool.query(
    `SELECT safety_case.status, safety_case.manual_hold,
            appeal.status AS appeal_status,
            count(action.id)::int AS applied_human_actions
     FROM safety_cases safety_case
     JOIN safety_appeals appeal ON appeal.case_id = safety_case.id
     JOIN safety_actions action ON action.case_id = safety_case.id
       AND action.actor_type = 'admin' AND action.execution_status = 'applied'
     WHERE safety_case.id = $1
     GROUP BY safety_case.status, safety_case.manual_hold, appeal.status`,
    [caseID]
  );
  assert.deepEqual(appealedAuthority.rows[0], {
    status: "appealed",
    manual_hold: true,
    appeal_status: "pending",
    applied_human_actions: 1
  });
}

async function proveHumanAuthorityBoundary(baseUrl, rootCookies) {
  const report = await requestJSON(baseUrl, "/api/reports", {
    method: "POST",
    userID: ACTORS.reporterB,
    body: {
      clientRequestID: "e2e-user-restriction-report",
      sourceType: "user",
      sourceID: ACTORS.owner,
      reasonCode: "suspected_scam",
      reportedField: "content",
      detail: "Synthetic account-level safety concern"
    }
  });
  assert.equal(report.status, 201);
  const caseID = report.body.report.caseID;
  const admin = {
    cookies: rootCookies,
    csrf: rootCookies.get("zbt_admin_csrf")
  };
  const detail = await adminCase(baseUrl, caseID, admin);
  const restricted = await requestJSON(baseUrl, `/admin/api/cases/${caseID}/restrict-user`, {
    method: "POST",
    cookies: admin.cookies,
    csrf: admin.csrf,
    body: {
      userID: ACTORS.owner,
      restricted: true,
      reason: "Human account restriction must remain authoritative",
      expectedVersion: detail.version
    }
  });
  assert.equal(restricted.status, 200);
  assert.equal(restricted.body.case.manualHold, true);

  const ai = await analyzeSafetyCase({
    caseId: caseID,
    mode: "enforce",
    automaticActionsEnabled: true,
    aiConfig: E2E_AI_CONFIG,
    withTransaction: transaction,
    moderation: passModeration,
    providerFactory: () => qwenProvider(qwenResult({
      category: "suspected_scam",
      subjectType: "user",
      impactScope: "user",
      riskLevel: "none",
      confidence: 0.91,
      recommendedAction: "no_action",
      requiresHuman: false
    })),
    assertEnforcementAllowed: async () => {
      throw new Error("manual hold must prevent gate access");
    },
    now: E2E_NOW
  });
  assert.equal(ai.status, "completed");
  assert.equal(ai.reason, "manual_hold");
  assert.equal(ai.applied, false);

  const humanAction = await pool.query(
    `SELECT id FROM safety_actions
     WHERE case_id = $1 AND action_type = 'restrict_user' AND actor_type = 'admin'`,
    [caseID]
  );
  await assert.rejects(
    transaction((client) => rollbackSafetyAction(client, {
      actionId: humanAction.rows[0].id,
      actorType: "ai",
      actorId: "e2e-mock-qwen",
      reason: "AI must not reverse a human restriction"
    })),
    /不支持撤销/u
  );
  const authority = await pool.query(
    `SELECT user_account.is_restricted, user_account.can_show_contact,
            safety_case.status, safety_case.manual_hold,
            (SELECT count(*)::int FROM admin_audit_events audit
             WHERE audit.event_type = 'safety.case_decided'
               AND audit.subject_id = $2) AS ai_decisions
     FROM users user_account
     JOIN safety_cases safety_case ON safety_case.id = $2
     WHERE user_account.id = $1`,
    [ACTORS.owner, caseID]
  );
  assert.deepEqual(authority.rows[0], {
    is_restricted: true,
    can_show_contact: false,
    status: "resolved_actioned",
    manual_hold: true,
    ai_decisions: 0
  });
}

async function login(baseUrl, deviceID, privateKey) {
  const challenge = await requestJSON(baseUrl, "/admin/api/auth/challenges", {
    method: "POST",
    body: { username: credentials.username, deviceID, purpose: "login" }
  });
  assert.equal(challenge.status, 201);
  const response = await requestJSON(baseUrl, "/admin/api/auth/login", {
    method: "POST",
    body: {
      username: credentials.username,
      password: credentials.password,
      deviceID,
      ...signedChallengeBody(challenge.body, privateKey)
    }
  });
  assert.equal(response.status, 200);
  return cookiesFrom(response.headers);
}

async function rootChallenge(baseUrl, cookies, purpose, targetID) {
  const response = await requestJSON(baseUrl, "/admin/api/auth/challenges", {
    method: "POST",
    cookies,
    csrf: cookies.get("zbt_admin_csrf"),
    body: { purpose, targetID }
  });
  assert.equal(response.status, 201);
  return response.body;
}
