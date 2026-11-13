import assert from "node:assert/strict";
import test from "node:test";
import { closeDatabase, withMigrationDatabase } from "../helpers/database.js";

test.after(closeDatabase);

test("content revision migration creates revision and appeal tables with required indexes", async () => {
  await withMigrationDatabase(async ({ pool, applyMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("014_report_upload_cleanup.sql");
    await applyMigration("015_content_revisions.sql");

    const relations = await pool.query(
      `SELECT table_name, to_regclass('public.' || table_name)::text AS regclass
       FROM unnest($1::text[]) AS tables(table_name)
       ORDER BY table_name`,
      [["content_revisions", "safety_appeals"]]
    );
    assert.deepEqual(relations.rows, [
      { table_name: "content_revisions", regclass: "content_revisions" },
      { table_name: "safety_appeals", regclass: "safety_appeals" }
    ]);

    const indexes = await pool.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = ANY($1::text[])
       ORDER BY indexname`,
      [[
        "content_revisions_one_active_case",
        "content_revisions_target_number",
        "safety_appeals_one_per_decision",
        "safety_appeals_pending_created"
      ]]
    );
    assert.deepEqual(indexes.rows.map(({ indexname }) => indexname), [
      "content_revisions_one_active_case",
      "content_revisions_target_number",
      "safety_appeals_one_per_decision",
      "safety_appeals_pending_created"
    ]);
  });
});

test("content revision migration enforces case identity and uniqueness and rolls back cleanly", async () => {
  await withMigrationDatabase(async ({ pool, applyMigration, applyDownMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("014_report_upload_cleanup.sql");
    await applyMigration("015_content_revisions.sql");

    await pool.query(
      `INSERT INTO users (id, nickname)
       VALUES ('user-revision-owner', 'Revision owner');

       INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope)
       VALUES
         ('case-revision', 'post', 'post-revision', 'other', 'post'),
         ('case-appeal', 'post', 'post-appeal', 'other', 'post');

       INSERT INTO safety_actions (
         id, case_id, idempotency_key, action_type, target_type, target_id, actor_type, reason
       ) VALUES
         (
           'action-revision-decision', 'case-revision', 'revision-decision',
           'remove_post', 'post', 'post-revision', 'admin', 'Revision policy decision'
         ),
         (
           'action-appeal-decision', 'case-appeal', 'appeal-decision',
           'remove_post', 'post', 'post-appeal', 'admin', 'Appeal policy decision'
         );

       INSERT INTO content_revisions (
         id, case_id, target_type, target_id, owner_id, revision_number, snapshot
       ) VALUES (
         'revision-1', 'case-revision', 'post', 'post-revision',
         'user-revision-owner', 1, '{"title":"Revised title"}'::jsonb
       );`
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO content_revisions (
           id, case_id, target_type, target_id, owner_id, revision_number, snapshot
         ) VALUES (
           'revision-active-conflict', 'case-revision', 'post', 'post-revision',
           'user-revision-owner', 2, '{}'::jsonb
         )`
      ),
      (error) => error.code === "23505" && error.constraint === "content_revisions_one_active_case"
    );

    await pool.query(
      `UPDATE content_revisions SET status = 'rejected' WHERE id = 'revision-1';
       INSERT INTO content_revisions (
         id, case_id, target_type, target_id, owner_id, revision_number, snapshot
       ) VALUES (
         'revision-2', 'case-revision', 'post', 'post-revision',
         'user-revision-owner', 2, '{"title":"Second revision"}'::jsonb
       );`
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO content_revisions (
           id, case_id, target_type, target_id, owner_id, revision_number, snapshot, status
         ) VALUES (
           'revision-duplicate', 'case-revision', 'post', 'post-revision',
           'user-revision-owner', 1, '{}'::jsonb, 'rejected'
         )`
      ),
      (error) => error.code === "23505" && error.constraint === "content_revisions_target_number"
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO safety_appeals (
           id, case_id, decision_action_id, owner_id, detail
         ) VALUES (
           'appeal-cross-case', 'case-revision', 'action-appeal-decision',
           'user-revision-owner', 'This action belongs to another case.'
         )`
      ),
      (error) => error.code === "23503" && error.constraint === "safety_appeals_decision_case_fkey"
    );

    const sameCaseAppeal = await pool.query(
      `INSERT INTO safety_appeals (
         id, case_id, decision_action_id, owner_id, detail
       ) VALUES (
         'appeal-1', 'case-appeal', 'action-appeal-decision',
         'user-revision-owner', 'Please review this decision.'
       )
       RETURNING case_id, decision_action_id`
    );
    assert.deepEqual(sameCaseAppeal.rows[0], {
      case_id: "case-appeal",
      decision_action_id: "action-appeal-decision"
    });

    await assert.rejects(
      pool.query(
        `INSERT INTO safety_appeals (
           id, case_id, decision_action_id, owner_id, detail
         ) VALUES (
           'appeal-duplicate', 'case-appeal', 'action-appeal-decision',
           'user-revision-owner', 'A second appeal should be rejected.'
         )`
      ),
      (error) => error.code === "23505" && error.constraint === "safety_appeals_one_per_decision"
    );

    await applyDownMigration("015_content_revisions.sql");

    const rollback = await pool.query(
      `SELECT
         to_regclass('public.content_revisions') AS content_revisions,
         to_regclass('public.safety_appeals') AS safety_appeals,
         to_regclass('public.safety_cases') AS safety_cases,
         to_regclass('public.reports') AS reports,
         EXISTS (SELECT 1 FROM users WHERE id = 'user-revision-owner') AS owner_exists,
         (SELECT count(*)::int FROM safety_cases WHERE id IN ('case-revision', 'case-appeal')) AS case_count,
         (SELECT count(*)::int FROM safety_actions
          WHERE id IN ('action-revision-decision', 'action-appeal-decision')) AS action_count,
         EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'safety_actions_id_case_unique'
             AND conrelid = 'safety_actions'::regclass
         ) AS action_case_constraint`
    );
    assert.deepEqual(rollback.rows[0], {
      content_revisions: null,
      safety_appeals: null,
      safety_cases: "safety_cases",
      reports: "reports",
      owner_exists: true,
      case_count: 2,
      action_count: 2,
      action_case_constraint: false
    });

    await applyMigration("015_content_revisions.sql");
    const reapplied = await pool.query(
      `SELECT
         to_regclass('public.content_revisions') AS content_revisions,
         to_regclass('public.safety_appeals') AS safety_appeals,
         EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'safety_actions_id_case_unique'
             AND conrelid = 'safety_actions'::regclass
         ) AS action_case_constraint`
    );
    assert.deepEqual(reapplied.rows[0], {
      content_revisions: "content_revisions",
      safety_appeals: "safety_appeals",
      action_case_constraint: true
    });
  });
});

test("appealed-case aggregation migration permits a separate new case and blocks an unsafe down", async () => {
  await withMigrationDatabase(async ({ pool, applyMigration, applyDownMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("016_appealed_case_aggregation.sql");

    await pool.query(
      `INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope, status)
       VALUES
         ('case-appealed-old', 'post', 'post-shared', 'other', 'post', 'appealed'),
         ('case-open-new', 'post', 'post-shared', 'other', 'post', 'manual_review')`
    );
    const migrated = await pool.query(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'safety_cases_one_open_subject_category'`
    );
    assert.match(migrated.rows[0].indexdef, /'appealed'/);

    await assert.rejects(
      applyDownMigration("016_appealed_case_aggregation.sql"),
      /cannot roll back 016 while appealed and open safety cases coexist/
    );
    const blocked = await pool.query(
      `SELECT
         (SELECT indexdef
          FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'safety_cases_one_open_subject_category') AS indexdef,
         (SELECT count(*)::int
          FROM safety_cases
          WHERE id IN ('case-appealed-old', 'case-open-new')) AS case_count,
         (SELECT count(*)::int
          FROM schema_migrations
          WHERE version = '016_appealed_case_aggregation.sql') AS migration_count`
    );
    assert.match(blocked.rows[0].indexdef, /'appealed'/);
    assert.equal(blocked.rows[0].case_count, 2);
    assert.equal(blocked.rows[0].migration_count, 1);

    await pool.query("DELETE FROM safety_cases WHERE id = 'case-open-new'");
    await applyDownMigration("016_appealed_case_aggregation.sql");
    const rolledBack = await pool.query(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'safety_cases_one_open_subject_category'`
    );
    assert.doesNotMatch(rolledBack.rows[0].indexdef, /'appealed'/);
  });
});
