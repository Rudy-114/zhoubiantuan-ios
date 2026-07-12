import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { closeDatabase, withMigrationDatabase } from "../helpers/database.js";

const backendDirectory = fileURLToPath(new URL("../..", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

test.after(closeDatabase);

test("npm seed refuses a missing destructive demo-seed opt-in before mutation", async () => {
  await withMigrationDatabase(async ({ pool, applyMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("014_report_upload_cleanup.sql");
    await pool.query("INSERT INTO users (id, nickname) VALUES ('u-opt-in-sentinel', 'Opt-in sentinel')");
    const before = await seedMutationCounts(pool);
    const databaseURL = await currentDatabaseURL(pool);

    const result = invokeSeed(databaseURL, {
      ...allowedSeedEnvironment(databaseURL),
      ALLOW_DEMO_SEED: undefined
    });

    assert.notEqual(result.status, 0, "seed without opt-in unexpectedly succeeded");
    assert.match(`${result.stdout}\n${result.stderr}`, /ALLOW_DEMO_SEED=true/);
    assert.deepEqual(await seedMutationCounts(pool), before);
  });
});

test("npm seed refuses a missing connected-database allowlist before mutation", async () => {
  await withMigrationDatabase(async ({ pool, applyMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("014_report_upload_cleanup.sql");
    await pool.query("INSERT INTO users (id, nickname) VALUES ('u-missing-allowlist-sentinel', 'Missing allowlist sentinel')");
    const before = await seedMutationCounts(pool);
    const databaseURL = await currentDatabaseURL(pool);

    const result = invokeSeed(databaseURL, {
      ...allowedSeedEnvironment(databaseURL),
      DEMO_SEED_DATABASE_ALLOWLIST: undefined
    });

    assert.notEqual(result.status, 0, "seed without a database allowlist unexpectedly succeeded");
    assert.match(`${result.stdout}\n${result.stderr}`, /DEMO_SEED_DATABASE_ALLOWLIST/);
    assert.deepEqual(await seedMutationCounts(pool), before);
  });
});

test("npm seed refuses a connected database absent from the exact allowlist before mutation", async () => {
  await withMigrationDatabase(async ({ pool, applyMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("014_report_upload_cleanup.sql");
    await pool.query("INSERT INTO users (id, nickname) VALUES ('u-wrong-allowlist-sentinel', 'Wrong allowlist sentinel')");
    const before = await seedMutationCounts(pool);
    const databaseURL = await currentDatabaseURL(pool);

    const result = invokeSeed(databaseURL, {
      ...allowedSeedEnvironment(databaseURL),
      DEMO_SEED_DATABASE_ALLOWLIST: "zbt_safety_test_different_database"
    });

    assert.notEqual(result.status, 0, "seed outside the exact database allowlist unexpectedly succeeded");
    assert.match(`${result.stdout}\n${result.stderr}`, /DEMO_SEED_DATABASE_ALLOWLIST/);
    assert.deepEqual(await seedMutationCounts(pool), before);
  });
});

test("npm seed refuses production before mutating the migrated database", async () => {
  await withMigrationDatabase(async ({ pool, applyMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("014_report_upload_cleanup.sql");
    await pool.query("INSERT INTO users (id, nickname) VALUES ('u-production-sentinel', 'Production sentinel')");
    const before = await seedMutationCounts(pool);

    const databaseURL = await currentDatabaseURL(pool);
    const result = invokeSeed(databaseURL, {
      ...allowedSeedEnvironment(databaseURL),
      NODE_ENV: "production"
    });

    assert.notEqual(result.status, 0, "production seed unexpectedly succeeded");
    assert.match(`${result.stdout}\n${result.stderr}`, /refus.*production/i);
    assert.deepEqual(await seedMutationCounts(pool), before);
  });
});

test("npm seed refuses a configured non-loopback database before mutation", async () => {
  await withMigrationDatabase(async ({ pool, applyMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("014_report_upload_cleanup.sql");
    await pool.query("INSERT INTO users (id, nickname) VALUES ('u-remote-sentinel', 'Remote sentinel')");
    const before = await seedMutationCounts(pool);
    const localDatabaseURL = await currentDatabaseURL(pool);
    const databaseURL = new URL(localDatabaseURL);
    databaseURL.hostname = "0.0.0.0";

    const result = invokeSeed(databaseURL.toString(), {
      ...allowedSeedEnvironment(localDatabaseURL),
      NODE_ENV: "development"
    });

    assert.notEqual(result.status, 0, "non-loopback seed unexpectedly succeeded");
    assert.match(`${result.stdout}\n${result.stderr}`, /refus.*non-loopback/i);
    assert.deepEqual(await seedMutationCounts(pool), before);
  });
});

test("npm seed repairs incoherent deterministic rows and preserves unrelated data", async () => {
  await withMigrationDatabase(async ({ pool, applyMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("014_report_upload_cleanup.sql");
    await insertUnrelatedFixture(pool);
    await insertIncoherentDemoFixture(pool);

    runSeed(await currentDatabaseURL(pool));

    const { rows } = await pool.query(
      `SELECT
         sc.subject_type AS case_subject_type,
         sc.subject_id AS case_subject_id,
         sc.category,
         sc.impact_scope,
         sc.status AS case_status,
         r.client_request_id,
         r.case_id,
         r.source_type,
         r.source_id,
         r.subject_type,
         r.subject_id,
         r.reason_code,
         r.reported_field,
         r.status AS report_status,
         e.case_id AS evidence_case_id,
         e.report_id AS evidence_report_id,
         e.client_request_id AS evidence_request_id,
         e.evidence_type,
         e.text_snapshot,
         e.structured_snapshot
       FROM safety_cases sc
       JOIN reports r ON r.id = 'rp-1'
       JOIN safety_evidence e ON e.id = 'se-demo-rp-1'
       WHERE sc.id = 'sc-demo-invalid-contact'`
    );
    assert.equal(rows.length, 1);
    const fixture = rows[0];
    assert.deepEqual(
      {
        case_subject_type: fixture.case_subject_type,
        case_subject_id: fixture.case_subject_id,
        category: fixture.category,
        impact_scope: fixture.impact_scope,
        case_status: fixture.case_status,
        client_request_id: fixture.client_request_id,
        case_id: fixture.case_id,
        source_type: fixture.source_type,
        source_id: fixture.source_id,
        subject_type: fixture.subject_type,
        subject_id: fixture.subject_id,
        reason_code: fixture.reason_code,
        reported_field: fixture.reported_field,
        report_status: fixture.report_status,
        evidence_case_id: fixture.evidence_case_id,
        evidence_report_id: fixture.evidence_report_id,
        evidence_request_id: fixture.evidence_request_id,
        evidence_type: fixture.evidence_type
      },
      {
        case_subject_type: "collection",
        case_subject_id: "col-winter-bucky",
        category: "invalid_contact",
        impact_scope: "collection",
        case_status: "received",
        client_request_id: "seed-demo-rp-1",
        case_id: "sc-demo-invalid-contact",
        source_type: "post",
        source_id: "p-badge",
        subject_type: "collection",
        subject_id: "col-winter-bucky",
        reason_code: "invalid_contact",
        reported_field: "contact_wechat",
        report_status: "pending",
        evidence_case_id: "sc-demo-invalid-contact",
        evidence_report_id: "rp-1",
        evidence_request_id: "seed-demo-rp-1",
        evidence_type: "post"
      }
    );
    assert.match(fixture.text_snapshot, /2026冬兵生日团吧唧拼谷/);
    assert.equal(fixture.structured_snapshot.source.id, "p-badge");
    assert.equal(fixture.structured_snapshot.source.collectionId, "col-winter-bucky");
    assert.deepEqual(fixture.structured_snapshot.report, {
      reasonCode: "invalid_contact",
      reportedField: "contact_wechat",
      detail: "用户反馈微信搜索不到，需团长确认。",
      supplemental: false
    });

    const unrelated = await pool.query(
      `SELECT u.nickname, u.bio, p.title, p.description, c.body,
              EXISTS (
                SELECT 1 FROM follows
                WHERE follower_id = 'u-unrelated-follower' AND following_id = 'u-unrelated-owner'
              ) AS relationship_preserved
       FROM users u
       JOIN posts p ON p.id = 'p-unrelated' AND p.author_id = u.id
       JOIN comments c ON c.id = 'c-unrelated' AND c.post_id = p.id
       WHERE u.id = 'u-unrelated-owner'`
    );
    assert.deepEqual(unrelated.rows[0], {
      nickname: "Unrelated owner",
      bio: "Do not overwrite",
      title: "Unrelated post",
      description: "Unrelated description",
      body: "Unrelated comment",
      relationship_preserved: true
    });
  });
});

test("npm seed fails closed on an ambiguous deterministic evidence collision", async () => {
  await withMigrationDatabase(async ({ pool, applyMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("014_report_upload_cleanup.sql");
    await insertAmbiguousEvidenceCollision(pool);
    const before = await seedMutationCounts(pool);

    const result = invokeSeed(await currentDatabaseURL(pool));

    assert.notEqual(result.status, 0, "ambiguous fixture collision unexpectedly succeeded");
    assert.match(`${result.stdout}\n${result.stderr}`, /refus.*ambiguous demo safety fixture collision/i);
    assert.deepEqual(await seedMutationCounts(pool), before);
    const evidence = await pool.query(
      "SELECT case_id, report_id, client_request_id, evidence_type, text_snapshot FROM safety_evidence WHERE id = 'se-demo-rp-1'"
    );
    assert.deepEqual(evidence.rows[0], {
      case_id: "sc-unrelated-evidence",
      report_id: "rp-unrelated-evidence",
      client_request_id: "unrelated-evidence-request",
      evidence_type: "user",
      text_snapshot: "Unrelated evidence must survive"
    });
  });
});

test("npm seed cleans the orphaned case from the real migration repair path", async () => {
  await withMigrationDatabase(async ({ pool, applyMigration }) => {
    await insertOriginalLegacyDemoReport(pool);
    await applyMigration("013_safety_cases.sql");
    await applyMigration("014_report_upload_cleanup.sql");

    const migrated = await pool.query(
      `SELECT r.case_id
       FROM reports r
       JOIN safety_cases sc ON sc.id = r.case_id
       WHERE r.id = 'rp-1'`
    );
    assert.equal(migrated.rowCount, 1);
    const legacyCaseID = migrated.rows[0].case_id;
    assert.match(legacyCaseID, /^sc-legacy-/);

    const databaseURL = await currentDatabaseURL(pool);
    runSeed(databaseURL);
    runSeed(databaseURL);

    const repaired = await pool.query(
      `SELECT
         r.case_id,
         r.client_request_id,
         r.subject_type,
         r.subject_id,
         r.reason_code,
         r.reported_field,
         sc.subject_type AS case_subject_type,
         sc.subject_id AS case_subject_id,
         sc.category,
         sc.impact_scope,
         e.id AS evidence_id,
         e.case_id AS evidence_case_id,
         e.report_id AS evidence_report_id,
         e.client_request_id AS evidence_request_id,
         e.evidence_type
       FROM reports r
       JOIN safety_cases sc ON sc.id = r.case_id
       JOIN safety_evidence e ON e.report_id = r.id
       WHERE r.id = 'rp-1'`
    );
    assert.deepEqual(repaired.rows, [{
      case_id: "sc-demo-invalid-contact",
      client_request_id: "seed-demo-rp-1",
      subject_type: "collection",
      subject_id: "col-winter-bucky",
      reason_code: "invalid_contact",
      reported_field: "contact_wechat",
      case_subject_type: "collection",
      case_subject_id: "col-winter-bucky",
      category: "invalid_contact",
      impact_scope: "collection",
      evidence_id: "se-demo-rp-1",
      evidence_case_id: "sc-demo-invalid-contact",
      evidence_report_id: "rp-1",
      evidence_request_id: "seed-demo-rp-1",
      evidence_type: "post"
    }]);

    const counts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM reports WHERE id = 'rp-1') AS reports,
         (SELECT count(*)::int FROM safety_cases WHERE id = 'sc-demo-invalid-contact') AS deterministic_cases,
         (SELECT count(*)::int FROM safety_cases WHERE id = $1) AS migrated_cases,
         (SELECT count(*)::int FROM safety_evidence WHERE report_id = 'rp-1') AS evidence`,
      [legacyCaseID]
    );
    assert.deepEqual(counts.rows[0], {
      reports: 1,
      deterministic_cases: 1,
      migrated_cases: 0,
      evidence: 1
    });
  });
});

test("npm seed establishes the migrated demo fixture idempotently", async () => {
  await withMigrationDatabase(async ({ pool, applyMigration }) => {
    await applyMigration("013_safety_cases.sql");
    await applyMigration("014_report_upload_cleanup.sql");
    const databaseURL = await currentDatabaseURL(pool);

    runSeed(databaseURL);
    runSeed(databaseURL);

    const preservedFixture = await pool.query(
      `SELECT
         ARRAY(SELECT id FROM users WHERE id = ANY($1::text[]) ORDER BY id) AS user_ids,
         ARRAY(SELECT id FROM posts WHERE id = ANY($2::text[]) ORDER BY id) AS post_ids,
         ARRAY(SELECT id FROM comments WHERE id = ANY($3::text[]) ORDER BY id) AS comment_ids`,
      [
        ["u-me", "u-black", "u-moon", "u-berry", "u-echo"],
        ["p-card", "p-badge", "p-stand", "p-plush", "p-album", "p-my-pinggu"],
        ["c-1", "c-2", "c-3", "c-4"]
      ]
    );
    assert.deepEqual(preservedFixture.rows[0], {
      user_ids: ["u-berry", "u-black", "u-echo", "u-me", "u-moon"],
      post_ids: ["p-album", "p-badge", "p-card", "p-my-pinggu", "p-plush", "p-stand"],
      comment_ids: ["c-1", "c-2", "c-3", "c-4"]
    });

    const safetyFixture = await pool.query(
      `SELECT
         r.id AS report_id,
         r.client_request_id,
         r.source_type,
         r.source_id,
         r.subject_type,
         r.subject_id,
         r.reason_code,
         r.reported_field,
         r.status AS report_status,
         sc.id AS case_id,
         sc.category,
         sc.impact_scope,
         sc.status AS case_status,
         e.id AS evidence_id,
         e.client_request_id AS evidence_request_id,
         e.evidence_type,
         e.text_snapshot,
         e.structured_snapshot,
         e.object_keys
       FROM reports r
       JOIN safety_cases sc
         ON sc.id = r.case_id
        AND sc.subject_type = r.subject_type
        AND sc.subject_id = r.subject_id
        AND sc.category = r.reason_code
       JOIN posts p
         ON p.id = r.source_id
        AND r.source_type = 'post'
       JOIN group_collections collection
         ON collection.id = r.subject_id
        AND collection.id = p.collection_id
        AND r.subject_type = 'collection'
       JOIN safety_evidence e
         ON e.case_id = sc.id
        AND e.report_id = r.id
        AND e.client_request_id = r.client_request_id
       WHERE r.id = 'rp-1'`
    );

    assert.equal(safetyFixture.rowCount, 1);
    const fixture = safetyFixture.rows[0];
    assert.deepEqual(
      {
        report_id: fixture.report_id,
        client_request_id: fixture.client_request_id,
        source_type: fixture.source_type,
        source_id: fixture.source_id,
        subject_type: fixture.subject_type,
        subject_id: fixture.subject_id,
        reason_code: fixture.reason_code,
        reported_field: fixture.reported_field,
        report_status: fixture.report_status,
        case_id: fixture.case_id,
        category: fixture.category,
        impact_scope: fixture.impact_scope,
        case_status: fixture.case_status,
        evidence_id: fixture.evidence_id,
        evidence_request_id: fixture.evidence_request_id,
        evidence_type: fixture.evidence_type,
        object_keys: fixture.object_keys
      },
      {
        report_id: "rp-1",
        client_request_id: "seed-demo-rp-1",
        source_type: "post",
        source_id: "p-badge",
        subject_type: "collection",
        subject_id: "col-winter-bucky",
        reason_code: "invalid_contact",
        reported_field: "contact_wechat",
        report_status: "pending",
        case_id: "sc-demo-invalid-contact",
        category: "invalid_contact",
        impact_scope: "collection",
        case_status: "received",
        evidence_id: "se-demo-rp-1",
        evidence_request_id: "seed-demo-rp-1",
        evidence_type: "post",
        object_keys: []
      }
    );
    assert.match(fixture.text_snapshot, /2026冬兵生日团吧唧拼谷/);
    assert.deepEqual(fixture.structured_snapshot.report, {
      reasonCode: "invalid_contact",
      reportedField: "contact_wechat",
      detail: "用户反馈微信搜索不到，需团长确认。",
      supplemental: false
    });
    assert.equal(fixture.structured_snapshot.source.id, fixture.source_id);
    assert.equal(fixture.structured_snapshot.source.collectionId, fixture.subject_id);

    const fixtureCounts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM reports WHERE id = 'rp-1') AS reports,
         (SELECT count(*)::int FROM safety_cases
          WHERE subject_type = 'collection'
            AND subject_id = 'col-winter-bucky'
            AND category = 'invalid_contact') AS cases,
         (SELECT count(*)::int FROM safety_evidence
          WHERE report_id = 'rp-1'
            AND client_request_id = 'seed-demo-rp-1') AS evidence`
    );
    assert.deepEqual(fixtureCounts.rows[0], { reports: 1, cases: 1, evidence: 1 });
  });
});

async function currentDatabaseURL(pool) {
  const { rows } = await pool.query("SELECT current_database() AS name");
  const databaseURL = new URL(process.env.DATABASE_URL);
  databaseURL.pathname = `/${rows[0].name}`;
  return databaseURL.toString();
}

function runSeed(databaseURL) {
  const result = invokeSeed(databaseURL);

  assert.equal(
    result.status,
    0,
    `npm run seed failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  assert.match(result.stdout, /seed complete/);
}

function invokeSeed(databaseURL, environment = {}) {
  const childEnvironment = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: databaseURL,
    DB_HOST: "",
    DB_NAME: "",
    DB_USER: "",
    DB_PASSWORD: "",
    MODERATION_PROVIDER: "mock",
    SAFETY_AI_MODE: "off",
    ...allowedSeedEnvironment(databaseURL)
  };
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete childEnvironment[name];
    else childEnvironment[name] = value;
  }
  const result = spawnSync(npmCommand, ["run", "seed"], {
    cwd: backendDirectory,
    encoding: "utf8",
    env: childEnvironment
  });
  return result;
}

function allowedSeedEnvironment(databaseURL) {
  const parsed = new URL(databaseURL);
  return {
    ALLOW_DEMO_SEED: "true",
    DEMO_SEED_DATABASE_ALLOWLIST: decodeURIComponent(parsed.pathname).replace(/^\/+/, "")
  };
}

async function seedMutationCounts(pool) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM users) AS users,
       (SELECT count(*)::int FROM group_collections) AS collections,
       (SELECT count(*)::int FROM posts) AS posts,
       (SELECT count(*)::int FROM comments) AS comments,
       (SELECT count(*)::int FROM post_likes) AS likes,
       (SELECT count(*)::int FROM post_favorites) AS favorites,
       (SELECT count(*)::int FROM follows) AS follows,
       (SELECT count(*)::int FROM safety_cases) AS cases,
       (SELECT count(*)::int FROM reports) AS reports,
       (SELECT count(*)::int FROM safety_evidence) AS evidence`
  );
  return rows[0];
}

async function insertUnrelatedFixture(pool) {
  await pool.query(
    `INSERT INTO users (id, nickname, bio)
     VALUES
       ('u-unrelated-owner', 'Unrelated owner', 'Do not overwrite'),
       ('u-unrelated-follower', 'Unrelated follower', 'Keep relationship');
     INSERT INTO posts (id, author_id, title, deadline, description)
     VALUES ('p-unrelated', 'u-unrelated-owner', 'Unrelated post', now() + interval '1 day', 'Unrelated description');
     INSERT INTO comments (id, post_id, author_id, body)
     VALUES ('c-unrelated', 'p-unrelated', 'u-unrelated-follower', 'Unrelated comment');
     INSERT INTO follows (follower_id, following_id)
     VALUES ('u-unrelated-follower', 'u-unrelated-owner');`
  );
}

async function insertIncoherentDemoFixture(pool) {
  await pool.query(
    `INSERT INTO users (id, nickname) VALUES ('u-me', 'Stale demo reporter');
     INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope, status)
     VALUES ('sc-demo-invalid-contact', 'post', 'p-badge', 'other', 'post', 'monitoring');
     INSERT INTO reports (
       id, target_type, target_id, reason, detail, reporter_id, status,
       client_request_id, case_id, source_type, source_id, subject_type, subject_id, reason_code, reported_field
     ) VALUES (
       'rp-1', 'post', 'p-badge', '无效联系方式', '用户反馈微信搜索不到，需团长确认。', 'u-me', 'pending',
       'stale-seed-request', 'sc-demo-invalid-contact', 'post', 'p-badge', 'post', 'p-badge', 'other', 'content'
     );
     INSERT INTO safety_evidence (
       id, case_id, report_id, client_request_id, evidence_type, text_snapshot, structured_snapshot
     ) VALUES (
       'se-demo-rp-1', 'sc-demo-invalid-contact', 'rp-1', 'stale-seed-request', 'user', 'stale evidence',
       '{"source":{"id":"wrong"},"report":{"reasonCode":"other"}}'::jsonb
     );`
  );
}

async function insertAmbiguousEvidenceCollision(pool) {
  await pool.query(
    `INSERT INTO users (id, nickname) VALUES ('u-unrelated-evidence', 'Unrelated evidence owner');
     INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope)
     VALUES ('sc-unrelated-evidence', 'user', 'u-unrelated-evidence', 'other', 'user');
     INSERT INTO reports (
       id, target_type, target_id, reporter_id, client_request_id, case_id,
       source_type, source_id, subject_type, subject_id, reason_code, reported_field
     ) VALUES (
       'rp-unrelated-evidence', 'user', 'u-unrelated-evidence', 'u-unrelated-evidence',
       'unrelated-report-request', 'sc-unrelated-evidence',
       'user', 'u-unrelated-evidence', 'user', 'u-unrelated-evidence', 'other', 'content'
     );
     INSERT INTO safety_evidence (
       id, case_id, report_id, client_request_id, evidence_type, text_snapshot
     ) VALUES (
       'se-demo-rp-1', 'sc-unrelated-evidence', 'rp-unrelated-evidence',
       'unrelated-evidence-request', 'user', 'Unrelated evidence must survive'
     );`
  );
}

async function insertOriginalLegacyDemoReport(pool) {
  await pool.query(
    `INSERT INTO users (id, nickname) VALUES ('u-me', 'Legacy demo reporter');
     INSERT INTO reports (id, target_type, target_id, reason, detail, reporter_id)
     VALUES (
       'rp-1', 'post', 'p-badge', '无效联系方式',
       '用户反馈微信搜索不到，需团长确认。', 'u-me'
     );`
  );
}
