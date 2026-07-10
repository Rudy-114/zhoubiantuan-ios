# Safety Case Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the narrow post/comment report insert with a production safety-case backend that accepts five targets, preserves immutable evidence, aggregates idempotently, applies reversible restrictions, computes collection cascade visibility, and runs asynchronous jobs from PostgreSQL.

**Architecture:** Add one additive migration and focused modules under `backend/src/safety`. Existing content rows keep their moderation `status`; separate `safety_status` and `contact_visibility` fields represent reversible restrictions. A `posts_with_safety_context` view exposes parent collection safety state without mutating child posts. Express routes are thin; all report writes happen in one transaction and all provider work stays in jobs.

**Tech Stack:** Node.js 20, Express 4, PostgreSQL 16, `pg`, Node test runner, temporary local PostgreSQL 16 launched by a repository script.

## Global Constraints

- `POST /api/reports` performs no external network call.
- The server, never the client or model, resolves source object to case subject.
- `clientRequestID` is unique per reporter and returns the original report on retry.
- One reporter, subject, and reason can have only one pending clue; evidence supplements append.
- Report evidence is immutable through public APIs.
- A direct-message report requires the reporter to be a thread participant and the selected message to be sent by the other participant.
- A direct-message snapshot includes the selected message plus at most three messages before and after.
- The existing permanent `reports_unique_reporter_target` index is removed only after replacement indexes exist in the same migration.
- Collection `safety_status='suspended'` hides child posts effectively but does not update child `posts.safety_status`.
- Test code never connects to the configured production RDS.
- Deploy this phase with `SAFETY_CASES_ENABLED=false` and `SAFETY_AI_MODE=off`.

---

### Task 1: Add a Disposable PostgreSQL Test Harness

**Files:**
- Create: `backend/scripts/run-db-tests.sh`
- Create: `backend/test/helpers/database.js`
- Modify: `backend/package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm --prefix backend run test:db` and `resetDatabase()`.
- Consumes: PostgreSQL binaries from `PG_BINDIR`, defaulting to `/opt/homebrew/opt/postgresql@16/bin`.

- [ ] **Step 1: Write the test helper that refuses production-like databases**

```js
import assert from "node:assert/strict";
import { pool } from "../../src/db.js";

export async function resetDatabase() {
  const { rows } = await pool.query("SELECT current_database() AS name, inet_server_addr()::text AS host");
  assert.match(rows[0].name, /^zbt_safety_test_/);
  assert.ok([null, "127.0.0.1", "::1"].includes(rows[0].host), `refusing non-local test database host ${rows[0].host}`);
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'");
  for (const { tablename } of tables.rows) {
    await pool.query(`TRUNCATE TABLE ${JSON.stringify(tablename)} RESTART IDENTITY CASCADE`);
  }
}

export async function closeDatabase() {
  await pool.end();
}
```

- [ ] **Step 2: Add the temporary-server script**

```bash
#!/usr/bin/env bash
set -euo pipefail

PG_BINDIR="${PG_BINDIR:-/opt/homebrew/opt/postgresql@16/bin}"
for binary in initdb pg_ctl createdb dropdb; do
  test -x "$PG_BINDIR/$binary" || {
    printf 'PostgreSQL 16 test binaries missing. Run: brew install postgresql@16\n' >&2
    exit 1
  }
done

root="$(mktemp -d "${TMPDIR:-/tmp}/zbt-safety-pg.XXXXXX")"
port="${ZBT_TEST_PG_PORT:-55432}"
database="zbt_safety_test_$$"
cleanup() {
  "$PG_BINDIR/dropdb" -h 127.0.0.1 -p "$port" "$database" >/dev/null 2>&1 || true
  "$PG_BINDIR/pg_ctl" -D "$root/data" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$root"
}
trap cleanup EXIT

"$PG_BINDIR/initdb" -D "$root/data" --auth=trust --no-locale >/dev/null
"$PG_BINDIR/pg_ctl" -D "$root/data" -o "-h 127.0.0.1 -p $port" -w start >/dev/null
"$PG_BINDIR/createdb" -h 127.0.0.1 -p "$port" "$database"

export NODE_ENV=test
export DATABASE_URL="postgresql://127.0.0.1:$port/$database"
export DB_HOST=""
export DB_NAME=""
export DB_USER=""
export DB_PASSWORD=""
export JWT_SECRET="test-jwt-secret-with-more-than-thirty-two-characters"
export EMAIL_CODE_SECRET="test-email-secret-with-more-than-thirty-two-characters"
export OSS_BUCKET="test-bucket"
export OSS_REGION="cn-shanghai"
export OSS_ENDPOINT="oss-cn-shanghai.aliyuncs.com"
export ALIYUN_ACCESS_KEY_ID="test-access-key"
export ALIYUN_ACCESS_KEY_SECRET="test-access-secret"
export SAFETY_CASES_ENABLED=true
export SAFETY_AI_MODE=off

node scripts/migrate.js
tests=()
while IFS= read -r file; do tests+=("$file"); done < <(find test -type f -name '*.integration.test.js' | sort)
if test "${#tests[@]}" -eq 0; then
  printf 'No database integration tests found.\n'
else
  node --test --test-concurrency=1 "${tests[@]}"
fi
```

- [ ] **Step 3: Register the command and ignored test artifacts**

Add this script entry:

```json
"test:db": "bash scripts/run-db-tests.sh"
```

Add to `.gitignore`:

```gitignore
# Temporary local PostgreSQL safety tests
.tmp-postgres/
```

- [ ] **Step 4: Verify the harness fails safely before PostgreSQL is installed**

Run:

```bash
npm --prefix backend run test:db
```

Expected before installation: a single actionable message naming `brew install postgresql@16`; it must not fall back to RDS.

- [ ] **Step 5: Install PostgreSQL 16 and rerun the empty harness**

Run:

```bash
brew install postgresql@16
npm --prefix backend run test:db
```

Expected: migrations apply, then the script prints `No database integration tests found.` without contacting production.

- [ ] **Step 6: Commit the test harness**

```bash
git add backend/scripts/run-db-tests.sh backend/test/helpers/database.js backend/package.json .gitignore
git commit -m "Add isolated PostgreSQL test harness"
```

### Task 2: Add the Core Safety Schema and Legacy Report Migration

**Files:**
- Create: `backend/sql/013_safety_cases.sql`
- Create: `backend/sql/down/013_safety_cases.sql`
- Create: `backend/test/safety/migration.integration.test.js`

**Interfaces:**
- Produces: `safety_cases`, expanded `reports`, `safety_evidence`, `safety_case_events`, `safety_actions`, `safety_jobs`, content `safety_status`, collection `contact_visibility`, and `posts_with_safety_context`.

- [ ] **Step 1: Write a failing migration contract test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../src/db.js";

test("safety migration exposes core tables and separates content from safety state", async () => {
  const { rows } = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
    ORDER BY table_name`,
    [["safety_cases", "safety_evidence", "safety_case_events", "safety_actions", "safety_jobs"]]
  );
  assert.deepEqual(rows.map((row) => row.table_name), ["safety_actions", "safety_case_events", "safety_cases", "safety_evidence", "safety_jobs"]);
  const postColumns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'posts'");
  assert.ok(postColumns.rows.some((row) => row.column_name === "safety_status"));
  const view = await pool.query("SELECT 1 FROM information_schema.views WHERE table_name = 'posts_with_safety_context'");
  assert.equal(view.rowCount, 1);
});
```

- [ ] **Step 2: Run the database test and verify failure**

Run:

```bash
npm --prefix backend run test:db
```

Expected: FAIL because migration `013_safety_cases.sql` does not exist.

- [ ] **Step 3: Create the additive schema**

The migration must use these exact state sets and columns:

```sql
CREATE TABLE safety_cases (
  id text PRIMARY KEY,
  subject_type text NOT NULL CHECK (subject_type IN ('post', 'comment', 'user', 'direct_message', 'collection')),
  subject_id text NOT NULL,
  category text NOT NULL,
  impact_scope text NOT NULL CHECK (impact_scope IN ('post', 'comment', 'user', 'direct_message', 'collection')),
  status text NOT NULL DEFAULT 'received' CHECK (status IN (
    'received', 'triaging', 'monitoring', 'manual_review', 'awaiting_correction',
    'rechecking', 'appealed', 'resolved_no_action', 'resolved_restored', 'resolved_actioned'
  )),
  risk_level text NOT NULL DEFAULT 'none' CHECK (risk_level IN ('none', 'low', 'medium', 'high', 'urgent')),
  confidence numeric(5,4) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  ai_recommendation jsonb NOT NULL DEFAULT '{}'::jsonb,
  manual_hold boolean NOT NULL DEFAULT false,
  correction_due_at timestamptz,
  model_version text NOT NULL DEFAULT '',
  prompt_version text NOT NULL DEFAULT '',
  policy_version text NOT NULL DEFAULT 'safety-policy-v1',
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX safety_cases_one_open_subject_category
  ON safety_cases (subject_type, subject_id, category)
  WHERE status NOT IN ('resolved_no_action', 'resolved_restored', 'resolved_actioned');

ALTER TABLE reports
  ADD COLUMN client_request_id text,
  ADD COLUMN case_id text REFERENCES safety_cases(id) ON DELETE RESTRICT,
  ADD COLUMN source_type text,
  ADD COLUMN source_id text,
  ADD COLUMN subject_type text,
  ADD COLUMN subject_id text,
  ADD COLUMN reason_code text,
  ADD COLUMN reported_field text NOT NULL DEFAULT 'content',
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope, status)
SELECT DISTINCT
  'sc-legacy-' || md5(target_type || ':' || target_id || ':other'),
  target_type,
  target_id,
  'other',
  target_type,
  'received'
FROM reports;

UPDATE reports SET
  client_request_id = 'legacy-' || id,
  case_id = 'sc-legacy-' || md5(target_type || ':' || target_id || ':other'),
  source_type = target_type,
  source_id = target_id,
  subject_type = target_type,
  subject_id = target_id,
  reason_code = 'other';

UPDATE reports
SET status = CASE
  WHEN status = 'pending' THEN 'pending'
  WHEN status IN ('closed', 'ignored', 'hidden', 'removed', 'warned', 'handled', 'resolved') THEN 'closed'
  ELSE 'invalid'
END;

ALTER TABLE reports
  ALTER COLUMN client_request_id SET NOT NULL,
  ALTER COLUMN case_id SET NOT NULL,
  ALTER COLUMN source_type SET NOT NULL,
  ALTER COLUMN source_id SET NOT NULL,
  ALTER COLUMN subject_type SET NOT NULL,
  ALTER COLUMN subject_id SET NOT NULL,
  ALTER COLUMN reason_code SET NOT NULL,
  ADD CONSTRAINT reports_status_check CHECK (status IN ('pending', 'closed', 'invalid')),
  ADD CONSTRAINT reports_source_type_check CHECK (source_type IN ('post', 'comment', 'user', 'direct_message', 'collection')),
  ADD CONSTRAINT reports_subject_type_check CHECK (subject_type IN ('post', 'comment', 'user', 'direct_message', 'collection'));

DROP INDEX IF EXISTS reports_unique_reporter_target;
CREATE UNIQUE INDEX reports_unique_reporter_request ON reports (reporter_id, client_request_id);
CREATE UNIQUE INDEX reports_one_pending_reason
  ON reports (reporter_id, subject_type, subject_id, reason_code)
  WHERE status = 'pending';

CREATE TABLE safety_evidence (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES safety_cases(id) ON DELETE CASCADE,
  report_id text REFERENCES reports(id) ON DELETE SET NULL,
  client_request_id text,
  evidence_type text NOT NULL,
  text_snapshot text NOT NULL DEFAULT '',
  structured_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  context_start_message_id text,
  context_end_message_id text,
  retention_delete_at timestamptz,
  redacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX safety_evidence_report_request
  ON safety_evidence (report_id, client_request_id)
  WHERE report_id IS NOT NULL AND client_request_id IS NOT NULL;

CREATE TABLE safety_case_events (
  id bigserial PRIMARY KEY,
  case_id text NOT NULL REFERENCES safety_cases(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('system', 'ai', 'admin', 'reporter', 'owner')),
  actor_id text,
  event_type text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE safety_actions (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES safety_cases(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  action_type text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('system', 'ai', 'admin')),
  actor_id text,
  reason text NOT NULL,
  execution_status text NOT NULL DEFAULT 'pending' CHECK (execution_status IN ('pending', 'applied', 'failed', 'rolled_back')),
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at timestamptz,
  rolled_back_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE safety_jobs (
  id bigserial PRIMARY KEY,
  job_type text NOT NULL,
  case_id text REFERENCES safety_cases(id) ON DELETE CASCADE,
  unique_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  error_code text,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE posts ADD COLUMN safety_status text NOT NULL DEFAULT 'active' CHECK (safety_status IN ('active', 'hidden', 'removed'));
ALTER TABLE comments ADD COLUMN safety_status text NOT NULL DEFAULT 'active' CHECK (safety_status IN ('active', 'hidden'));
ALTER TABLE group_collections
  ADD COLUMN safety_status text NOT NULL DEFAULT 'active' CHECK (safety_status IN ('active', 'suspended', 'removed')),
  ADD COLUMN contact_visibility text NOT NULL DEFAULT 'active' CHECK (contact_visibility IN ('active', 'hidden'));
ALTER TABLE direct_messages ADD COLUMN safety_status text NOT NULL DEFAULT 'active' CHECK (safety_status IN ('active', 'hidden'));

CREATE VIEW posts_with_safety_context AS
SELECT p.*,
       COALESCE(c.status, 'active') AS collection_status,
       COALESCE(c.safety_status, 'active') AS collection_safety_status,
       COALESCE(c.contact_visibility, 'active') AS collection_contact_visibility
FROM posts p
LEFT JOIN group_collections c ON c.id = p.collection_id;

CREATE INDEX safety_evidence_case_created ON safety_evidence (case_id, created_at);
CREATE INDEX safety_case_events_case_created ON safety_case_events (case_id, created_at);
CREATE INDEX safety_actions_target_active ON safety_actions (target_type, target_id, execution_status);
CREATE INDEX safety_jobs_claim ON safety_jobs (status, run_at, id);
```

- [ ] **Step 4: Add a down migration in dependency-safe order**

The down file must drop the view, new indexes and constraints, new report columns, safety tables in child-to-parent order, and the four safety-state columns. Before recreating `reports_unique_reporter_target`, deduplicate pending rows exactly as migration `012_report_dedup.sql` does. The down migration is tested only on a disposable database and is never the default production rollback.

- [ ] **Step 5: Add legacy-data assertions and run the database suite**

Extend `backend/test/helpers/database.js` with `withMigrationDatabase`. It connects to the same temporary local cluster's `postgres` database, creates a uniquely named `zbt_safety_test_migration_<pid>_<counter>` database, applies SQL files only through `012_report_dedup.sql`, invokes the test callback, and drops that database in `finally`. Use it to insert one legacy report before applying migration 013, then assert its `client_request_id`, `case_id`, source, subject, and `reason_code='other'` are populated and its original `reason`, `detail`, and `reporter_id` remain unchanged. This test must not reuse the already fully migrated main test database.

Run:

```bash
npm --prefix backend run test:db
```

Expected: PASS for empty and legacy-data migration paths.

- [ ] **Step 6: Commit the schema**

```bash
git add backend/sql/013_safety_cases.sql backend/sql/down/013_safety_cases.sql backend/test/safety/migration.integration.test.js backend/test/helpers/database.js
git commit -m "Add safety case database schema"
```

### Task 3: Define Report Contracts and Resolve Impact Scope

**Files:**
- Create: `backend/src/safety/constants.js`
- Create: `backend/src/safety/reportValidation.js`
- Create: `backend/src/safety/subjectResolver.js`
- Create: `backend/test/safety/reportValidation.test.js`
- Create: `backend/test/safety/subjectResolver.integration.test.js`

**Interfaces:**
- Produces: `normalizeReportInput(body)` and `resolveReportSubject(client, input)`.
- Consumes later: report routes and case service.

- [ ] **Step 1: Write failing validation tests for every target and shared field**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReportInput } from "../../src/safety/reportValidation.js";

test("normalizes a collection-scoped post contact report", () => {
  assert.deepEqual(normalizeReportInput({
    clientRequestID: "req-1",
    sourceType: "post",
    sourceID: "p-1",
    reasonCode: "invalid_contact",
    reportedField: "contact_wechat",
    detail: "无法搜索该微信号"
  }), {
    clientRequestId: "req-1",
    sourceType: "post",
    sourceId: "p-1",
    reasonCode: "invalid_contact",
    reportedField: "contact_wechat",
    detail: "无法搜索该微信号",
    objectKeys: []
  });
});

test("other and invalid contact require detail", () => {
  assert.throws(() => normalizeReportInput({ clientRequestID: "r", sourceType: "post", sourceID: "p", reasonCode: "other", reportedField: "content" }), /详细说明/);
  assert.throws(() => normalizeReportInput({ clientRequestID: "r", sourceType: "post", sourceID: "p", reasonCode: "invalid_contact", reportedField: "content", detail: "坏了" }), /具体联系方式/);
});

test("rejects client-selected collection scope through a content field", () => {
  assert.throws(() => normalizeReportInput({ clientRequestID: "r", sourceType: "post", sourceID: "p", reasonCode: "harassment_or_abuse", reportedField: "collection_description", detail: "x" }), /举报字段/);
});
```

- [ ] **Step 2: Run tests and verify module-not-found failure**

```bash
node --test backend/test/safety/reportValidation.test.js
```

- [ ] **Step 3: Implement closed enums and bounds**

```js
export const SAFETY_TARGET_TYPES = Object.freeze(["post", "comment", "user", "direct_message", "collection"]);
export const SAFETY_REASON_CODES = Object.freeze([
  "suspected_scam", "false_or_expired_group_buy", "invalid_contact",
  "copyright_or_stolen_media", "harassment_or_abuse", "sexual_or_illegal",
  "spam_or_advertising", "direct_message_risk", "other"
]);
export const SAFETY_REPORTED_FIELDS = Object.freeze([
  "content", "contact_wechat", "contact_qq", "contact_group_number",
  "collection_deadline", "collection_description", "collection_default_note"
]);
export const COLLECTION_SHARED_FIELDS = new Set(SAFETY_REPORTED_FIELDS.filter((value) => value !== "content"));
```

`normalizeReportInput` must trim strings, cap `detail` at 1000 characters, cap evidence keys at 6, reject unsupported enums, require IDs and client request IDs no longer than 128 characters, require a shared contact field for `invalid_contact`, allow collection fields only for post/collection sources, and validate every evidence key under `report/<reporter-id>/` later in the service.

Before resolving the subject, `assertReporterCanViewSource` must apply the same effective-visibility and two-way-block rules as the public API. It rejects deleted, blocked, hidden-to-reporter, or fabricated targets even if their database rows still exist.

- [ ] **Step 4: Write and run subject-resolution integration tests**

Seed a collection `col-1`, child post `p-1`, comment `c-1`, message `m-1`, and users. Assert:

```js
assert.deepEqual(await resolveReportSubject(client, { sourceType: "post", sourceId: "p-1", reasonCode: "invalid_contact", reportedField: "contact_wechat" }), { subjectType: "collection", subjectId: "col-1", impactScope: "collection", ownerId: "u-owner" });
assert.deepEqual(await resolveReportSubject(client, { sourceType: "post", sourceId: "p-1", reasonCode: "copyright_or_stolen_media", reportedField: "content" }), { subjectType: "post", subjectId: "p-1", impactScope: "post", ownerId: "u-owner" });
```

Also assert shared-field reporting fails when a post has no collection, and self-reporting fails for posts, comments, collections, users, and direct messages.

Run:

```bash
npm --prefix backend run test:db
```

- [ ] **Step 5: Commit contracts and resolver**

```bash
git add backend/src/safety/constants.js backend/src/safety/reportValidation.js backend/src/safety/subjectResolver.js backend/test/safety/reportValidation.test.js backend/test/safety/subjectResolver.integration.test.js
git commit -m "Define safety report scope contracts"
```

### Task 4: Capture Immutable Evidence Including Message Context

**Files:**
- Create: `backend/src/safety/evidenceService.js`
- Create: `backend/test/safety/evidenceService.integration.test.js`
- Modify: `backend/src/oss.js:47-66`
- Modify: `backend/src/moderation/index.js:58-72`
- Modify: `backend/src/routes.js:1143-1159`

**Interfaces:**
- Produces: `captureSourceEvidence(client, { reporterId, sourceType, sourceId })` and report uploads under `report/<reporter-id>/...`.

- [ ] **Step 1: Write failing evidence tests**

Seed seven chronological direct messages around `m-target`. Assert the returned snapshot has seven messages at most, begins three before, ends three after, marks `m-target`, includes sender IDs and timestamps, and never contains either user's email. Add one test each for post, comment, user, and collection snapshots.

```js
const evidence = await captureSourceEvidence(client, { reporterId: "u-reporter", sourceType: "direct_message", sourceId: "m-target" });
assert.equal(evidence.structuredSnapshot.messages.length, 7);
assert.equal(evidence.structuredSnapshot.messages[3].id, "m-target");
assert.ok(evidence.structuredSnapshot.messages.every((message) => !Object.hasOwn(message, "email")));
```

- [ ] **Step 2: Run the integration suite and verify failure**

```bash
npm --prefix backend run test:db
```

- [ ] **Step 3: Implement server-selected message context**

Use one transaction query with row numbers:

```sql
WITH ordered AS (
  SELECT dm.*,
         row_number() OVER (PARTITION BY dm.thread_id ORDER BY dm.created_at, dm.id) AS position
  FROM direct_messages dm
  WHERE dm.thread_id = $1
), target AS (
  SELECT position FROM ordered WHERE id = $2
)
SELECT id, sender_id, body, image_object_key, shared_post_id, shared_profile_user_id,
       revoked_at, created_at, safety_status
FROM ordered, target
WHERE ordered.position BETWEEN target.position - 3 AND target.position + 3
ORDER BY ordered.position;
```

Before this query, lock and validate the thread, reporter participation, and `target.sender_id <> reporterId`. Never accept message text from the request.

- [ ] **Step 4: Implement minimal snapshots for other targets**

- Post: title, description, price fields, image object keys, author ID, collection ID, mirrored shared fields, timestamps, moderation status, safety status.
- Comment: body, author ID, post ID, reply ID, timestamp, moderation status, safety status.
- User: ID, nickname, bio, avatar/background object keys, creation time, restriction flags; exclude email, phone, birthday, and identity records.
- Collection: name, shared contact fields, group info, deadline, default note, owner ID, moderation status, safety status, contact visibility.

Return `{ evidenceType, textSnapshot, structuredSnapshot, objectKeys, ownerId, contextStartMessageId, contextEndMessageId, retentionDeleteAt }`.

- [ ] **Step 5: Allow private report uploads without exposing them through `/api/assets`**

Add `report` to `createUploadTarget` and `assertOwnedObjectKeys` allowed kinds, but do not add `report/` to the unauthenticated `/api/assets/*` proxy. For `kind === 'report'`, return the upload URL and object key; signed evidence reads are generated only by the admin case API in Phase 6.

- [ ] **Step 6: Run focused and full tests, then commit**

```bash
npm --prefix backend run test:db
npm --prefix backend test
git add backend/src/safety/evidenceService.js backend/test/safety/evidenceService.integration.test.js backend/src/oss.js backend/src/moderation/index.js backend/src/routes.js
git commit -m "Capture immutable safety evidence"
```

### Task 5: Implement Idempotent Report Intake and User Status APIs

**Files:**
- Create: `backend/src/safety/caseService.js`
- Create: `backend/src/safety/reportMapper.js`
- Create: `backend/src/safety/reportRoutes.js`
- Create: `backend/test/safety/reportRoutes.integration.test.js`
- Modify: `backend/src/config.js`
- Modify: `backend/src/routes.js:1-45,1069-1090,1143-1161`
- Modify: `backend/src/bootstrap.js:1-163`
- Modify: `backend/src/app.js:1-35`

**Interfaces:**
- Produces: `submitReport`, `appendReportEvidence`, `listReportsForUser`, and the three consumer APIs.
- Consumes: validation, subject resolver, evidence service, sync event creation, and PostgreSQL transaction helper.

- [ ] **Step 1: Write failing route-level database tests**

Cover all of these behaviors with a real local HTTP server and signed test JWTs:

```text
201 first submit
200 exact clientRequestID retry returns the same report and case
200 same pending subject/reason with a new clientRequestID appends evidence without a second report
201 same subject/reason after terminal case creates a new report and case
403 message from a thread the reporter does not participate in
400 own target report
429 account burst limit
GET /api/me/reports never exposes another reporter or internal AI fields
POST /api/reports/:id/evidence requires `clientRequestID`, rejects non-owner and terminal reports, and deduplicates supplement retries
```

- [ ] **Step 2: Run and verify endpoint failures**

```bash
npm --prefix backend run test:db
```

- [ ] **Step 3: Implement the report transaction**

`submitReport` must execute this sequence on one `client`:

```js
export async function submitReport(client, input) {
  const normalized = normalizeReportInput(input);
  const existingRequest = await findByClientRequest(client, input.reporterId, normalized.clientRequestId);
  if (existingRequest) return { report: existingRequest, duplicate: true };
  const existingSupplement = await findReportByEvidenceRequest(client, input.reporterId, normalized.clientRequestId);
  if (existingSupplement) return { report: existingSupplement, duplicate: true };

  const subject = await resolveReportSubject(client, { ...normalized, reporterId: input.reporterId });
  const evidence = await captureSourceEvidence(client, { reporterId: input.reporterId, sourceType: normalized.sourceType, sourceId: normalized.sourceId });
  const safetyCase = await findOrCreateOpenCase(client, { ...subject, category: normalized.reasonCode });
  const pending = await findPendingReporterReason(client, { reporterId: input.reporterId, caseId: safetyCase.id, reasonCode: normalized.reasonCode });
  if (pending) {
    await insertEvidence(client, { caseId: safetyCase.id, reportId: pending.id, clientRequestId: normalized.clientRequestId, ...evidence, supplemental: true });
    return { report: pending, duplicate: true };
  }

  const report = await insertReport(client, { reporterId: input.reporterId, caseId: safetyCase.id, ...normalized, ...subject });
  await insertEvidence(client, { caseId: safetyCase.id, reportId: report.id, clientRequestId: normalized.clientRequestId, ...evidence });
  await insertCaseEvent(client, { caseId: safetyCase.id, actorType: "reporter", actorId: input.reporterId, eventType: "report.received", eventData: { reportId: report.id } });
  await enqueueSafetyJob(client, { type: "case_received", caseId: safetyCase.id, uniqueKey: `case_received:${report.id}`, payload: {} });
  await createSyncEvent(client, { userId: input.reporterId, eventType: "safety.report.updated", entityType: "safety_case", entityId: safetyCase.id });
  return { report, duplicate: false };
}
```

Use the unique indexes as the final concurrency guard. `insertEvidence` uses `ON CONFLICT (report_id, client_request_id) WHERE report_id IS NOT NULL AND client_request_id IS NOT NULL DO NOTHING`; catch PostgreSQL unique-violation `23505`, re-read the winning row, and never insert duplicate evidence for the same `clientRequestID`. The evidence-supplement route accepts `{ clientRequestID, detail, objectKeys }`, validates the same request-ID bounds and report object-key ownership, and returns the unchanged report plus `duplicate:true` on retry.

- [ ] **Step 4: Add account, IP, and burst limiters**

Add config defaults:

```js
safety: {
  enabled: String(process.env.SAFETY_CASES_ENABLED || "false").toLowerCase() === "true",
  aiMode: enumValue("SAFETY_AI_MODE", "off", ["off", "shadow", "enforce"]),
  autoActionsEnabled: String(process.env.SAFETY_AUTO_ACTIONS_ENABLED || "false").toLowerCase() === "true",
  reportAccountMax24h: Number(process.env.SAFETY_REPORT_ACCOUNT_MAX_24H || 20),
  reportIpMax24h: Number(process.env.SAFETY_REPORT_IP_MAX_24H || 60),
  reportBurstMaxMinute: Number(process.env.SAFETY_REPORT_BURST_MAX_MINUTE || 5)
}
```

Use the existing PostgreSQL limiter in production. Apply burst and account limit after `requireAuth`; apply the IP daily limit before transaction work. Return API code `report_rate_limited`.

- [ ] **Step 5: Mount the focused router and remove the legacy route**

Mount `createSafetyReportRouter()` under the existing `/api` router when enabled. When disabled, preserve the legacy `POST /reports` behavior for post/comment clients. Do not leave two active handlers for the same path. Update bootstrap report mapping to the new user-visible shape but keep missing new columns backward compatible during rollout. Derive public report status from the case: `received -> received`, all nonterminal processing states -> `reviewing`, `resolved_no_action -> no_violation`, and the other terminal states -> `handled`; never expose raw case state or internal risk.

- [ ] **Step 6: Run all tests and commit**

```bash
npm --prefix backend run test:db
npm --prefix backend test
git add backend/src/safety/caseService.js backend/src/safety/reportMapper.js backend/src/safety/reportRoutes.js backend/test/safety/reportRoutes.integration.test.js backend/src/config.js backend/src/routes.js backend/src/bootstrap.js backend/src/app.js
git commit -m "Add idempotent safety report intake"
```

### Task 6: Apply Reversible Actions and Effective Collection Visibility

**Files:**
- Create: `backend/src/safety/actionService.js`
- Create: `backend/src/safety/visibility.js`
- Create: `backend/test/safety/actionService.integration.test.js`
- Create: `backend/test/safety/visibility.integration.test.js`
- Modify: `backend/src/mappers.js:32-145`
- Modify: `backend/src/routes.js`
- Modify: `backend/src/bootstrap.js`
- Modify: `backend/src/sync.js`
- Modify: `backend/src/messages.js`

**Interfaces:**
- Produces: `applySafetyAction`, `rollbackSafetyAction`, `isPostPubliclyVisible`, and stable effective-state SQL predicates.

- [ ] **Step 1: Write failing action-idempotency and cascade tests**

Prove:

```js
const first = await applySafetyAction(client, actionInput);
const second = await applySafetyAction(client, actionInput);
assert.equal(first.id, second.id);
assert.equal(await scalar(client, "SELECT safety_status FROM group_collections WHERE id='col-1'"), "suspended");
assert.equal(await scalar(client, "SELECT safety_status FROM posts WHERE id='p-child'"), "active");
assert.equal(await isPostPubliclyVisible(client, "p-child"), false);
await rollbackSafetyAction(client, { actionId: first.id, actorType: "admin", actorId: "admin-1", reason: "复核恢复" });
assert.equal(await isPostPubliclyVisible(client, "p-child"), true);
```

Also test hiding collection contact blanks WeChat, QQ, group number, and group info in post/collection client mappers without changing stored values.

- [ ] **Step 2: Implement the action allowlist**

```js
export const REVERSIBLE_AUTOMATIC_ACTIONS = new Set([
  "hide_post",
  "hide_comment",
  "hide_message",
  "hide_collection_contact",
  "suspend_collection",
  "request_correction"
]);

export const NON_PUNITIVE_AUTOMATIC_ACTIONS = new Set(["notify_owner"]);

const targetMutations = {
  hide_post: { table: "posts", column: "safety_status", value: "hidden", targetType: "post" },
  hide_comment: { table: "comments", column: "safety_status", value: "hidden", targetType: "comment" },
  hide_message: { table: "direct_messages", column: "safety_status", value: "hidden", targetType: "direct_message" },
  hide_collection_contact: { table: "group_collections", column: "contact_visibility", value: "hidden", targetType: "collection" },
  suspend_collection: { table: "group_collections", column: "safety_status", value: "suspended", targetType: "collection" }
};
```

`applySafetyAction` must lock the target, insert or read `safety_actions` by `idempotency_key`, capture before/after JSON, mutate only the mapped column, append a case event, update the case, and create owner/reporter sync events in the same transaction. `notify_owner` creates only the owner event/sync notification and leaves the case in monitoring with no deadline. `request_correction` changes only case state and the explicitly supplied deadline.

- [ ] **Step 3: Implement rollback based on remaining active actions**

Rollback must mark the selected action `rolled_back`, then derive the target field from any other still-applied action of the same type. Reset to `active` only when no remaining action requires the restriction. This prevents one rollback from undoing an independent active case.

- [ ] **Step 4: Centralize public visibility rules**

Use these exact predicates wherever public rows are loaded:

```sql
-- posts_with_safety_context alias p
p.status = 'active'
AND p.safety_status = 'active'
AND p.collection_status = 'active'
AND p.collection_safety_status = 'active'

-- collections alias c
c.status = 'active'
AND c.safety_status = 'active'

-- comments alias cm joined to posts_with_safety_context p
cm.status = 'active'
AND cm.safety_status = 'active'
AND p.status = 'active'
AND p.safety_status = 'active'
AND p.collection_status = 'active'
AND p.collection_safety_status = 'active'
```

Owners may still receive restricted rows through owner-only branches. Replace post reads with `posts_with_safety_context` in feed, post detail, bootstrap, sync, search/profile loaders, and message shared-post loaders.

- [ ] **Step 5: Apply safe presentation rules**

In `postToClient`, blank contact fields when `collection_contact_visibility === 'hidden'`; in `collectionToClient`, blank contact fields when `contact_visibility === 'hidden'`; add `safetyStatus` and `contactVisibility` fields. In `directMessageToClient`, return empty body/media and `isSafetyHidden: true` when `safety_status === 'hidden'`, distinct from revoked state.

- [ ] **Step 6: Run database, unit, and static query coverage tests**

```bash
npm --prefix backend run test:db
npm --prefix backend test
rg -n "FROM posts p|JOIN posts p" backend/src | rg -v "posts_with_safety_context|INSERT|UPDATE|DELETE|test"
```

Expected: tests PASS. Every remaining raw post read printed by the final command has a documented owner/write-only reason in `visibility.test.js`.

- [ ] **Step 7: Commit action and visibility behavior**

```bash
git add backend/src/safety/actionService.js backend/src/safety/visibility.js backend/test/safety/actionService.integration.test.js backend/test/safety/visibility.integration.test.js backend/src/mappers.js backend/src/routes.js backend/src/bootstrap.js backend/src/sync.js backend/src/messages.js
git commit -m "Add reversible safety restrictions"
```

### Task 7: Add the PostgreSQL Job Worker Skeleton

**Files:**
- Create: `backend/src/safety/jobQueue.js`
- Create: `backend/src/safety/jobWorker.js`
- Create: `backend/test/safety/jobQueue.integration.test.js`
- Modify: `backend/src/server.js`

**Interfaces:**
- Produces: `enqueueSafetyJob`, `claimSafetyJobs`, `completeSafetyJob`, `failSafetyJob`, `startSafetyWorker`.
- Phase 7 registers `analyze_case`; Phase 4 registers `review_revision`.

- [ ] **Step 1: Write failing concurrent-claim and retry tests**

Insert three jobs, call `claimSafetyJobs` concurrently from two worker IDs, and assert no ID appears twice. Fail one job twice and assert delays of approximately 30 and 120 seconds; fail the third time and assert terminal `failed`.

- [ ] **Step 2: Implement atomic claiming with `SKIP LOCKED`**

```sql
WITH candidates AS (
  SELECT id
  FROM safety_jobs
  WHERE status = 'pending' AND run_at <= now()
  ORDER BY run_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
UPDATE safety_jobs j
SET status = 'running', locked_at = now(), locked_by = $2,
    attempts = attempts + 1, updated_at = now()
FROM candidates
WHERE j.id = candidates.id
RETURNING j.*;
```

Stale `running` jobs older than five minutes are reset to pending before each claim. Error summaries are sanitized to a code and at most 300 characters, with no provider body or evidence text.

- [ ] **Step 3: Implement a stoppable two-concurrency worker**

```js
export function startSafetyWorker({ concurrency = 2, pollIntervalMs = 1000, handlers, workerId = `worker-${process.pid}` } = {}) {
  let stopped = false;
  const run = async () => {
    while (!stopped) {
      const jobs = await claimSafetyJobs({ limit: concurrency, workerId });
      if (!jobs.length) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        continue;
      }
      await Promise.all(jobs.map((job) => executeJob(job, handlers)));
    }
  };
  const promise = run();
  return { stop: async () => { stopped = true; await promise; } };
}
```

Register a core `case_received` handler: when AI mode is `off`, move the case from `received` to `manual_review`; otherwise enqueue `analyze_case` for Phase 7. Do not call a provider in this phase.

- [ ] **Step 4: Wire graceful shutdown in `server.js`**

Start the worker after the HTTP server listens. On `SIGTERM` or `SIGINT`, stop accepting HTTP, stop the worker, clear existing pruners, close realtime, and close the pool. Keep the process restart behavior compatible with systemd.

- [ ] **Step 5: Run all backend verification and commit**

```bash
npm --prefix backend run test:db
npm --prefix backend test
node --check backend/src/safety/jobQueue.js
node --check backend/src/safety/jobWorker.js
git add backend/src/safety/jobQueue.js backend/src/safety/jobWorker.js backend/test/safety/jobQueue.integration.test.js backend/src/server.js
git commit -m "Add PostgreSQL safety job worker"
```

### Task 8: Deploy the Core Disabled, Then Enable Intake Only

**Files:**
- Production: `/opt/zbt-backend`
- Production environment: `/opt/zbt-backend/.env`

**Interfaces:**
- Feature flags: `SAFETY_CASES_ENABLED`, `SAFETY_AI_MODE`, `SAFETY_AUTO_ACTIONS_ENABLED`.

- [ ] **Step 1: Produce and inspect a migration dry-run artifact**

On the temporary database, capture table/index counts before and after migration 013 and run the down migration. Confirm old report fields survive. Save only schema names and counts under `docs/operations/verification/`; never save production rows.

- [ ] **Step 2: Announce production migration impact and rollback**

State: migration 013 is additive except replacing one report uniqueness index; no content rows are deleted; immediate rollback is feature flags off, not dropping safety tables. Back up the RDS database or confirm the provider snapshot is current before migration.

- [ ] **Step 3: Deploy code with all new behavior disabled**

Use the established private SSH variables from `.project-secrets/backend.env`. Sync source, SQL, package files, and scripts without copying local `.env`; install production dependencies; set:

```dotenv
SAFETY_CASES_ENABLED=false
SAFETY_AI_MODE=off
SAFETY_AUTO_ACTIONS_ENABLED=false
SAFETY_AI_MONTHLY_BUDGET_CNY=0
```

Run migrations, restart `zbt-backend.service`, and verify `systemctl is-active`, health, feed, bootstrap, sync, and legacy post report behavior.

- [ ] **Step 4: Enable intake with AI and automatic actions still off**

Set only `SAFETY_CASES_ENABLED=true`, restart once, submit one disposable test report with an ordinary test account, assert it creates one report, one case, immutable evidence, and a `manual_review` case, then clean only the disposable test rows by their known test IDs.

- [ ] **Step 5: Verify no paid calls and no automatic restrictions**

Check logs and database metadata for the test case: no DashScope request, no applied `safety_actions`, and no secret/evidence text in journal logs.
