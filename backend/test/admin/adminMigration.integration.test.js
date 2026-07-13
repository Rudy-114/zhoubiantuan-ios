import assert from "node:assert/strict";
import test from "node:test";
import { closeDatabase, withMigrationDatabase } from "../helpers/database.js";

const adminTables = [
  "admin_audit_events",
  "admin_auth_challenges",
  "admin_bootstrap_codes",
  "admin_device_requests",
  "admin_devices",
  "admin_recovery_codes",
  "admin_sessions",
  "admin_users"
];

test.after(closeDatabase);

test("admin identities are stored in eight tables isolated from consumer users", async () => {
  await withMigrationDatabase(async ({ pool, applyMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("014_report_upload_cleanup.sql");
    await applyMigration("015_content_revisions.sql");
    await applyMigration("016_appealed_case_aggregation.sql");
    await applyMigration("017_admin_auth.sql");

    const relations = await pool.query(
      `SELECT table_name, to_regclass('public.' || table_name)::text AS regclass
       FROM unnest($1::text[]) AS tables(table_name)
       ORDER BY table_name`,
      [adminTables]
    );
    assert.deepEqual(relations.rows, adminTables.map((table_name) => ({
      table_name,
      regclass: table_name
    })));

    const consumerForeignKeys = await pool.query(
      `SELECT tc.table_name, ccu.table_name AS referenced_table
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_catalog = tc.constraint_catalog
        AND ccu.constraint_schema = tc.constraint_schema
        AND ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_name = ANY($1::text[])
         AND ccu.table_name IN ('users', 'auth_identities')`,
      [adminTables]
    );
    assert.deepEqual(consumerForeignKeys.rows, []);

    const indexes = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[])
       ORDER BY indexname`,
      [[
        "admin_audit_events_created",
        "admin_auth_challenges_active",
        "admin_device_requests_pending",
        "admin_sessions_active"
      ]]
    );
    assert.deepEqual(indexes.rows.map(({ indexname }) => indexname), [
      "admin_audit_events_created",
      "admin_auth_challenges_active",
      "admin_device_requests_pending",
      "admin_sessions_active"
    ]);
  });
});

test("admin auth down migration removes only isolated admin state", async () => {
  await withMigrationDatabase(async ({ pool, applyMigration, applyDownMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("017_admin_auth.sql");

    await pool.query(
      `INSERT INTO users (id, nickname) VALUES ('consumer-preserved', 'Consumer');
       INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope)
       VALUES ('case-preserved', 'user', 'consumer-preserved', 'other', 'user');
       INSERT INTO admin_users (id, username, username_normalized, password_hash)
       VALUES ('admin-1', 'Root Admin', 'root admin', 'bcrypt-placeholder');
       INSERT INTO admin_devices (
         id, admin_user_id, display_name, public_key_jwk, fingerprint_hash, is_root
       ) VALUES (
         'admin-device-1', 'admin-1', 'Root device',
         '{"kty":"EC","crv":"P-256","x":"x","y":"y"}'::jsonb,
         'fingerprint-1', true
       );
       INSERT INTO admin_sessions (
         id, admin_user_id, device_id, token_hash, csrf_hash,
         idle_expires_at, absolute_expires_at
       ) VALUES (
         'admin-session-1', 'admin-1', 'admin-device-1', 'token-hash-1', 'csrf-hash-1',
         now() + interval '30 minutes', now() + interval '8 hours'
       );
       INSERT INTO admin_audit_events (
         admin_user_id, device_id, session_id, event_type
       ) VALUES (
         'admin-1', 'admin-device-1', 'admin-session-1', 'admin.test'
       );`
    );

    await applyDownMigration("017_admin_auth.sql");

    const state = await pool.query(
      `SELECT
         to_regclass('public.admin_users') AS admin_users,
         to_regclass('public.admin_sessions') AS admin_sessions,
         to_regclass('public.users') AS users,
         to_regclass('public.auth_identities') AS auth_identities,
         to_regclass('public.safety_cases') AS safety_cases,
         EXISTS (SELECT 1 FROM users WHERE id = 'consumer-preserved') AS consumer_exists,
         EXISTS (SELECT 1 FROM safety_cases WHERE id = 'case-preserved') AS case_exists`
    );
    assert.deepEqual(state.rows[0], {
      admin_users: null,
      admin_sessions: null,
      users: "users",
      auth_identities: "auth_identities",
      safety_cases: "safety_cases",
      consumer_exists: true,
      case_exists: true
    });
  });
});
