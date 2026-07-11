# Content Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let owners correct a reported post or collection, submit an immutable candidate revision, pass re-review, and republish the original object ID without losing interactions; also accept one human-reviewed appeal per final manual decision.

**Architecture:** Store candidate snapshots in `content_revisions` and appeals in `safety_appeals`. Revision submission is a database-only request that enqueues `review_revision`; the worker uses the existing moderation provider through an injected interface. Publishing applies an approved snapshot in one transaction, mirrors collection shared fields, rolls back only eligible automatic actions, and emits sync events. Manual holds and appeals always remain in the admin queue.

**Tech Stack:** PostgreSQL 16, Node services and job worker, existing Aliyun moderation abstraction, SwiftUI forms reused from post/collection creation.

## Global Constraints

- Revisions preserve the original post or collection ID.
- Existing comments, likes, favorites, report history, and share links remain attached.
- Candidate content never overwrites the last public version before approval.
- Old text and object keys remain in immutable evidence for the retention period.
- Only the target owner can submit a revision or appeal.
- Only cases in `awaiting_correction` accept revisions.
- Only automatic reversible actions can auto-restore; any `manual_hold`, manual action, permanent action, account restriction, or appeal blocks automatic restoration.
- A collection publish mirrors shared fields to legacy child-post columns in the same transaction; the collection remains the review and business source of truth.
- One appeal is allowed for each final manual decision action and must arrive within seven days.
- AI may summarize an appeal later but never decide it.

---

### Task 1: Add Revision and Appeal Tables

**Files:**
- Create: `backend/sql/015_content_revisions.sql`
- Create: `backend/sql/down/015_content_revisions.sql`
- Create: `backend/test/safety/revisionMigration.integration.test.js`

**Interfaces:**
- Produces: `content_revisions` and `safety_appeals`.

- [ ] **Step 1: Write the failing migration contract**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../src/db.js";

test("content revision migration enforces monotonic revisions and one appeal per decision", async () => {
  const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_name = ANY($1::text[]) ORDER BY table_name`, [["content_revisions", "safety_appeals"]]);
  assert.deepEqual(tables.rows.map((row) => row.table_name), ["content_revisions", "safety_appeals"]);
  const constraints = await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename IN ('content_revisions', 'safety_appeals')`);
  assert.ok(constraints.rows.some((row) => row.indexname === "content_revisions_target_number"));
  assert.ok(constraints.rows.some((row) => row.indexname === "safety_appeals_one_per_decision"));
});
```

- [ ] **Step 2: Run the database suite and verify failure**

```bash
npm --prefix backend run test:db
```

- [ ] **Step 3: Create the additive migration**

```sql
CREATE TABLE content_revisions (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES safety_cases(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('post', 'collection')),
  target_id text NOT NULL,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  snapshot jsonb NOT NULL,
  object_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'approved', 'rejected', 'published')),
  review_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX content_revisions_target_number
  ON content_revisions (target_type, target_id, revision_number);
CREATE UNIQUE INDEX content_revisions_one_active_case
  ON content_revisions (case_id)
  WHERE status IN ('pending', 'reviewing', 'approved');

CREATE TABLE safety_appeals (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES safety_cases(id) ON DELETE CASCADE,
  decision_action_id text NOT NULL REFERENCES safety_actions(id) ON DELETE RESTRICT,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  detail text NOT NULL CHECK (char_length(detail) BETWEEN 1 AND 1000),
  object_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'overturned')),
  handled_by text,
  handled_reason text,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX safety_appeals_one_per_decision ON safety_appeals (decision_action_id);
CREATE INDEX safety_appeals_pending_created ON safety_appeals (status, created_at);
```

- [ ] **Step 4: Add the down migration and test both directions**

Drop appeals before revisions. The down migration removes no report/case tables. Apply up, seed one revision and appeal, assert uniqueness, then apply down on the disposable database and assert only these two tables disappear.

- [ ] **Step 5: Commit the migration**

```bash
npm --prefix backend run test:db
git add backend/sql/015_content_revisions.sql backend/sql/down/015_content_revisions.sql backend/test/safety/revisionMigration.integration.test.js
git commit -m "Add content revision and appeal schema"
```

### Task 2: Validate and Submit Candidate Revisions

**Files:**
- Create: `backend/src/safety/revisionValidation.js`
- Create: `backend/src/safety/revisionService.js`
- Create: `backend/test/safety/revisionService.integration.test.js`

**Interfaces:**
- Produces: `submitContentRevision(client, input)`, `postRevisionSnapshot`, and `collectionRevisionSnapshot`.
- Consumes: job queue and report object-key ownership checks.

- [ ] **Step 1: Write failing ownership, state, and immutability tests**

Cover:

```text
owner + awaiting_correction -> revision 1 pending and review_revision job
second submit while revision 1 pending -> 409 revision_in_progress
non-owner -> 403
manual_review case -> 409 correction_not_requested
post candidate does not modify posts before publish
collection candidate does not modify group_collections before publish
object keys outside report/post owner prefixes -> 400
```

- [ ] **Step 2: Define exact normalized snapshots**

Post snapshot:

```js
{
  title, imageNames, imageObjectKeys, previewImageObjectKeys, groupType,
  categoryTags, fandomTags, price, deposit, condition, isFormed,
  description, externalLink, imageAspect, pingguAveragePrice,
  pingguNote, unsoldRoles
}
```

Do not accept collection-owned WeChat, QQ, group number, group info, deadline, or default note in a post revision. Load those from the collection when publishing.

Collection snapshot:

```js
{ name, contactWechat, contactQQ, contactGroupNumber, groupInfo, deadline, defaultNote }
```

Require collection name, a future-or-explicitly-confirmed deadline, default note, and at least one contact channel. Cap all strings to the same bounds used by current create routes.

- [ ] **Step 3: Implement transaction and revision numbering**

```js
export async function submitContentRevision(client, { caseId, ownerId, snapshot, objectKeys = [] }) {
  const safetyCase = await lockCorrectableCase(client, caseId, ownerId);
  const normalized = safetyCase.subject_type === "post"
    ? await postRevisionSnapshot(client, safetyCase.subject_id, ownerId, snapshot)
    : await collectionRevisionSnapshot(client, safetyCase.subject_id, ownerId, snapshot);
  const number = await nextRevisionNumber(client, safetyCase.subject_type, safetyCase.subject_id);
  const revision = await insertRevision(client, { caseId, ownerId, targetType: safetyCase.subject_type, targetId: safetyCase.subject_id, revisionNumber: number, snapshot: normalized, objectKeys });
  await enqueueSafetyJob(client, { type: "review_revision", caseId, uniqueKey: `review_revision:${revision.id}`, payload: { revisionId: revision.id } });
  await client.query("UPDATE safety_cases SET status='rechecking', updated_at=now() WHERE id=$1", [caseId]);
  await insertCaseEvent(client, { caseId, actorType: "owner", actorId: ownerId, eventType: "revision.submitted", eventData: { revisionId: revision.id, revisionNumber: number } });
  return revision;
}
```

Use `FOR UPDATE` on the case and active revision query so concurrent submissions cannot create two pending revisions.

- [ ] **Step 4: Run tests and commit submission behavior**

```bash
npm --prefix backend run test:db
git add backend/src/safety/revisionValidation.js backend/src/safety/revisionService.js backend/test/safety/revisionService.integration.test.js
git commit -m "Add immutable content revision intake"
```

### Task 3: Review and Publish Revisions In Place

**Files:**
- Modify: `backend/src/safety/revisionService.js`
- Modify: `backend/src/safety/jobWorker.js`
- Create: `backend/test/safety/revisionPublishing.integration.test.js`
- Modify: `backend/src/routes.js:1450-1575`

**Interfaces:**
- Produces: `reviewContentRevision`, `publishApprovedRevision`, and `review_revision` worker handler.
- Consumes: `reviewSubmission`, action rollback, and sync event creation.

- [ ] **Step 1: Write failing preservation and restoration tests**

Seed a post with one like, favorite, comment, report/case, and an applied automatic hide action. Submit a hard-safety-approved revision, publish it through an explicit human decision in this pre-Qwen phase, and assert:

```js
assert.equal(updatedPost.id, "p-original");
assert.equal(await count(client, "post_likes", "post_id", "p-original"), 1);
assert.equal(await count(client, "post_favorites", "post_id", "p-original"), 1);
assert.equal(await count(client, "comments", "post_id", "p-original"), 1);
assert.equal(updatedPost.safety_status, "active");
assert.equal(revision.status, "published");
```

Repeat with `manual_hold=true` and assert content remains restricted and case goes to `manual_review` even when the candidate passes.

- [ ] **Step 2: Implement injected moderation review**

```js
export async function reviewContentRevision(client, { revisionId, moderation = reviewSubmission }) {
  const revision = await lockPendingRevision(client, revisionId);
  await markRevisionReviewing(client, revision.id);
  const input = moderationInputForRevision(revision);
  const result = await moderation(input);
  if (result.status === "active") {
    await client.query("UPDATE content_revisions SET status='approved', review_summary=$2::jsonb, reviewed_at=now(), updated_at=now() WHERE id=$1", [revision.id, JSON.stringify(result)]);
    await client.query("UPDATE safety_cases SET status='manual_review', updated_at=now() WHERE id=$1", [revision.case_id]);
    await insertCaseEvent(client, { caseId: revision.case_id, actorType: "system", eventType: "revision.hard_safety_approved", eventData: { revisionId: revision.id } });
    return { published: false, awaiting: "human_or_qwen", result };
  }
  const status = result.status === "rejected" ? "rejected" : "reviewing";
  await client.query("UPDATE content_revisions SET status=$2, review_summary=$3::jsonb, reviewed_at=now(), updated_at=now() WHERE id=$1", [revision.id, status, JSON.stringify(result)]);
  await client.query("UPDATE safety_cases SET status='manual_review', updated_at=now() WHERE id=$1", [revision.case_id]);
  return { published: false, result };
}
```

Provider exceptions fail into `manual_review`; they never publish or restore. Before Phase 7, a hard-safety pass still waits for a human admin to call `publishApprovedRevision`. Phase 7 may call the same function automatically only after a valid Qwen result and policy approval.

- [ ] **Step 3: Publish posts without replacing IDs**

Update only editable post columns from the approved snapshot. Load the parent collection and mirror its shared fields and deadline. Leave `id`, `author_id`, `collection_id`, `created_at`, moderation history, and interaction tables unchanged. Set `updated_at=now()`.

- [ ] **Step 4: Publish collections and mirror shared fields**

Update the original collection, then:

```sql
UPDATE posts
SET wechat = $2,
    qq = $3,
    group_number = $4,
    group_info = $5,
    deadline = $6,
    updated_at = now()
WHERE collection_id = $1;
```

Do not modify child post moderation `status` or `safety_status`.

- [ ] **Step 5: Enforce automatic restoration boundaries**

`publishApprovedRevision(client, revisionId, approval)` accepts either `{ actorType: 'admin', actorId, reason }` or `{ actorType: 'policy', qwenResult, policyVersion }`. Policy approval is valid only after both Aliyun hard safety and schema-valid Qwen analysis pass. Auto-rollback only actions where `actor_type IN ('system','ai')`, action type is in the reversible allowlist, no manual action remains applied, `manual_hold=false`, and no open linked case blocks the target. Otherwise leave actions applied, move the case to `manual_review`, and record `revision.approved_waiting_manual_restore`.

- [ ] **Step 6: Emit owner and audience sync events**

In the same transaction, create owner events plus public entity events only if the object becomes effectively visible. Notify realtime only after commit.

- [ ] **Step 7: Run tests and commit**

```bash
npm --prefix backend run test:db
npm --prefix backend test
git add backend/src/safety/revisionService.js backend/src/safety/jobWorker.js backend/test/safety/revisionPublishing.integration.test.js backend/src/routes.js
git commit -m "Publish approved revisions in place"
```

### Task 4: Add Content-Action and Appeal APIs

**Files:**
- Create: `backend/src/safety/revisionRoutes.js`
- Create: `backend/src/safety/contentActionMapper.js`
- Create: `backend/src/safety/appealService.js`
- Create: `backend/test/safety/revisionRoutes.integration.test.js`
- Modify: `backend/src/safety/reportRoutes.js`

**Interfaces:**
- Produces: `GET /api/me/content-actions`, revision submit, and appeal submit APIs.

- [ ] **Step 1: Write failing API tests**

Cover owner filtering, field-level reason output, deadline, current revision status, one appeal per decision, seven-day cutoff, evidence ownership, and absence of reporter/admin/AI private fields.

- [ ] **Step 2: Map only owner-visible action data**

```js
export function contentActionToClient(row) {
  return {
    caseID: row.case_id,
    targetType: row.subject_type,
    targetID: row.subject_id,
    category: row.category,
    status: row.status,
    affectedFields: row.affected_fields || [],
    reason: row.owner_reason || "内容需要整改",
    currentRestriction: row.current_restriction || "",
    correctionDueAt: row.correction_due_at?.toISOString() || null,
    canSubmitRevision: row.status === "awaiting_correction",
    canAppeal: Boolean(row.can_appeal),
    revisionStatus: row.revision_status || null,
    updatedAt: row.updated_at.toISOString()
  };
}
```

- [ ] **Step 3: Implement appeal transaction**

Lock the case and latest applied human final action, verify target ownership and decision age at most seven days, insert one appeal for `decision_action_id`, set case to `appealed` and `manual_hold=true`, append evidence/event, create owner sync, and do not enqueue a decision job.

- [ ] **Step 4: Mount routes and run all backend tests**

```bash
npm --prefix backend run test:db
npm --prefix backend test
git add backend/src/safety/revisionRoutes.js backend/src/safety/contentActionMapper.js backend/src/safety/appealService.js backend/test/safety/revisionRoutes.integration.test.js backend/src/safety/reportRoutes.js
git commit -m "Add owner correction and appeal APIs"
```

### Task 5: Add iOS Content-Action Models and Client Methods

**Files:**
- Modify: `ZhouBianTuan/SafetyModels.swift`
- Modify: `ZhouBianTuan/BackendClient.swift`
- Modify: `ZhouBianTuan/MockAppStore.swift`
- Create: `ZhouBianTuanCoreTests/ContentActionModelsTests.swift`

**Interfaces:**
- Produces: `SafetyContentAction`, `SafetyRevisionDraft`, `contentActions`, `submitRevision`, and `submitAppeal`.

- [ ] **Step 1: Write failing Codable tests**

Decode an `awaiting_correction` post action with affected fields and deadline, and encode a post revision and appeal. Assert no report/admin fields appear in encoded owner payloads.

- [ ] **Step 2: Implement models**

```swift
public struct SafetyContentAction: Codable, Identifiable, Equatable, Sendable {
    public var id: String { caseID }
    public let caseID: String
    public let targetType: SafetyTargetType
    public let targetID: String
    public let category: SafetyReasonCode
    public let status: String
    public let affectedFields: [SafetyReportedField]
    public let reason: String
    public let currentRestriction: String
    public let correctionDueAt: String?
    public let canSubmitRevision: Bool
    public let canAppeal: Bool
    public let revisionStatus: String?
    public let updatedAt: String
}
```

Add typed post and collection revision payloads whose field names match Phase 4 backend snapshots.

- [ ] **Step 3: Implement client methods and store state**

```swift
func contentActions(token: String) async throws -> [SafetyContentAction]
func submitRevision<T: Encodable>(token: String, caseID: String, draft: T) async throws -> SafetyContentAction
func submitAppeal(token: String, caseID: String, detail: String, objectKeys: [String]) async throws -> SafetyContentAction
```

Add `@Published var safetyContentActions`, refresh on bootstrap/foreground/safety sync, and preserve the current public object until backend sync reports a published revision.

- [ ] **Step 4: Run tests, build, and commit**

```bash
swift test --package-path .
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO build
git add ZhouBianTuan/SafetyModels.swift ZhouBianTuan/BackendClient.swift ZhouBianTuan/MockAppStore.swift ZhouBianTuanCoreTests/ContentActionModelsTests.swift
git commit -m "Connect iOS content remediation APIs"
```

### Task 6: Build Content Remediation and Appeal UI

**Files:**
- Create: `ZhouBianTuan/ContentRemediationViews.swift`
- Modify: `ZhouBianTuan/SettingsViews.swift`
- Modify: `ZhouBianTuan/ZhouBianTuanApp.swift`
- Modify: `ZhouBianTuan/CreatePostViews.swift:35-53,270-320,360-410`
- Modify: `ZhouBianTuan/ProfileViews.swift:973-1045`
- Modify: `ZhouBianTuan/MockAppStore.swift:2160-2290`
- Modify: `ZhouBianTuan.xcodeproj/project.pbxproj`

**Interfaces:**
- Produces: `Route.contentRemediation`, `ContentRemediationView`, `SafetyPostCorrectionView`, `SafetyCollectionCorrectionView`, and `SafetyAppealSheet`.

- [ ] **Step 1: Add the Content Remediation settings route**

Display pending items grouped by waiting correction, rechecking, manual review, and appeal. Each row shows object title, affected fields, restriction, deadline, and one clear command. Do not nest item cards inside section cards.

- [ ] **Step 2: Reuse the post editor in revision mode**

Add `revisionCaseID` and `editingOriginalPostID` parameters. In revision mode, prefill the original post, keep collection fields read-only/inherited, upload new images, call `submitRevision`, and never call `createPost` or `deletePost`. Keep the legacy moderation republish path separate until it is migrated explicitly.

- [ ] **Step 3: Reuse the collection editor in revision mode**

Add `revisionCaseID` to `CreateCollectionSheet`. In revision mode call the revision endpoint and leave the currently public collection untouched until server approval.

- [ ] **Step 4: Add revision and appeal status states**

Show “复审中” after submit, a rejected revision reason with another correction command, and appeal entry only when `canAppeal`. Appeal sheet has 1000-character detail, optional six images, submit progress, and no AI decision language.

- [ ] **Step 5: Build and inspect layouts**

```bash
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO build
```

Inspect waiting, reviewing, rejected, restored, and appeal states on iPhone 17 Pro and one narrow simulator. Verify no text overlap and that the original object remains visible in the app until the backend publishes the candidate.

- [ ] **Step 6: Commit the UI**

```bash
git add ZhouBianTuan/ContentRemediationViews.swift ZhouBianTuan/SettingsViews.swift ZhouBianTuan/ZhouBianTuanApp.swift ZhouBianTuan/CreatePostViews.swift ZhouBianTuan/ProfileViews.swift ZhouBianTuan/MockAppStore.swift ZhouBianTuan.xcodeproj/project.pbxproj
git commit -m "Add owner content remediation UI"
```

### Task 7: Verify Original-ID Restoration End to End

**Files:**
- No source changes unless verification reveals a defect.

**Interfaces:**
- Uses two user accounts and an injected passing moderation fixture; admin action remains a test fixture until Phase 6.

- [ ] **Step 1: Verify post correction**

Create interactions, apply an automatic hide, submit a corrected post, run the review job, and assert the same ID, interaction counts, share route, and case history remain.

- [ ] **Step 2: Verify collection correction**

Apply contact hiding, submit corrected contact, publish, and assert collection contact restores and every independently active child returns without child status mutation; a separately hidden child remains hidden.

- [ ] **Step 3: Verify manual boundaries and appeal**

Apply a manual hold, submit a passing revision, assert no auto-restore, submit an appeal, and assert no worker changes the final decision.

- [ ] **Step 4: Run complete verification**

```bash
npm --prefix backend test
npm --prefix backend run test:db
swift test --package-path .
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO build
git diff --check
```
