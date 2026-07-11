import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { closeDatabase, pool, withMigrationDatabase } from "../helpers/database.js";

test.after(closeDatabase);

test("database helper rejects unsafe database environments before loading database code", () => {
  const helperURL = new URL("../helpers/database.js", import.meta.url).href;
  const dbLoadProbe = `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.endsWith("/src/db.js")) process.stderr.write(String.fromCharCode(68, 66, 95, 76, 79, 65, 68, 95, 72, 73, 84, 10));
      return nextResolve(specifier, context);
    }
  `)}`;
  const unsafeEnvironments = [
    {
      DATABASE_URL: "postgresql://database.example/zbt_safety_test_guard",
      DB_HOST: "",
      expectedError: /loopback/i
    },
    {
      DATABASE_URL: "postgresql://127.0.0.1/zbt_safety_test_guard",
      DB_HOST: "production-rds.internal",
      expectedError: /DB_HOST/
    },
    {
      DATABASE_URL: "postgresql://127.0.0.1/zbt_safety_test_guard?host=database.example",
      DB_HOST: "",
      expectedError: /query|fragment/i
    }
  ];

  for (const environment of unsafeEnvironments) {
    const result = spawnSync(process.execPath, [
      "--experimental-loader",
      dbLoadProbe,
      "--input-type=module",
      "--eval",
      `
        import net from "node:net";
        const connect = net.Socket.prototype.connect;
        net.Socket.prototype.connect = function (...args) {
          process.stderr.write(String.fromCharCode(78, 69, 84, 95, 72, 73, 84, 10));
          return connect.apply(this, args);
        };
        await import(${JSON.stringify(helperURL)});
      `
    ], {
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test", ...environment }
    });

    assert.notEqual(result.status, 0, `unsafe environment imported database helper: ${JSON.stringify(environment)}`);
    assert.match(result.stderr, environment.expectedError);
    assert.doesNotMatch(result.stderr, /DB_LOAD_HIT|NET_HIT/);
  }
});

test("safety migration creates report replacement indexes before removing the legacy index", async () => {
  const sql = await readFile(fileURLToPath(new URL("../../sql/013_safety_cases.sql", import.meta.url)), "utf8");
  const legacyIndexDrop = sql.indexOf("DROP INDEX reports_unique_reporter_target;");

  assert.ok(sql.indexOf("CREATE UNIQUE INDEX reports_unique_reporter_request") < legacyIndexDrop);
  assert.ok(sql.indexOf("CREATE UNIQUE INDEX reports_one_pending_reason") < legacyIndexDrop);
});

test("safety migration creates the empty-database contract", async () => {
  const tables = ["safety_cases", "safety_evidence", "safety_case_events", "safety_actions", "safety_jobs"];
  const { rows } = await pool.query(
    `SELECT table_name, to_regclass('public.' || table_name)::text AS regclass
     FROM unnest($1::text[]) AS tables(table_name)`,
    [tables]
  );

  assert.deepEqual(rows.filter((row) => row.regclass).map((row) => row.table_name).sort(), tables.sort());

  const postColumns = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'safety_status'`
  );
  assert.equal(postColumns.rowCount, 1);

  const view = await pool.query("SELECT to_regclass('public.posts_with_safety_context') AS name");
  assert.equal(view.rows[0].name, "posts_with_safety_context");
});

test("safety migration upgrades legacy reports and replaces target uniqueness", async () => {
  await withMigrationDatabase(async ({ pool: migrationPool, applyMigration }) => {
    await seedLegacyReports(migrationPool);
    await applyMigration("013_safety_cases.sql");

    const reports = await migrationPool.query(
      `SELECT id, client_request_id, case_id, source_type, source_id, subject_type, subject_id, reason_code,
              reason, detail, reporter_id, status
       FROM reports
       ORDER BY id`
    );
    const pending = reports.rows.find((report) => report.id === "rp-legacy-pending");
    const closed = reports.rows.find((report) => report.id === "rp-legacy-closed");
    const invalid = reports.rows.find((report) => report.id === "rp-legacy-invalid");

    assert.deepEqual(pending, {
      id: "rp-legacy-pending",
      client_request_id: "legacy-rp-legacy-pending",
      case_id: legacyCaseID("post", "post-legacy-pending"),
      source_type: "post",
      source_id: "post-legacy-pending",
      subject_type: "post",
      subject_id: "post-legacy-pending",
      reason_code: "other",
      reason: "original pending reason",
      detail: "original pending detail",
      reporter_id: "user-legacy-reporter",
      status: "pending"
    });
    assert.equal(closed.status, "closed");
    assert.equal(invalid.status, "invalid");

    const indexes = await migrationPool.query(
      `SELECT to_regclass('public.reports_unique_reporter_target') AS legacy_index,
              to_regclass('public.reports_unique_reporter_request') AS request_index,
              to_regclass('public.reports_one_pending_reason') AS pending_reason_index`
    );
    assert.deepEqual(indexes.rows[0], {
      legacy_index: null,
      request_index: "reports_unique_reporter_request",
      pending_reason_index: "reports_one_pending_reason"
    });
  });
});

test("safety migration rolls back to the usable legacy report schema", async () => {
  await withMigrationDatabase(async ({ pool: migrationPool, applyMigration, applyDownMigration }) => {
    await seedLegacyReports(migrationPool);
    await applyMigration("013_safety_cases.sql");
    await migrationPool.query(
      `INSERT INTO reports (
        id, target_type, target_id, reason, detail, reporter_id, status,
        client_request_id, case_id, source_type, source_id, subject_type, subject_id, reason_code
      ) VALUES (
        'rp-rollback-duplicate', 'post', 'post-legacy-pending', 'new reason', 'new detail', 'user-legacy-reporter', 'pending',
        'request-rollback-duplicate', $1, 'post', 'post-legacy-pending', 'post', 'post-legacy-pending', 'different-reason'
      )`,
      [legacyCaseID("post", "post-legacy-pending")]
    );

    await applyDownMigration("013_safety_cases.sql");

    const legacyReport = await migrationPool.query(
      "SELECT reason, detail, reporter_id FROM reports WHERE id = 'rp-legacy-pending'"
    );
    assert.deepEqual(legacyReport.rows[0], {
      reason: "original pending reason",
      detail: "original pending detail",
      reporter_id: "user-legacy-reporter"
    });

    const rollbackState = await migrationPool.query(
      `SELECT
         to_regclass('public.reports_unique_reporter_target') AS legacy_index,
         to_regclass('public.reports_unique_reporter_request') AS request_index,
         to_regclass('public.safety_cases') AS safety_cases,
         EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'case_id'
         ) AS has_case_id,
         EXISTS (SELECT 1 FROM reports WHERE id = 'rp-rollback-duplicate') AS kept_duplicate`
    );
    assert.deepEqual(rollbackState.rows[0], {
      legacy_index: "reports_unique_reporter_target",
      request_index: null,
      safety_cases: null,
      has_case_id: false,
      kept_duplicate: false
    });
  });
});

test("report upload cleanup migration registers existing objects and adds bounded lookup indexes", async () => {
  await withMigrationDatabase(async ({ pool: migrationPool, applyMigration, applyDownMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await migrationPool.query(
      `INSERT INTO users (id, nickname) VALUES ('user-upload-owner', 'Upload owner');
       INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope)
       VALUES ('case-upload-cleanup', 'user', 'user-upload-owner', 'other', 'user');
       INSERT INTO safety_evidence (id, case_id, evidence_type, object_keys)
       VALUES (
         'evidence-upload-cleanup',
         'case-upload-cleanup',
         'report',
         ARRAY['report/user-upload-owner/2026/07/attached.jpg']
       );
       INSERT INTO safety_jobs (job_type, unique_key, payload, status, completed_at)
       VALUES
         (
           'cleanup_report_upload',
           'cleanup-report-upload:report/user-upload-owner/2026/07/attached.jpg',
           '{"objectKey":"report/user-upload-owner/2026/07/attached.jpg"}'::jsonb,
           'pending',
           NULL
         ),
         (
           'cleanup_report_upload',
           'cleanup-report-upload:report/user-upload-owner/2026/07/pending.jpg',
           '{"objectKey":"report/user-upload-owner/2026/07/pending.jpg"}'::jsonb,
           'pending',
           NULL
         ),
         (
           'cleanup_report_upload',
           'cleanup-report-upload:report/user-upload-owner/2026/07/deleted.jpg',
           '{"objectKey":"report/user-upload-owner/2026/07/deleted.jpg"}'::jsonb,
           'completed',
           now()
         ),
         (
           'cleanup_report_upload',
           'cleanup-report-upload:report/deleted-upload-owner/2026/07/orphaned-owner.jpg',
           '{"objectKey":"report/deleted-upload-owner/2026/07/orphaned-owner.jpg"}'::jsonb,
           'pending',
           NULL
         );`
    );

    await applyMigration("014_report_upload_cleanup.sql");

    const uploads = await migrationPool.query(
      `SELECT object_key, owner_user_id, state
       FROM report_uploads
       ORDER BY object_key`
    );
    assert.deepEqual(uploads.rows, [
      {
        object_key: "report/deleted-upload-owner/2026/07/orphaned-owner.jpg",
        owner_user_id: "deleted-upload-owner",
        state: "pending"
      },
      {
        object_key: "report/user-upload-owner/2026/07/attached.jpg",
        owner_user_id: "user-upload-owner",
        state: "attached"
      },
      {
        object_key: "report/user-upload-owner/2026/07/deleted.jpg",
        owner_user_id: "user-upload-owner",
        state: "deleted"
      },
      {
        object_key: "report/user-upload-owner/2026/07/pending.jpg",
        owner_user_id: "user-upload-owner",
        state: "pending"
      }
    ]);

    const indexes = await migrationPool.query(
      `SELECT
         to_regclass('public.report_uploads_owner_outstanding') AS outstanding,
         to_regclass('public.report_uploads_owner_issued') AS issued,
         to_regclass('public.report_uploads_cleanup_due') AS cleanup_due,
         to_regclass('public.safety_evidence_object_keys_gin') AS evidence_keys,
         to_regclass('public.safety_jobs_cleanup_retention') AS job_retention`
    );
    assert.deepEqual(indexes.rows[0], {
      outstanding: "report_uploads_owner_outstanding",
      issued: "report_uploads_owner_issued",
      cleanup_due: "report_uploads_cleanup_due",
      evidence_keys: "safety_evidence_object_keys_gin",
      job_retention: "safety_jobs_cleanup_retention"
    });

    await applyDownMigration("014_report_upload_cleanup.sql");
    const rollback = await migrationPool.query(
      `SELECT
         to_regclass('public.report_uploads') AS uploads,
         to_regclass('public.safety_evidence_object_keys_gin') AS evidence_keys,
         to_regclass('public.safety_jobs_cleanup_retention') AS job_retention,
         to_regclass('public.safety_jobs') AS safety_jobs`
    );
    assert.deepEqual(rollback.rows[0], {
      uploads: null,
      evidence_keys: null,
      job_retention: null,
      safety_jobs: "safety_jobs"
    });
  });
});

async function seedLegacyReports(client) {
  await client.query(
    `INSERT INTO users (id, nickname)
     VALUES ('user-legacy-reporter', 'Legacy reporter'), ('user-legacy-owner', 'Legacy owner')`
  );
  await client.query(
    `INSERT INTO posts (id, author_id, title, deadline)
     VALUES
       ('post-legacy-pending', 'user-legacy-owner', 'Pending target', now()),
       ('post-legacy-closed', 'user-legacy-owner', 'Closed target', now()),
       ('post-legacy-invalid', 'user-legacy-owner', 'Invalid target', now())`
  );
  await client.query(
    `INSERT INTO reports (id, target_type, target_id, reason, detail, reporter_id, status)
     VALUES
       ('rp-legacy-pending', 'post', 'post-legacy-pending', 'original pending reason', 'original pending detail', 'user-legacy-reporter', 'pending'),
       ('rp-legacy-closed', 'post', 'post-legacy-closed', 'original closed reason', 'original closed detail', 'user-legacy-reporter', 'hidden'),
       ('rp-legacy-invalid', 'post', 'post-legacy-invalid', 'original invalid reason', 'original invalid detail', 'user-legacy-reporter', 'review')`
  );
}

function legacyCaseID(subjectType, subjectID) {
  return `sc-legacy-${createHash("md5").update(`${subjectType}:${subjectID}:other`).digest("hex")}`;
}
