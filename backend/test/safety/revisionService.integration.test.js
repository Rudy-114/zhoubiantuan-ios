import assert from "node:assert/strict";
import test from "node:test";
import { withTransaction } from "../../src/db.js";
import { registerReportUpload } from "../../src/safety/reportUploadCleanup.js";
import { submitContentRevision } from "../../src/safety/revisionService.js";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";

const REPORT_UPLOAD_KEY = "report/u-owner/2026-07-13/evidence.jpg";

test.beforeEach(async () => {
  await resetDatabase();
  await seedRevisionTargets();
  for (const filename of ['candidate.jpg', 'candidate-preview.jpg', 'supporting.jpg']) {
    const key = `post/u-owner/2026-07-13/${filename}`;
    await pool.query("INSERT INTO upload_tickets(token_hash,object_key,user_id,kind,content_type,status) VALUES($1,$2,'u-owner','post','image/jpeg','ready')", [filename, key]);
  }
});

test.after(closeDatabase);

test("rejects a pool and fake client before revision business queries", async () => {
  const fakeQueries = [];
  const fakeClient = {
    query(sql) {
      fakeQueries.push(String(sql));
      throw new Error("revision business query should not run");
    }
  };

  for (const candidate of [pool, fakeClient]) {
    await assert.rejects(
      submitContentRevision(candidate, postSubmission({ caseId: "missing-case" })),
      (error) => {
        assert.equal(error.name, "TypeError");
        assert.match(error.message, /transaction-scoped.*PoolClient/i);
        return true;
      }
    );
  }
  assert.deepEqual(fakeQueries, []);
});

test("rejects an acquired client without BEGIN before revision business queries", async () => {
  const client = await pool.connect();
  const queries = [];
  const recordingClient = clientProxy(client, async (sql, params) => {
    queries.push(String(sql));
    return client.query(sql, params);
  });

  try {
    await assert.rejects(
      submitContentRevision(recordingClient, postSubmission({ caseId: "missing-case" })),
      (error) => {
        assert.equal(error.name, "TypeError");
        assert.match(error.message, /active transaction/i);
        return true;
      }
    );
    assert.deepEqual(queries, ["SAVEPOINT submit_content_revision_probe"]);
  } finally {
    client.release();
  }
});

test("submits revision 1 for an owned post awaiting correction", async () => {
  const snapshot = postCandidate();
  const objectKeys = [
    REPORT_UPLOAD_KEY,
    REPORT_UPLOAD_KEY,
    "post/u-owner/2026-07-13/supporting.jpg"
  ];
  await registerRevisionUpload(REPORT_UPLOAD_KEY);

  const revision = await withTransaction((client) => submitContentRevision(client, {
    caseId: "case-post-revision",
    ownerId: "u-owner",
    snapshot,
    objectKeys
  }));

  assert.match(revision.id, /^cr-/);
  assert.equal(revision.case_id, "case-post-revision");
  assert.equal(revision.target_type, "post");
  assert.equal(revision.target_id, "post-revision");
  assert.equal(revision.owner_id, "u-owner");
  assert.equal(revision.revision_number, 1);
  assert.equal(revision.status, "pending");
  assert.deepEqual(revision.snapshot, expectedPostSnapshot());
  assert.deepEqual(revision.object_keys, [
    REPORT_UPLOAD_KEY,
    "post/u-owner/2026-07-13/supporting.jpg"
  ]);

  const state = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM content_revisions) AS revisions,
       (SELECT count(*)::int FROM safety_jobs WHERE job_type = 'review_revision') AS jobs,
       (SELECT count(*)::int FROM safety_case_events WHERE event_type = 'revision.submitted') AS events,
       (SELECT status FROM safety_cases WHERE id = 'case-post-revision') AS case_status`
  );
  assert.deepEqual(state.rows[0], { revisions: 1, jobs: 1, events: 1, case_status: "rechecking" });

  const job = await pool.query(
    "SELECT case_id, unique_key, payload FROM safety_jobs WHERE job_type = 'review_revision'"
  );
  assert.deepEqual(job.rows[0], {
    case_id: "case-post-revision",
    unique_key: `review_revision:${revision.id}`,
    payload: { revisionId: revision.id }
  });

  const event = await pool.query(
    "SELECT actor_type, actor_id, event_type, event_data FROM safety_case_events"
  );
  assert.deepEqual(event.rows[0], {
    actor_type: "owner",
    actor_id: "u-owner",
    event_type: "revision.submitted",
    event_data: { revisionId: revision.id, revisionNumber: 1 }
  });
  const upload = await pool.query("SELECT state FROM report_uploads WHERE object_key = $1", [REPORT_UPLOAD_KEY]);
  assert.equal(upload.rows[0].state, "attached");
});

test("rolls back a claimed report upload when review job insertion fails", async () => {
  await registerRevisionUpload(REPORT_UPLOAD_KEY);
  const queries = [];

  await assert.rejects(
    injectedSubmission("INSERT INTO safety_jobs", {
      ...postSubmission(),
      objectKeys: [REPORT_UPLOAD_KEY]
    }, queries),
    /injected revision failure/
  );

  assert.equal(queries.some((sql) => sql.includes("UPDATE report_uploads")), true);
  await assertRevisionRollback(REPORT_UPLOAD_KEY);
});

test("rolls back revision, job, case status, event, and upload claim when event insertion fails", async () => {
  await registerRevisionUpload(REPORT_UPLOAD_KEY);
  const queries = [];

  await assert.rejects(
    injectedSubmission("INSERT INTO safety_case_events", {
      ...postSubmission(),
      objectKeys: [REPORT_UPLOAD_KEY]
    }, queries),
    /injected revision failure/
  );

  assert.equal(queries.some((sql) => sql.includes("UPDATE report_uploads")), true);
  await assertRevisionRollback(REPORT_UPLOAD_KEY);
});

test("rejects a second submit while revision 1 remains active", async () => {
  const input = postSubmission();
  await withTransaction((client) => submitContentRevision(client, input));

  await assert.rejects(
    withTransaction((client) => submitContentRevision(client, input)),
    (error) => error.status === 409 && error.apiCode === "revision_in_progress"
  );

  await assertSubmissionCounts({ revisions: 1, jobs: 1, events: 1 });
});

test("rejects a revision submitted by a non-owner", async () => {
  await assert.rejects(
    withTransaction((client) => submitContentRevision(client, {
      ...postSubmission(),
      ownerId: "u-other"
    })),
    (error) => error.status === 403
  );

  await assertSubmissionCounts({ revisions: 0, jobs: 0, events: 0 });
});

test("rejects a manual-review case when no correction was requested", async () => {
  await pool.query("UPDATE safety_cases SET status = 'manual_review' WHERE id = 'case-post-revision'");

  await assert.rejects(
    withTransaction((client) => submitContentRevision(client, postSubmission())),
    (error) => error.status === 409 && error.apiCode === "correction_not_requested"
  );

  await assertSubmissionCounts({ revisions: 0, jobs: 0, events: 0 });
});

test("keeps the source post immutable until a later publish", async () => {
  const before = await pool.query("SELECT * FROM posts WHERE id = 'post-revision'");

  await withTransaction((client) => submitContentRevision(client, postSubmission()));

  const after = await pool.query("SELECT * FROM posts WHERE id = 'post-revision'");
  assert.deepEqual(after.rows[0], before.rows[0]);
});

test("normalizes a collection candidate without modifying the source collection", async () => {
  const deadline = new Date(Date.now() + 2 * 86400 * 1000).toISOString();
  const before = await pool.query("SELECT * FROM group_collections WHERE id = 'collection-revision'");

  const revision = await withTransaction((client) => submitContentRevision(client, {
    caseId: "case-collection-revision",
    ownerId: "u-owner",
    snapshot: collectionCandidate({ deadline })
  }));

  assert.deepEqual(revision.snapshot, {
    name: "Revised collection",
    contactWechat: "revision-wechat",
    contactQQ: "revision-qq",
    contactGroupNumber: "revision-group",
    groupInfo: "Revised group information",
    deadline,
    defaultNote: "Revised default note"
  });
  assert.equal(Object.hasOwn(revision.snapshot, "deadlineConfirmed"), false);

  const after = await pool.query("SELECT * FROM group_collections WHERE id = 'collection-revision'");
  assert.deepEqual(after.rows[0], before.rows[0]);
});

test("rejects object keys with traversal, a wrong owner, or an unsupported kind", async () => {
  const invalidInputs = [
    { objectKeys: ["report/u-other/2026-07-13/evidence.jpg"] },
    { objectKeys: ["avatar/u-owner/2026-07-13/avatar.jpg"] },
    { objectKeys: ["report/u-owner/2026-07-13/../evidence.jpg"] },
    { snapshot: postCandidate({ imageObjectKeys: ["post/u-other/2026-07-13/image.jpg"] }) },
    { snapshot: postCandidate({ previewImageObjectKeys: ["report/u-owner/2026-07-13/preview.jpg"] }) },
    { snapshot: postCandidate({ previewImageObjectKeys: ["post/u-owner/2026-07-13/../preview.jpg"] }) }
  ];

  for (const overrides of invalidInputs) {
    await assert.rejects(
      withTransaction((client) => submitContentRevision(client, { ...postSubmission(), ...overrides })),
      (error) => error.status === 400
    );
  }

  await assertSubmissionCounts({ revisions: 0, jobs: 0, events: 0 });
});

test("rejects an unregistered owner-looking report upload", async () => {
  await assert.rejects(
    withTransaction((client) => submitContentRevision(client, {
      ...postSubmission(),
      objectKeys: [REPORT_UPLOAD_KEY]
    })),
    (error) => error.status === 400 && error.apiCode === "report_upload_unavailable"
  );

  await assertSubmissionCounts({ revisions: 0, jobs: 0, events: 0 });
});

test("serializes contested case submissions behind target and case locks", async () => {
  const results = await runLockBarrierRace({
    firstInput: postSubmission(),
    secondInput: postSubmission(),
    contestedQuery: /SELECT \* FROM safety_cases WHERE id = \$1 FOR UPDATE/
  });

  const fulfilled = results.filter(({ status }) => status === "fulfilled");
  const rejected = results.filter(({ status }) => status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(fulfilled[0].value.revision_number, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 409);
  assert.equal(rejected[0].reason.apiCode, "revision_in_progress");
  await assertSubmissionCounts({ revisions: 1, jobs: 1, events: 1 });
});

test("serializes different cases on one target into monotonic revision numbers", async () => {
  const results = await runLockBarrierRace({
    firstInput: postSubmission(),
    secondInput: postSubmission({ caseId: "case-post-secondary" }),
    contestedQuery: /SELECT author_id AS owner_id FROM posts WHERE id = \$1 FOR UPDATE/
  });

  assert.equal(results.every(({ status }) => status === "fulfilled"), true);
  assert.deepEqual(results.map(({ value }) => value.revision_number).sort((a, b) => a - b), [1, 2]);
  const rows = await pool.query(
    "SELECT case_id, revision_number FROM content_revisions ORDER BY revision_number"
  );
  assert.deepEqual(rows.rows, [
    { case_id: "case-post-revision", revision_number: 1 },
    { case_id: "case-post-secondary", revision_number: 2 }
  ]);
  await assertSubmissionCounts({ revisions: 2, jobs: 2, events: 2 });
});

test("rejects unknown fields and collection-owned fields in a post snapshot", async () => {
  const forbiddenFields = [
    "wechat",
    "qq",
    "groupNumber",
    "groupInfo",
    "deadline",
    "defaultNote",
    "contactWechat",
    "contactQQ",
    "contactGroupNumber",
    "collectionID"
  ];

  for (const field of forbiddenFields) {
    await assert.rejects(
      withTransaction((client) => submitContentRevision(client, {
        ...postSubmission(),
        snapshot: postCandidate({ [field]: "not allowed" })
      })),
      (error) => error.status === 400
    );
  }

  await assertSubmissionCounts({ revisions: 0, jobs: 0, events: 0 });
});

test("requires complete collection fields and allows confirmed past deadlines as metadata only", async () => {
  const invalidSnapshots = [
    collectionCandidate({ name: " " }),
    collectionCandidate({ defaultNote: " " }),
    collectionCandidate({ contactWechat: "", contactQQ: "", contactGroupNumber: "" }),
    collectionCandidate({ deadline: "not-a-date" }),
    collectionCandidate({ deadline: "2000-01-01T00:00:00.000Z" }),
    collectionCandidate({ unexpected: "field" })
  ];

  for (const snapshot of invalidSnapshots) {
    await assert.rejects(
      withTransaction((client) => submitContentRevision(client, collectionSubmission(snapshot))),
      (error) => error.status === 400
    );
  }

  const revision = await withTransaction((client) => submitContentRevision(client, collectionSubmission(
    collectionCandidate({ deadline: "2000-01-01T00:00:00.000Z", deadlineConfirmed: true })
  )));
  assert.equal(revision.snapshot.deadline, "2000-01-01T00:00:00.000Z");
  assert.equal(Object.hasOwn(revision.snapshot, "deadlineConfirmed"), false);
});

test("rejects oversized snapshot strings, arrays, roles, and object keys", async () => {
  const longObjectKey = `post/u-owner/2026-07-13/${"x".repeat(1000)}.jpg`;
  const postVariants = [
    { title: repeated("t", 201) },
    { price: repeated("p", 257) },
    { deposit: repeated("d", 257) },
    { condition: repeated("c", 257) },
    { pingguAveragePrice: repeated("a", 257) },
    { description: repeated("d", 5001) },
    { pingguNote: repeated("n", 5001) },
    { externalLink: repeated("l", 2049) },
    { imageNames: [repeated("i", 161)] },
    { categoryTags: [repeated("c", 161)] },
    { fandomTags: [repeated("f", 161)] },
    { imageObjectKeys: [longObjectKey] },
    { imageNames: repeatedArray("image", 17) },
    { imageObjectKeys: repeatedArray("post/u-owner/2026-07-13/image", 17, ".jpg") },
    { previewImageObjectKeys: repeatedArray("post/u-owner/2026-07-13/preview", 17, ".jpg") },
    { categoryTags: repeatedArray("category", 33) },
    { fandomTags: repeatedArray("fandom", 33) },
    { unsoldRoles: Array.from({ length: 101 }, (_, index) => validRole(index)) }
  ];
  for (const overrides of postVariants) {
    await assertBadPostCandidate(overrides);
  }

  const collectionVariants = [
    { name: repeated("n", 201) },
    { contactWechat: repeated("w", 257) },
    { contactQQ: repeated("q", 257) },
    { contactGroupNumber: repeated("g", 257) },
    { groupInfo: repeated("i", 5001) },
    { defaultNote: repeated("d", 5001) }
  ];
  for (const overrides of collectionVariants) {
    await assertBadCollectionCandidate(overrides);
  }

  await assert.rejects(
    withTransaction((client) => submitContentRevision(client, postSubmission({
      objectKeys: repeatedArray("post/u-owner/2026-07-13/evidence", 7, ".jpg")
    }))),
    (error) => error.status === 400
  );
  await assert.rejects(
    withTransaction((client) => submitContentRevision(client, postSubmission({ objectKeys: [longObjectKey] }))),
    (error) => error.status === 400
  );
});

test("rejects malformed role structures and scalar coercion", async () => {
  const malformedRoles = [
    null,
    [],
    { ...validRole(1), arbitrary: true },
    { ...validRole(1), id: "" },
    { ...validRole(1), id: repeated("i", 161) },
    { ...validRole(1), name: "" },
    { ...validRole(1), name: repeated("n", 161) },
    { ...validRole(1), quantity: -1 },
    { ...validRole(1), quantity: 100001 },
    { ...validRole(1), quantity: 1.5 },
    { ...validRole(1), priceAdjustment: Number.NaN },
    { ...validRole(1), priceAdjustment: 1000001 },
    { ...validRole(1), name: { nested: true } }
  ];
  for (const role of malformedRoles) {
    await assertBadPostCandidate({ unsoldRoles: [role] });
  }

  const invalidPostScalars = [
    { groupType: false },
    { groupType: "unknown" },
    { isFormed: "false" },
    { imageAspect: "1.25" },
    { imageAspect: 0 },
    { imageAspect: 10.01 },
    { imageAspect: Number.POSITIVE_INFINITY }
  ];
  for (const overrides of invalidPostScalars) {
    await assertBadPostCandidate(overrides);
  }

  const invalidCollectionScalars = [
    { deadline: [] },
    { deadline: {} },
    { deadline: true },
    { deadline: Date.now() + 86400 * 1000 },
    { deadlineConfirmed: "true" }
  ];
  for (const overrides of invalidCollectionScalars) {
    await assertBadCollectionCandidate(overrides);
  }
});

test("rejects duplicate role IDs after trimming and normalization", async () => {
  await assertBadPostCandidate({
    unsoldRoles: [
      { ...validRole(1), id: " role-1 " },
      { ...validRole(2), id: "role-1" }
    ]
  });
});

test("rejects NUL in a title with a controlled bad request", async () => {
  await assertBadPostCandidate({ title: "unsafe\0title" });
});

test("rejects NUL in tag and role identifier array values", async () => {
  await assertBadPostCandidate({ categoryTags: ["unsafe\0tag"] });
  await assertBadPostCandidate({ unsoldRoles: [{ ...validRole(1), id: "role\0id" }] });
});

test("rejects embedded controls in revision and post image object keys", async () => {
  await assertBadPostCandidate({
    imageObjectKeys: ["post/u-owner/2026-07-13/unsafe\0image.jpg"]
  });
  await assert.rejects(
    withTransaction((client) => submitContentRevision(client, postSubmission({
      objectKeys: ["post/u-owner/2026-07-13/unsafe\0attachment.jpg"]
    }))),
    (error) => error.status === 400
  );
});

test("rejects non-multiline C0 controls in human long text", async () => {
  await assertBadPostCandidate({ description: "line one\u0001line two" });
});

test("preserves valid multiline description and collection default note", async () => {
  const description = "Line one\nLine two\twith tab\rLine three";
  const defaultNote = "Default line one\nDefault line two\twith tab\rDefault line three";

  const postRevision = await withTransaction((client) => submitContentRevision(client, {
    ...postSubmission(),
    snapshot: postCandidate({ description })
  }));
  const collectionRevision = await withTransaction((client) => submitContentRevision(client, collectionSubmission(
    collectionCandidate({ defaultNote })
  )));

  assert.equal(postRevision.snapshot.description, description);
  assert.equal(collectionRevision.snapshot.defaultNote, defaultNote);
});

async function seedRevisionTargets() {
  await pool.query(
    `INSERT INTO users (id, nickname)
     VALUES ('u-owner', 'Owner'), ('u-other', 'Other user')`
  );
  await pool.query(
    `INSERT INTO group_collections (
       id, owner_id, name, contact_wechat, contact_qq, contact_group_number,
       group_info, deadline, default_note
     ) VALUES (
       'collection-revision', 'u-owner', 'Original collection', 'original-wechat',
       'original-qq', 'original-group', 'Original group information',
       now() + interval '7 days', 'Original default note'
     )`
  );
  await pool.query(
    `INSERT INTO posts (
       id, author_id, collection_id, title, image_names, image_object_keys,
       preview_image_object_keys, group_type, category_tags, fandom_tags,
       price, deposit, deadline, condition, is_formed, description, wechat,
       qq, group_number, group_info, external_link, image_aspect,
       pinggu_average_price, pinggu_note, unsold_roles
     ) VALUES (
       'post-revision', 'u-owner', 'collection-revision', 'Original post',
       ARRAY['original.jpg'], ARRAY['post/u-owner/2026-07-13/original.jpg'],
       ARRAY['post/u-owner/2026-07-13/original-preview.jpg'], 'followGroup',
       ARRAY['original-category'], ARRAY['original-fandom'], 'Original price',
       'Original deposit', now() + interval '7 days', 'Original condition', false,
       'Original description', 'original-wechat', 'original-qq', 'original-group',
       'Original group information', 'https://example.com/original', 1.08,
       'Original average', 'Original note', '[{"id":"original-role","name":"Original role","quantity":1}]'::jsonb
     )`
  );
  await pool.query(
    `INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope, status)
     VALUES
       ('case-post-revision', 'post', 'post-revision', 'other', 'post', 'awaiting_correction'),
       ('case-post-secondary', 'post', 'post-revision', 'spam_or_advertising', 'post', 'awaiting_correction'),
       ('case-collection-revision', 'collection', 'collection-revision', 'other', 'collection', 'awaiting_correction')`
  );
}

function postSubmission(overrides = {}) {
  return {
    caseId: "case-post-revision",
    ownerId: "u-owner",
    snapshot: postCandidate(),
    objectKeys: [],
    ...overrides
  };
}

function collectionSubmission(snapshot) {
  return {
    caseId: "case-collection-revision",
    ownerId: "u-owner",
    snapshot
  };
}

function postCandidate(overrides = {}) {
  return {
    title: " Revised post ",
    imageNames: [" candidate.jpg ", " "],
    imageObjectKeys: [
      " post/u-owner/2026-07-13/candidate.jpg ",
      "post/u-owner/2026-07-13/candidate.jpg"
    ],
    previewImageObjectKeys: ["post/u-owner/2026-07-13/candidate-preview.jpg"],
    groupType: "拼谷",
    categoryTags: [" 小卡 ", " ", "预售", "小卡"],
    fandomTags: [" MCU "],
    price: " ¥35-68 ",
    deposit: " 定金 30% ",
    condition: " 满 60 套开团 ",
    isFormed: true,
    description: " Revised description ",
    externalLink: " https://example.com/revised ",
    imageAspect: 1.25,
    pingguAveragePrice: " 均价35元/吧唧 ",
    pingguNote: " Revised role note ",
    unsoldRoles: [{ id: "role-1", name: "Role one", quantity: 2, priceAdjustment: 0 }],
    ...overrides
  };
}

function expectedPostSnapshot() {
  return {
    title: "Revised post",
    imageNames: ["candidate.jpg"],
    imageObjectKeys: ["post/u-owner/2026-07-13/candidate.jpg"],
    previewImageObjectKeys: ["post/u-owner/2026-07-13/candidate-preview.jpg"],
    groupType: "splitGoods",
    categoryTags: ["小卡", "预售"],
    fandomTags: ["MCU"],
    price: "¥35-68",
    deposit: "定金 30%",
    condition: "满 60 套开团",
    isFormed: true,
    description: "Revised description",
    externalLink: "https://example.com/revised",
    imageAspect: 1.25,
    pingguAveragePrice: "均价35元/吧唧",
    pingguNote: "Revised role note",
    unsoldRoles: [{ id: "role-1", name: "Role one", quantity: 2, priceAdjustment: 0 }]
  };
}

function collectionCandidate(overrides = {}) {
  return {
    name: " Revised collection ",
    contactWechat: " revision-wechat ",
    contactQQ: " revision-qq ",
    contactGroupNumber: " revision-group ",
    groupInfo: " Revised group information ",
    deadline: new Date(Date.now() + 2 * 86400 * 1000).toISOString(),
    defaultNote: " Revised default note ",
    ...overrides
  };
}

async function transactionalSubmission(input) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const revision = await submitContentRevision(client, input);
    await client.query("COMMIT");
    return revision;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function registerRevisionUpload(objectKey) {
  return withTransaction((client) => registerReportUpload(client, {
    ownerUserID: "u-owner",
    objectKey,
    runAt: new Date(Date.now() + 86400 * 1000),
    maxOutstanding: 10,
    maxIssued24h: 10
  }));
}

async function injectedSubmission(failureSql, input, queries = []) {
  const client = await pool.connect();
  const proxy = clientProxy(client, async (sql, params) => {
    queries.push(String(sql));
    if (String(sql).includes(failureSql)) throw new Error("injected revision failure");
    return client.query(sql, params);
  });
  try {
    await client.query("BEGIN");
    await submitContentRevision(proxy, input);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function assertRevisionRollback(objectKey) {
  await assertSubmissionCounts({ revisions: 0, jobs: 0, events: 0 });
  const state = await pool.query(
    `SELECT
       (SELECT status FROM safety_cases WHERE id = 'case-post-revision') AS case_status,
       (SELECT state FROM report_uploads WHERE object_key = $1) AS upload_state`,
    [objectKey]
  );
  assert.deepEqual(state.rows[0], { case_status: "awaiting_correction", upload_state: "pending" });
}

async function runLockBarrierRace({ firstInput, secondInput, contestedQuery }) {
  const firstClient = await pool.connect();
  const secondClient = await pool.connect();
  const firstLocked = deferred();
  const releaseFirst = deferred();
  const secondAttempted = deferred();
  let firstPromise;
  let secondPromise;

  const firstProxy = clientProxy(firstClient, async (sql, params) => {
    const result = await firstClient.query(sql, params);
    if (contestedQuery.test(String(sql))) {
      firstLocked.resolve();
      await releaseFirst.promise;
    }
    return result;
  });
  const secondProxy = clientProxy(secondClient, (sql, params) => {
    const pending = secondClient.query(sql, params);
    if (contestedQuery.test(String(sql)) || /zbt:safety-target/.test(String(sql))) secondAttempted.resolve();
    return pending;
  });

  try {
    await firstClient.query("BEGIN");
    await secondClient.query("BEGIN");
    firstPromise = settleClientSubmission(firstClient, firstProxy, firstInput);
    await gateOrEarlyFailure(firstLocked.promise, firstPromise, "first transaction ended before taking the contested lock");
    secondPromise = settleClientSubmission(secondClient, secondProxy, secondInput);
    await gateOrEarlyFailure(secondAttempted.promise, secondPromise, "second transaction ended before attempting the contested lock");
    releaseFirst.resolve();
    return await Promise.allSettled([firstPromise, secondPromise]);
  } finally {
    releaseFirst.resolve();
    await Promise.allSettled([firstPromise, secondPromise].filter(Boolean));
    await firstClient.query("ROLLBACK").catch(() => {});
    await secondClient.query("ROLLBACK").catch(() => {});
    firstClient.release();
    secondClient.release();
  }
}

async function settleClientSubmission(client, proxy, input) {
  try {
    const revision = await submitContentRevision(proxy, input);
    await client.query("COMMIT");
    return revision;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

function clientProxy(client, query) {
  return {
    query,
    release: client.release.bind(client)
  };
}

async function gateOrEarlyFailure(gate, operation, message) {
  return Promise.race([
    gate,
    operation.then(
      () => Promise.reject(new Error(message)),
      (error) => Promise.reject(error)
    )
  ]);
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function assertBadPostCandidate(overrides) {
  await assert.rejects(
    withTransaction((client) => submitContentRevision(client, {
      ...postSubmission(),
      snapshot: postCandidate(overrides)
    })),
    (error) => error.status === 400
  );
}

async function assertBadCollectionCandidate(overrides) {
  await assert.rejects(
    withTransaction((client) => submitContentRevision(client, collectionSubmission(collectionCandidate(overrides)))),
    (error) => error.status === 400
  );
}

function validRole(index) {
  return { id: `role-${index}`, name: `Role ${index}`, quantity: index, priceAdjustment: 0 };
}

function repeated(character, count) {
  return character.repeat(count);
}

function repeatedArray(prefix, count, suffix = "") {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}${suffix}`);
}

async function assertSubmissionCounts(expected) {
  const counts = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM content_revisions) AS revisions,
       (SELECT count(*)::int FROM safety_jobs WHERE job_type = 'review_revision') AS jobs,
       (SELECT count(*)::int FROM safety_case_events WHERE event_type = 'revision.submitted') AS events`
  );
  assert.deepEqual(counts.rows[0], expected);
}

test("revision images require completed uploads and cannot attach arbitrary historical owned keys", async () => {
  await assert.rejects(withTransaction(client => submitContentRevision(client, {
    caseId: "case-post-revision", ownerId: "u-owner",
    snapshot: postCandidate({ imageObjectKeys: ["post/u-owner/2026-07-13/not-uploaded.jpg"] }), objectKeys: []
  })), /图片尚未上传完成/);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM content_revisions")).rows[0].n, 0);
});
