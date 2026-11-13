import assert from "node:assert/strict";
import test from "node:test";
import { closeDatabase, pool, withMigrationDatabase } from "../helpers/database.js";

const aiTables = ["safety_ai_evaluations", "safety_ai_runs", "safety_ai_usage"];

test.after(closeDatabase);

test("AI schema separates provider runs, cost reservations, and human evaluations", async () => {
  const tables = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [aiTables]
  );
  assert.deepEqual(tables.rows.map((row) => row.table_name), aiTables);

  const indexes = await pool.query(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = ANY($1::text[])
     ORDER BY indexname`,
    [["safety_ai_runs_case_created", "safety_ai_usage_month_status"]]
  );
  assert.deepEqual(indexes.rows.map((row) => row.indexname), [
    "safety_ai_runs_case_created",
    "safety_ai_usage_month_status"
  ]);
});

test("AI down migration removes only AI state", async () => {
  await withMigrationDatabase(async ({ pool: migrationPool, applyMigration, applyDownMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("017_admin_auth.sql");
    await applyMigration("017_safety_ai.sql");

    await migrationPool.query(
      `INSERT INTO users (id, nickname) VALUES ('ai-owner', 'AI Owner');
       INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope)
       VALUES ('ai-case', 'user', 'ai-owner', 'other', 'user');
       INSERT INTO admin_users (id, username, username_normalized, password_hash)
       VALUES ('ai-admin', 'AI Admin', 'ai admin', 'unused-test-hash');
       INSERT INTO safety_ai_runs (
         id, case_id, model_version, prompt_version, policy_version,
         evidence_hash, mode, status
       ) VALUES (
         'ai-run', 'ai-case', 'model-v1', 'prompt-v1', 'policy-v1',
         'evidence-hash', 'shadow', 'completed'
       );
       INSERT INTO safety_ai_usage (
         id, ai_run_id, month_key, reserved_cny, actual_cny, status
       ) VALUES ('ai-usage', 'ai-run', '2026-07', 0, 0, 'settled');
       INSERT INTO safety_ai_evaluations (
         id, ai_run_id, admin_user_id, category_correct, action_correct
       ) VALUES ('ai-evaluation', 'ai-run', 'ai-admin', true, true);`
    );

    await applyDownMigration("017_safety_ai.sql");

    const state = await migrationPool.query(
      `SELECT
         to_regclass('public.safety_ai_runs') AS safety_ai_runs,
         to_regclass('public.safety_ai_usage') AS safety_ai_usage,
         to_regclass('public.safety_ai_evaluations') AS safety_ai_evaluations,
         to_regclass('public.safety_cases') AS safety_cases,
         to_regclass('public.admin_users') AS admin_users,
         EXISTS (SELECT 1 FROM safety_cases WHERE id = 'ai-case') AS case_exists,
         EXISTS (SELECT 1 FROM admin_users WHERE id = 'ai-admin') AS admin_exists`
    );
    assert.deepEqual(state.rows[0], {
      safety_ai_runs: null,
      safety_ai_usage: null,
      safety_ai_evaluations: null,
      safety_cases: "safety_cases",
      admin_users: "admin_users",
      case_exists: true,
      admin_exists: true
    });
  });
});

test("AI retry migration permits transient attempts but keeps one blocking run", async () => {
  await withMigrationDatabase(async ({ pool: migrationPool, applyMigration, applyDownMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("017_admin_auth.sql");
    await applyMigration("017_safety_ai.sql");
    await applyMigration("018_safety_ai_retry_runs.sql");

    await migrationPool.query(
      `INSERT INTO users (id, nickname) VALUES ('retry-owner', 'Retry Owner');
       INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope)
       VALUES ('retry-case', 'user', 'retry-owner', 'other', 'user');`
    );
    const insertRun = (id, status, retryable) => migrationPool.query(
      `INSERT INTO safety_ai_runs (
         id, case_id, model_version, prompt_version, policy_version,
         evidence_hash, mode, status, retryable
       ) VALUES ($1, 'retry-case', 'model-v1', 'prompt-v1', 'policy-v1',
         'same-evidence', 'shadow', $2, $3)`,
      [id, status, retryable]
    );

    await insertRun("retry-run-1", "failed", true);
    await insertRun("retry-run-2", "failed", true);
    await insertRun("retry-run-completed", "completed", false);
    await assert.rejects(
      insertRun("retry-run-duplicate", "running", false),
      (error) => error.code === "23505"
    );
    const schema = await migrationPool.query(
      `SELECT
         (SELECT column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'safety_ai_runs' AND column_name = 'retryable') AS retryable_default,
         (SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'safety_ai_runs_one_blocking_evidence') AS retry_index`
    );
    assert.match(schema.rows[0].retryable_default, /false/);
    assert.match(schema.rows[0].retry_index, /WHERE \(\(status <> 'failed'::text\) OR \(retryable = false\)\)/);

    await assert.rejects(
      applyDownMigration("018_safety_ai_retry_runs.sql"),
      /cannot restore safety AI run uniqueness/i
    );
    await migrationPool.query(
      "DELETE FROM safety_ai_runs WHERE id IN ('retry-run-1', 'retry-run-2')"
    );
    await applyDownMigration("018_safety_ai_retry_runs.sql");
    const down = await migrationPool.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'safety_ai_runs' AND column_name = 'retryable'
         ) AS retryable_exists,
         EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conrelid = 'safety_ai_runs'::regclass AND contype = 'u'
         ) AS unique_exists`
    );
    assert.deepEqual(down.rows[0], { retryable_exists: false, unique_exists: true });
  });
});
