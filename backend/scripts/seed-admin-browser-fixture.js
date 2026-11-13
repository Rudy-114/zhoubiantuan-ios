import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { publicKeyFingerprint } from "../src/admin/crypto.js";

const { Pool } = pg;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);

export function assertSafeAdminBrowserFixtureEnvironment(environment) {
  assert.equal(environment.NODE_ENV, "test", "admin browser fixtures require NODE_ENV=test");
  assert.ok(environment.DATABASE_URL, "admin browser fixtures require DATABASE_URL");

  let databaseURL;
  try {
    databaseURL = new URL(environment.DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  assert.ok(["postgres:", "postgresql:"].includes(databaseURL.protocol), "DATABASE_URL must use PostgreSQL");
  assert.equal(databaseURL.search, "", "DATABASE_URL must not include query parameters");
  assert.equal(databaseURL.hash, "", "DATABASE_URL must not include a fragment");
  const databaseName = decodeURIComponent(databaseURL.pathname).replace(/^\/+/, "");
  assert.match(databaseName, /^zbt_safety_test_[a-zA-Z0-9_]+$/, "DATABASE_URL must target a zbt_safety_test_* database");
  const hostname = databaseURL.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  assert.ok(LOOPBACK_HOSTS.has(hostname), "DATABASE_URL must use a loopback host");

  return { connectionString: environment.DATABASE_URL, databaseName };
}

export async function runAdminBrowserFixture({
  environment = process.env,
  stdout = process.stdout
} = {}) {
  const options = assertSafeAdminBrowserFixtureEnvironment(environment);
  const pool = new Pool({ connectionString: options.connectionString });
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    const connected = await client.query(
      "SELECT current_database() AS database_name, host(inet_server_addr()) AS server_host"
    );
    assert.equal(connected.rows[0]?.database_name, options.databaseName, "connected database does not match DATABASE_URL");
    assert.ok(
      connected.rows[0]?.server_host == null || LOOPBACK_HOSTS.has(connected.rows[0].server_host),
      "refusing to seed a non-loopback PostgreSQL server"
    );

    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('zbt-admin-browser-fixture'))");
    const admins = await client.query(
      "SELECT id FROM admin_users WHERE status = 'active' ORDER BY created_at, id"
    );
    assert.equal(admins.rowCount, 1, "admin browser fixtures require exactly one active disposable admin");
    await seedSyntheticFixture(client, admins.rows[0].id, environment.ADMIN_RECOVERY_PEPPER);
    await client.query("COMMIT");
    transactionOpen = false;
    stdout.write(`Seeded disposable admin browser fixtures in ${options.databaseName}.\n`);
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function seedSyntheticFixture(client, adminUserID, recoveryPepper) {
  assert.ok(
    typeof recoveryPepper === "string" && recoveryPepper.length >= 32,
    "admin browser fixtures require ADMIN_RECOVERY_PEPPER"
  );
  const pendingShortCodeHash = createHmac("sha256", recoveryPepper)
    .update("zbt-admin-v1\ndevice-short-code\nQA2B3C", "utf8")
    .digest("hex");
  const pendingPublicKey = generateKeyPairSync("ec", { namedCurve: "P-256" })
    .publicKey.export({ format: "jwk" });
  const pendingFingerprint = publicKeyFingerprint(pendingPublicKey);

  await removePriorFixture(client);

  await client.query(
    `INSERT INTO users (id, email, nickname, bio, phone_number, is_restricted, can_show_contact) VALUES
       ('u-fixture-owner', 'owner@fixture.invalid', '合成团长', '仅用于浏览器验收的虚构账号', '000-0000-0000', false, true),
       ('u-fixture-reporter-a', 'reporter-a@fixture.invalid', '合成举报人甲', '', '', false, true),
       ('u-fixture-reporter-b', 'reporter-b@fixture.invalid', '合成举报人乙', '', '', false, true),
       ('u-fixture-target', 'target@fixture.invalid', '合成风险用户', '虚构风险用户', '', true, false),
       ('u-fixture-buyer', 'buyer@fixture.invalid', '合成咨询者', '', '', false, true)`
  );

  await client.query(
    `INSERT INTO group_collections (
       id, owner_id, name, contact_wechat, contact_qq, group_info, deadline, default_note
     ) VALUES (
       'collection-fixture-contact', 'u-fixture-owner', '合成联系方式团',
       'fixture_wechat_only', '000000000', '这是虚构的团购联系说明。',
       now() + interval '21 days', '仅用于安全后台验收'
     )`
  );

  await client.query(
    `INSERT INTO posts (
       id, author_id, title, deadline, description, status, safety_status
     ) VALUES
       ('post-fixture-content', 'u-fixture-owner', '合成高风险内容案例', now() + interval '30 days', '虚构内容快照：用于检查人工复核布局。', 'active', 'active'),
       ('post-fixture-correction', 'u-fixture-owner', '合成待整改内容', now() + interval '18 days', '虚构原始说明，已进入整改流程。', 'active', 'hidden'),
       ('post-fixture-appeal', 'u-fixture-owner', '合成申诉案例', now() + interval '12 days', '虚构申诉对应内容。', 'active', 'hidden'),
       ('post-fixture-ai', 'u-fixture-owner', '合成 AI 失败案例', now() + interval '26 days', '虚构 AI 队列失败内容。', 'active', 'active'),
       ('post-fixture-auto', 'u-fixture-target', '合成自动处理案例', now() + interval '9 days', '虚构系统自动隐藏内容。', 'active', 'hidden'),
       ('post-fixture-moderation', 'u-fixture-owner', '合成发布前审核内容', now() + interval '20 days', '虚构发布审核说明。', 'review', 'active')`
  );

  await client.query(
    `INSERT INTO message_threads (
       id, buyer_user_id, publisher_user_id, related_post_id, created_at, updated_at
     ) VALUES (
       'thread-fixture-message', 'u-fixture-buyer', 'u-fixture-owner', 'post-fixture-content',
       now() - interval '3 hours', now() - interval '2 hours'
     );
     INSERT INTO direct_messages (id, thread_id, sender_id, body, created_at) VALUES
       ('message-fixture-1', 'thread-fixture-message', 'u-fixture-buyer', '你好，这是虚构对话第一条。', now() - interval '128 minutes'),
       ('message-fixture-2', 'thread-fixture-message', 'u-fixture-owner', '虚构回复第二条。', now() - interval '126 minutes'),
       ('message-fixture-3', 'thread-fixture-message', 'u-fixture-buyer', '虚构对话第三条。', now() - interval '124 minutes'),
       ('message-fixture-4', 'thread-fixture-message', 'u-fixture-owner', '虚构风险话术：请不要执行任何真实转账。', now() - interval '122 minutes'),
       ('message-fixture-5', 'thread-fixture-message', 'u-fixture-buyer', '虚构对话第五条。', now() - interval '120 minutes'),
       ('message-fixture-6', 'thread-fixture-message', 'u-fixture-owner', '虚构对话第六条。', now() - interval '118 minutes'),
       ('message-fixture-7', 'thread-fixture-message', 'u-fixture-buyer', '虚构对话第七条。', now() - interval '116 minutes')`
  );

  await client.query(
    `INSERT INTO safety_cases (
       id, subject_type, subject_id, category, impact_scope, status, risk_level,
       confidence, ai_recommendation, manual_hold, correction_due_at, model_version,
       prompt_version, created_at, updated_at, resolved_at
     ) VALUES
       ('sc-fixture-post', 'post', 'post-fixture-content', 'harassment_or_abuse', 'post',
        'manual_review', 'urgent', 0.9100, '{"outcome":"manual_review","summary":"合成高风险样本，需人工判断"}'::jsonb,
        false, NULL, 'fixture-model-v1', 'fixture-prompt-v1', now() - interval '7 hours', now() - interval '8 minutes', NULL),
       ('sc-fixture-contact', 'collection', 'collection-fixture-contact', 'invalid_contact', 'collection',
        'manual_review', 'high', 0.8200, '{"outcome":"manual_review","summary":"联系字段需人工核对"}'::jsonb,
        false, NULL, 'fixture-model-v1', 'fixture-prompt-v1', now() - interval '6 hours', now() - interval '14 minutes', NULL),
       ('sc-fixture-message', 'direct_message', 'message-fixture-4', 'direct_message_risk', 'direct_message',
        'manual_review', 'high', 0.8700, '{"outcome":"manual_review","summary":"仅展示七条虚构保留窗口"}'::jsonb,
        false, NULL, 'fixture-model-v1', 'fixture-prompt-v1', now() - interval '5 hours', now() - interval '18 minutes', NULL),
       ('sc-fixture-correction', 'post', 'post-fixture-correction', 'false_or_expired_group_buy', 'post',
        'awaiting_correction', 'medium', 0.7500, '{"outcome":"request_correction","summary":"等待内容所有者提交整改"}'::jsonb,
        true, now() - interval '35 minutes', 'fixture-model-v1', 'fixture-prompt-v1', now() - interval '2 days', now() - interval '4 hours', NULL),
       ('sc-fixture-appeal', 'post', 'post-fixture-appeal', 'suspected_scam', 'post',
        'appealed', 'high', 0.8800, '{"outcome":"temporary_hide","summary":"申诉前的虚构隐藏处理"}'::jsonb,
        true, NULL, 'fixture-model-v1', 'fixture-prompt-v1', now() - interval '4 days', now() - interval '22 minutes', now() - interval '1 day'),
       ('sc-fixture-ai', 'post', 'post-fixture-ai', 'suspected_scam', 'post',
        'manual_review', 'medium', 0.0000, '{"outcome":"error","errorCode":"fixture_provider_timeout","summary":"虚构 AI 提供方超时"}'::jsonb,
        false, NULL, 'fixture-model-v1', 'fixture-prompt-v1', now() - interval '3 hours', now() - interval '28 minutes', NULL),
       ('sc-fixture-auto', 'post', 'post-fixture-auto', 'spam_or_advertising', 'post',
        'resolved_actioned', 'high', 0.9600, '{"outcome":"temporary_hide","summary":"虚构 AI 自动处理"}'::jsonb,
        true, NULL, 'fixture-model-v1', 'fixture-prompt-v1', now() - interval '5 days', now() - interval '1 day', now() - interval '1 day'),
       ('sc-fixture-user', 'user', 'u-fixture-target', 'harassment_or_abuse', 'user',
        'resolved_actioned', 'high', 0.9300, '{"outcome":"restrict_user","summary":"经人工确认的虚构账号风险"}'::jsonb,
        true, NULL, 'fixture-model-v1', 'fixture-prompt-v1', now() - interval '18 days', now() - interval '6 days', now() - interval '6 days')`
  );

  await client.query(
    `INSERT INTO reports (
       id, target_type, target_id, reason, detail, reporter_id, status, admin_result,
       handled_at, client_request_id, case_id, source_type, source_id, subject_type,
       subject_id, reason_code, reported_field, created_at, updated_at
     ) VALUES
       ('report-fixture-post-a', 'post', 'post-fixture-content', 'harassment_or_abuse', '虚构举报说明甲', 'u-fixture-reporter-a', 'pending', NULL, NULL,
        'fixture-post-a', 'sc-fixture-post', 'post', 'post-fixture-content', 'post', 'post-fixture-content', 'harassment_or_abuse', 'content', now() - interval '6 hours', now() - interval '8 minutes'),
       ('report-fixture-post-b', 'post', 'post-fixture-content', 'harassment_or_abuse', '虚构举报说明乙', 'u-fixture-reporter-b', 'pending', NULL, NULL,
        'fixture-post-b', 'sc-fixture-post', 'post', 'post-fixture-content', 'post', 'post-fixture-content', 'harassment_or_abuse', 'content', now() - interval '5 hours', now() - interval '9 minutes'),
       ('report-fixture-contact', 'collection', 'collection-fixture-contact', 'invalid_contact', '虚构联系方式举报', 'u-fixture-reporter-a', 'pending', NULL, NULL,
        'fixture-contact', 'sc-fixture-contact', 'collection', 'collection-fixture-contact', 'collection', 'collection-fixture-contact', 'invalid_contact', 'contact_wechat', now() - interval '5 hours', now() - interval '14 minutes'),
       ('report-fixture-message', 'direct_message', 'message-fixture-4', 'direct_message_risk', '虚构私信风险举报', 'u-fixture-buyer', 'pending', NULL, NULL,
        'fixture-message', 'sc-fixture-message', 'direct_message', 'message-fixture-4', 'direct_message', 'message-fixture-4', 'direct_message_risk', 'content', now() - interval '2 hours', now() - interval '18 minutes'),
       ('report-fixture-correction', 'post', 'post-fixture-correction', 'false_or_expired_group_buy', '虚构整改举报', 'u-fixture-reporter-a', 'pending', NULL, NULL,
        'fixture-correction', 'sc-fixture-correction', 'post', 'post-fixture-correction', 'post', 'post-fixture-correction', 'false_or_expired_group_buy', 'content', now() - interval '2 days', now() - interval '4 hours'),
       ('report-fixture-appeal', 'post', 'post-fixture-appeal', 'suspected_scam', '虚构申诉原案举报', 'u-fixture-reporter-b', 'closed', '已隐藏', now() - interval '1 day',
        'fixture-appeal', 'sc-fixture-appeal', 'post', 'post-fixture-appeal', 'post', 'post-fixture-appeal', 'suspected_scam', 'content', now() - interval '4 days', now() - interval '1 day'),
       ('report-fixture-ai', 'post', 'post-fixture-ai', 'suspected_scam', '虚构 AI 失败样本', 'u-fixture-reporter-a', 'pending', NULL, NULL,
        'fixture-ai', 'sc-fixture-ai', 'post', 'post-fixture-ai', 'post', 'post-fixture-ai', 'suspected_scam', 'content', now() - interval '3 hours', now() - interval '28 minutes'),
       ('report-fixture-auto', 'post', 'post-fixture-auto', 'spam_or_advertising', '虚构自动处理样本', 'u-fixture-reporter-b', 'closed', '自动隐藏', now() - interval '1 day',
        'fixture-auto', 'sc-fixture-auto', 'post', 'post-fixture-auto', 'post', 'post-fixture-auto', 'spam_or_advertising', 'content', now() - interval '5 days', now() - interval '1 day'),
       ('report-fixture-user', 'user', 'u-fixture-target', 'harassment_or_abuse', '虚构账号风险样本', 'u-fixture-reporter-a', 'closed', '已限制', now() - interval '6 days',
        'fixture-user', 'sc-fixture-user', 'user', 'u-fixture-target', 'user', 'u-fixture-target', 'harassment_or_abuse', 'content', now() - interval '18 days', now() - interval '6 days')`
  );

  const messageWindow = [
    { id: "message-fixture-1", senderId: "u-fixture-buyer", body: "你好，这是虚构对话第一条。" },
    { id: "message-fixture-2", senderId: "u-fixture-owner", body: "虚构回复第二条。" },
    { id: "message-fixture-3", senderId: "u-fixture-buyer", body: "虚构对话第三条。" },
    { id: "message-fixture-4", senderId: "u-fixture-owner", body: "虚构风险话术：请不要执行任何真实转账。" },
    { id: "message-fixture-5", senderId: "u-fixture-buyer", body: "虚构对话第五条。" },
    { id: "message-fixture-6", senderId: "u-fixture-owner", body: "虚构对话第六条。" },
    { id: "message-fixture-7", senderId: "u-fixture-buyer", body: "虚构对话第七条。" }
  ];
  await client.query(
    `INSERT INTO safety_evidence (
       id, case_id, report_id, client_request_id, evidence_type, text_snapshot,
       structured_snapshot, context_start_message_id, context_end_message_id,
       retention_delete_at, created_at
     ) VALUES
       ('evidence-fixture-post', 'sc-fixture-post', 'report-fixture-post-a', 'fixture-evidence-post', 'post_snapshot',
        '虚构证据原文：这不是真实用户内容。',
        '{"title":"合成高风险内容案例","description":"虚构内容快照","report":{"detail":"虚构举报说明甲"}}'::jsonb,
        NULL, NULL, NULL, now() - interval '6 hours'),
       ('evidence-fixture-contact', 'sc-fixture-contact', 'report-fixture-contact', 'fixture-evidence-contact', 'collection_contact_snapshot',
        '虚构联系快照：fixture_wechat_only',
        '{"collectionName":"合成联系方式团","reportedField":"contact_wechat","contactValue":"fixture_wechat_only"}'::jsonb,
        NULL, NULL, NULL, now() - interval '5 hours'),
       ('evidence-fixture-message', 'sc-fixture-message', 'report-fixture-message', 'fixture-evidence-message', 'direct_message_window',
        '虚构私信保留窗口，仅用于浏览器验收。', $1::jsonb,
        'message-fixture-1', 'message-fixture-7', now() + interval '7 days', now() - interval '2 hours'),
       ('evidence-fixture-correction', 'sc-fixture-correction', 'report-fixture-correction', 'fixture-evidence-correction', 'post_snapshot',
        '虚构整改前内容快照。', '{"title":"合成待整改内容","state":"awaiting_correction"}'::jsonb,
        NULL, NULL, NULL, now() - interval '2 days'),
       ('evidence-fixture-appeal', 'sc-fixture-appeal', 'report-fixture-appeal', 'fixture-evidence-appeal', 'appeal_snapshot',
        '虚构申诉原始证据。', '{"title":"合成申诉案例","decision":"temporary_hide"}'::jsonb,
        NULL, NULL, NULL, now() - interval '4 days')`,
    [JSON.stringify({ messages: messageWindow })]
  );

  await client.query(
    `INSERT INTO safety_actions (
       id, case_id, idempotency_key, action_type, target_type, target_id, actor_type,
       actor_id, reason, execution_status, before_snapshot, after_snapshot, applied_at, created_at
     ) VALUES
       ('action-fixture-correction', 'sc-fixture-correction', 'fixture:correction', 'request_correction', 'post', 'post-fixture-correction', 'admin',
        $1, '虚构整改请求', 'applied', '{"safety_status":"active"}'::jsonb, '{"safety_status":"hidden","correction_due_at":"2026-07-14T00:00:00.000Z"}'::jsonb, now() - interval '1 day', now() - interval '1 day'),
       ('action-fixture-appeal', 'sc-fixture-appeal', 'fixture:appeal', 'hide_post', 'post', 'post-fixture-appeal', 'admin',
        $1, '虚构人工隐藏处理', 'applied', '{"safety_status":"active"}'::jsonb, '{"safety_status":"hidden"}'::jsonb, now() - interval '1 day', now() - interval '1 day'),
       ('action-fixture-auto', 'sc-fixture-auto', 'fixture:auto', 'hide_post', 'post', 'post-fixture-auto', 'ai',
        'fixture-safety-model', '虚构 AI 自动隐藏', 'applied', '{"safety_status":"active"}'::jsonb, '{"safety_status":"hidden"}'::jsonb, now() - interval '1 day', now() - interval '1 day'),
       ('action-fixture-user', 'sc-fixture-user', 'fixture:user-risk', 'restrict_user', 'user', 'u-fixture-target', 'admin',
        $1, '虚构人工确认账号限制', 'applied', '{"is_restricted":false}'::jsonb, '{"is_restricted":true}'::jsonb, now() - interval '6 days', now() - interval '6 days')`,
    [adminUserID]
  );

  await client.query(
    `INSERT INTO content_revisions (
       id, case_id, target_type, target_id, owner_id, revision_number, snapshot, status, review_summary, created_at, updated_at
     ) VALUES (
       'revision-fixture-correction', 'sc-fixture-correction', 'post', 'post-fixture-correction', 'u-fixture-owner', 1,
       '{"title":"合成整改版标题","description":"虚构整改版说明","categoryTags":["虚构整改"]}'::jsonb,
       'pending', '{"outcome":"pending_review"}'::jsonb, now() - interval '3 hours', now() - interval '3 hours'
     );
     INSERT INTO safety_appeals (
       id, case_id, decision_action_id, owner_id, detail, status, created_at
     ) VALUES (
       'appeal-fixture-pending', 'sc-fixture-appeal', 'action-fixture-appeal', 'u-fixture-owner',
       '虚构申诉说明：请人工复核已隐藏内容。', 'pending', now() - interval '20 hours'
     );
     INSERT INTO safety_jobs (
       job_type, case_id, unique_key, payload, status, attempts, max_attempts,
       run_at, error_code, error_summary, created_at, updated_at
     ) VALUES (
       'analyze_case', 'sc-fixture-ai', 'fixture:ai-failure', '{"fixture":true}'::jsonb,
       'failed', 3, 3, now() - interval '30 minutes', 'fixture_provider_timeout',
       '虚构 AI 提供方超时，没有真实请求。', now() - interval '3 hours', now() - interval '30 minutes'
     )`
  );

  await client.query(
    `INSERT INTO safety_case_events (case_id, actor_type, actor_id, event_type, event_data, created_at)
     SELECT id, 'system', NULL, 'fixture_case_created', '{"synthetic":true}'::jsonb, created_at
     FROM safety_cases WHERE id LIKE 'sc-fixture-%'`
  );
  await client.query(
    `INSERT INTO safety_case_events (case_id, actor_type, actor_id, event_type, event_data, created_at) VALUES
       ('sc-fixture-post', 'ai', 'fixture-safety-model', 'analysis_completed', '{"outcome":"manual_review"}'::jsonb, now() - interval '10 minutes'),
       ('sc-fixture-correction', 'admin', $1, 'correction_requested', '{"synthetic":true}'::jsonb, now() - interval '1 day'),
       ('sc-fixture-appeal', 'owner', 'u-fixture-owner', 'appeal_submitted', '{"synthetic":true}'::jsonb, now() - interval '20 hours'),
       ('sc-fixture-ai', 'ai', 'fixture-safety-model', 'analysis_failed', '{"errorCode":"fixture_provider_timeout"}'::jsonb, now() - interval '30 minutes')`,
    [adminUserID]
  );

  await client.query(
    `INSERT INTO moderation_reviews (
       id, target_type, target_id, owner_id, status, source, risk_level, reason,
       text_snapshot, snapshot, raw_summary, created_at, updated_at
     ) VALUES (
       'moderation-fixture-review', 'post', 'post-fixture-moderation', 'u-fixture-owner',
       'review', 'fixtureProvider', 'medium', '虚构提供方信号需人工确认',
       '虚构发布前审核文本，不包含真实用户数据。',
       '{"title":"合成发布前审核内容","currentObject":"post-fixture-moderation"}'::jsonb,
       '{"provider":"fixtureProvider","labels":["synthetic_review"],"confidence":0.61}'::jsonb,
       now() - interval '42 minutes', now() - interval '42 minutes'
     )`
  );

  await client.query(
    `INSERT INTO admin_device_requests (
       id, admin_user_id, proposed_device_id, display_name, public_key_jwk,
       fingerprint_hash, short_code_hash, requested_ip_hash, user_agent_summary,
       expires_at, created_at
     ) VALUES (
       'adreq-fixture-pending', $1, 'device-fixture-pending', '合成待批准浏览器', $2::jsonb,
       $3, $4, repeat('b', 64), 'Synthetic Browser Fixture',
       now() + interval '8 hours', now() - interval '12 minutes'
     )`,
    [adminUserID, JSON.stringify(pendingPublicKey), pendingFingerprint, pendingShortCodeHash]
  );
  await client.query(
    `INSERT INTO admin_audit_events (
       admin_user_id, event_type, subject_type, subject_id, event_data, user_agent_summary, created_at
     ) VALUES
       ($1, 'fixture.seeded', 'safety_case', 'sc-fixture-post', '{"synthetic":true}'::jsonb, 'Synthetic Fixture Seeder', now() - interval '7 minutes'),
       ($1, 'fixture.evidence_policy_checked', 'evidence', 'evidence-fixture-message', '{"synthetic":true,"rawContent":false}'::jsonb, 'Synthetic Fixture Seeder', now() - interval '6 minutes')`,
    [adminUserID]
  );
}

async function removePriorFixture(client) {
  await client.query(
    `DELETE FROM admin_device_requests WHERE id = 'adreq-fixture-pending' OR proposed_device_id = 'device-fixture-pending';
     DELETE FROM admin_devices WHERE id = 'device-fixture-pending';
     DELETE FROM admin_audit_events
       WHERE event_type LIKE 'fixture.%' OR subject_id LIKE 'sc-fixture-%' OR subject_id LIKE '%fixture%';
     DELETE FROM moderation_reviews WHERE id = 'moderation-fixture-review';
     DELETE FROM reports WHERE case_id LIKE 'sc-fixture-%';
     DELETE FROM safety_cases WHERE id LIKE 'sc-fixture-%';
     DELETE FROM direct_messages WHERE thread_id = 'thread-fixture-message';
     DELETE FROM message_threads WHERE id = 'thread-fixture-message';
     DELETE FROM posts WHERE id LIKE 'post-fixture-%';
     DELETE FROM group_collections WHERE id = 'collection-fixture-contact';
     DELETE FROM users WHERE id LIKE 'u-fixture-%'`
  );
}

async function main() {
  try {
    await runAdminBrowserFixture();
  } catch (error) {
    process.stderr.write(`${error?.message || "Failed to seed admin browser fixtures"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
