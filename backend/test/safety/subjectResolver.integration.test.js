import assert from "node:assert/strict";
import test from "node:test";
import { closeDatabase, pool, resetDatabase } from "../helpers/database.js";
import { resolveReportSubject } from "../../src/safety/subjectResolver.js";

test.beforeEach(async () => {
  await resetDatabase();
  await seedSafetySubjects();
});

test.after(async () => {
  await closeDatabase();
});

test("resolves every source type and lets the server choose collection scope", async () => {
  assert.deepEqual(await resolveReportSubject(pool, {
    sourceType: "post",
    sourceId: "p-1",
    reporterId: "u-reporter",
    reasonCode: "invalid_contact",
    reportedField: "contact_wechat"
  }), {
    subjectType: "collection",
    subjectId: "col-1",
    impactScope: "collection",
    ownerId: "u-owner"
  });
  assert.deepEqual(await resolveReportSubject(pool, {
    sourceType: "post",
    sourceId: "p-1",
    reporterId: "u-reporter",
    reasonCode: "copyright_or_stolen_media",
    reportedField: "content"
  }), {
    subjectType: "post",
    subjectId: "p-1",
    impactScope: "post",
    ownerId: "u-owner"
  });
  assert.deepEqual(await resolveReportSubject(pool, {
    sourceType: "collection",
    sourceId: "col-1",
    reporterId: "u-reporter",
    reasonCode: "false_or_expired_group_buy",
    reportedField: "collection_deadline"
  }), {
    subjectType: "collection",
    subjectId: "col-1",
    impactScope: "collection",
    ownerId: "u-owner"
  });
  assert.deepEqual(await resolveReportSubject(pool, {
    sourceType: "comment",
    sourceId: "c-1",
    reporterId: "u-reporter",
    reasonCode: "harassment_or_abuse",
    reportedField: "content"
  }), {
    subjectType: "comment",
    subjectId: "c-1",
    impactScope: "comment",
    ownerId: "u-commenter"
  });
  assert.deepEqual(await resolveReportSubject(pool, {
    sourceType: "user",
    sourceId: "u-owner",
    reporterId: "u-reporter",
    reasonCode: "suspected_scam",
    reportedField: "content"
  }), {
    subjectType: "user",
    subjectId: "u-owner",
    impactScope: "user",
    ownerId: "u-owner"
  });
  assert.deepEqual(await resolveReportSubject(pool, {
    sourceType: "direct_message",
    sourceId: "m-1",
    reporterId: "u-reporter",
    reasonCode: "direct_message_risk",
    reportedField: "content"
  }), {
    subjectType: "direct_message",
    subjectId: "m-1",
    impactScope: "direct_message",
    ownerId: "u-sender"
  });
});

test("rejects shared-field reporting for a post without a collection", async () => {
  await assert.rejects(
    resolveReportSubject(pool, {
      sourceType: "post",
      sourceId: "p-orphan",
      reporterId: "u-reporter",
      reasonCode: "invalid_contact",
      reportedField: "contact_wechat"
    }),
    /举报目标不存在或不可见/
  );
});

test("requires a nonempty reporterId for public and direct-message sources", async () => {
  const cases = [
    {
      sourceType: "post",
      sourceId: "p-1",
      reasonCode: "suspected_scam",
      reportedField: "content"
    },
    {
      sourceType: "direct_message",
      sourceId: "m-1",
      reasonCode: "direct_message_risk",
      reportedField: "content"
    }
  ];

  for (const input of cases) {
    await assert.rejects(resolveReportSubject(pool, input), /举报目标不存在或不可见/);
    await assert.rejects(resolveReportSubject(pool, { ...input, reporterId: " " }), /举报目标不存在或不可见/);
    await assert.rejects(resolveReportSubject(pool, { ...input, reporterId: 42 }), /举报目标不存在或不可见/);
  }
});

test("rejects self-reporting for every supported source type", async () => {
  const cases = [
    ["post", "p-1", "u-owner"],
    ["comment", "c-1", "u-commenter"],
    ["collection", "col-1", "u-owner"],
    ["user", "u-owner", "u-owner"],
    ["direct_message", "m-1", "u-sender"]
  ];
  for (const [sourceType, sourceId, reporterId] of cases) {
    await assert.rejects(
      resolveReportSubject(pool, {
        sourceType,
        sourceId,
        reporterId,
        reasonCode: "suspected_scam",
        reportedField: "content"
      }),
      /不能举报自己的内容/
    );
  }
});

test("requires direct-message participants to select the other participant's message", async () => {
  assert.deepEqual(await resolveReportSubject(pool, {
    sourceType: "direct_message",
    sourceId: "m-own",
    reporterId: "u-sender",
    reasonCode: "direct_message_risk",
    reportedField: "content"
  }), {
    subjectType: "direct_message",
    subjectId: "m-own",
    impactScope: "direct_message",
    ownerId: "u-reporter"
  });

  await assert.rejects(
    resolveReportSubject(pool, {
      sourceType: "direct_message",
      sourceId: "m-1",
      reporterId: "u-outsider",
      reasonCode: "direct_message_risk",
      reportedField: "content"
    }),
    /举报目标不存在或不可见/
  );
  await assert.rejects(
    resolveReportSubject(pool, {
      sourceType: "direct_message",
      sourceId: "m-own",
      reporterId: "u-reporter",
      reasonCode: "direct_message_risk",
      reportedField: "content"
    }),
    /不能举报自己的内容/
  );

  await pool.query(
    "INSERT INTO direct_messages (id, thread_id, sender_id, body) VALUES ('m-third-party', 't-1', 'u-outsider', 'Third-party message')"
  );
  await assert.rejects(
    resolveReportSubject(pool, {
      sourceType: "direct_message",
      sourceId: "m-third-party",
      reporterId: "u-reporter",
      reasonCode: "direct_message_risk",
      reportedField: "content"
    }),
    /举报目标不存在或不可见/
  );
});

test("applies two-way blocks to comments, users, and collections", async () => {
  const cases = [
    [{ sourceType: "comment", sourceId: "c-1", reasonCode: "harassment_or_abuse", reportedField: "content" }, "u-commenter"],
    [{ sourceType: "user", sourceId: "u-owner", reasonCode: "suspected_scam", reportedField: "content" }, "u-owner"],
    [{ sourceType: "collection", sourceId: "col-1", reasonCode: "suspected_scam", reportedField: "content" }, "u-owner"]
  ];
  for (const [input, ownerId] of cases) {
    for (const [blockerId, blockedId] of [["u-reporter", ownerId], [ownerId, "u-reporter"]]) {
      await pool.query(
        "INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)",
        [blockerId, blockedId]
      );
      await assert.rejects(
        resolveReportSubject(pool, { ...input, reporterId: "u-reporter" }),
        /举报目标不存在或不可见/
      );
      await pool.query("DELETE FROM user_blocks");
    }
  }
});

test("rejects hidden, deleted, and fabricated comments, users, and collections", async () => {
  await pool.query("UPDATE comments SET safety_status = 'hidden' WHERE id = 'c-1'");
  await assert.rejects(resolveReportSubject(pool, {
    sourceType: "comment", sourceId: "c-1", reporterId: "u-reporter", reasonCode: "harassment_or_abuse", reportedField: "content"
  }), /举报目标不存在或不可见/);
  await pool.query("UPDATE comments SET safety_status = 'active', status = 'deleted' WHERE id = 'c-1'");
  await assert.rejects(resolveReportSubject(pool, {
    sourceType: "comment", sourceId: "c-1", reporterId: "u-reporter", reasonCode: "harassment_or_abuse", reportedField: "content"
  }), /举报目标不存在或不可见/);
  await assert.rejects(resolveReportSubject(pool, {
    sourceType: "comment", sourceId: "missing-comment", reporterId: "u-reporter", reasonCode: "harassment_or_abuse", reportedField: "content"
  }), /举报目标不存在或不可见/);

  await pool.query("UPDATE users SET status = 'suspended' WHERE id = 'u-owner'");
  await assert.rejects(resolveReportSubject(pool, {
    sourceType: "user", sourceId: "u-owner", reporterId: "u-reporter", reasonCode: "suspected_scam", reportedField: "content"
  }), /举报目标不存在或不可见/);
  await pool.query("UPDATE users SET status = 'active', deleted_at = now() WHERE id = 'u-owner'");
  await assert.rejects(resolveReportSubject(pool, {
    sourceType: "user", sourceId: "u-owner", reporterId: "u-reporter", reasonCode: "suspected_scam", reportedField: "content"
  }), /举报目标不存在或不可见/);
  await assert.rejects(resolveReportSubject(pool, {
    sourceType: "user", sourceId: "missing-user", reporterId: "u-reporter", reasonCode: "suspected_scam", reportedField: "content"
  }), /举报目标不存在或不可见/);

  await pool.query("UPDATE group_collections SET safety_status = 'suspended' WHERE id = 'col-1'");
  await assert.rejects(resolveReportSubject(pool, {
    sourceType: "collection", sourceId: "col-1", reporterId: "u-reporter", reasonCode: "suspected_scam", reportedField: "content"
  }), /举报目标不存在或不可见/);
  await pool.query("UPDATE group_collections SET safety_status = 'active', status = 'removed' WHERE id = 'col-1'");
  await assert.rejects(resolveReportSubject(pool, {
    sourceType: "collection", sourceId: "col-1", reporterId: "u-reporter", reasonCode: "suspected_scam", reportedField: "content"
  }), /举报目标不存在或不可见/);
  await assert.rejects(resolveReportSubject(pool, {
    sourceType: "collection", sourceId: "missing-collection", reporterId: "u-reporter", reasonCode: "suspected_scam", reportedField: "content"
  }), /举报目标不存在或不可见/);
});

test("hiding contact visibility blocks only contact fields", async () => {
  await pool.query("UPDATE group_collections SET contact_visibility = 'hidden' WHERE id = 'col-1'");
  for (const [sourceType, sourceId] of [["post", "p-1"], ["collection", "col-1"]]) {
    for (const reportedField of ["contact_wechat", "contact_qq", "contact_group_number"]) {
      await assert.rejects(resolveReportSubject(pool, {
        sourceType,
        sourceId,
        reporterId: "u-reporter",
        reasonCode: "invalid_contact",
        reportedField
      }), /举报目标不存在或不可见/);
    }

    for (const [reasonCode, reportedField] of [
      ["false_or_expired_group_buy", "collection_deadline"],
      ["suspected_scam", "collection_description"],
      ["other", "collection_default_note"]
    ]) {
      assert.deepEqual(await resolveReportSubject(pool, {
        sourceType,
        sourceId,
        reporterId: "u-reporter",
        reasonCode,
        reportedField
      }), {
        subjectType: "collection",
        subjectId: "col-1",
        impactScope: "collection",
        ownerId: "u-owner"
      });
    }
  }
});

test("rejects either direction of a user block", async () => {
  await pool.query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('u-reporter', 'u-owner')");
  await assert.rejects(resolvePostForReporter(), /举报目标不存在或不可见/);

  await pool.query("DELETE FROM user_blocks");
  await pool.query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('u-owner', 'u-reporter')");
  await assert.rejects(resolvePostForReporter(), /举报目标不存在或不可见/);
});

test("uses effective safety visibility for deleted, hidden, suspended, and fabricated targets", async () => {
  await pool.query("UPDATE posts SET safety_status = 'hidden' WHERE id = 'p-1'");
  await assert.rejects(resolvePostForReporter(), /举报目标不存在或不可见/);

  await pool.query("UPDATE posts SET safety_status = 'active', status = 'deleted' WHERE id = 'p-1'");
  await assert.rejects(resolvePostForReporter(), /举报目标不存在或不可见/);

  await pool.query("UPDATE posts SET status = 'active' WHERE id = 'p-1'");
  await pool.query("UPDATE group_collections SET status = 'suspended' WHERE id = 'col-1'");
  await assert.rejects(resolvePostForReporter(), /举报目标不存在或不可见/);

  await assert.rejects(resolveReportSubject(pool, {
    sourceType: "post",
    sourceId: "does-not-exist",
    reporterId: "u-reporter",
    reasonCode: "suspected_scam",
    reportedField: "content"
  }), /举报目标不存在或不可见/);
});

test("rejects hidden or deleted comments and messages", async () => {
  await pool.query("UPDATE comments SET safety_status = 'hidden' WHERE id = 'c-1'");
  await assert.rejects(resolveReportSubject(pool, {
    sourceType: "comment",
    sourceId: "c-1",
    reporterId: "u-reporter",
    reasonCode: "harassment_or_abuse",
    reportedField: "content"
  }), /举报目标不存在或不可见/);

  await pool.query("UPDATE comments SET safety_status = 'active', status = 'deleted' WHERE id = 'c-1'");
  await assert.rejects(resolveReportSubject(pool, {
    sourceType: "comment",
    sourceId: "c-1",
    reporterId: "u-reporter",
    reasonCode: "harassment_or_abuse",
    reportedField: "content"
  }), /举报目标不存在或不可见/);

  await pool.query("UPDATE direct_messages SET safety_status = 'hidden' WHERE id = 'm-1'");
  await assert.rejects(resolveReportSubject(pool, {
    sourceType: "direct_message",
    sourceId: "m-1",
    reporterId: "u-reporter",
    reasonCode: "direct_message_risk",
    reportedField: "content"
  }), /举报目标不存在或不可见/);
});

test("rejects blocked direct-message participants", async () => {
  await pool.query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('u-reporter', 'u-sender')");
  await assert.rejects(resolveMessageForReporter(), /举报目标不存在或不可见/);

  await pool.query("DELETE FROM user_blocks");
  await pool.query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('u-sender', 'u-reporter')");
  await assert.rejects(resolveMessageForReporter(), /举报目标不存在或不可见/);
});

async function resolvePostForReporter() {
  return resolveReportSubject(pool, {
    sourceType: "post",
    sourceId: "p-1",
    reporterId: "u-reporter",
    reasonCode: "suspected_scam",
    reportedField: "content"
  });
}

async function resolveMessageForReporter() {
  return resolveReportSubject(pool, {
    sourceType: "direct_message",
    sourceId: "m-1",
    reporterId: "u-reporter",
    reasonCode: "direct_message_risk",
    reportedField: "content"
  });
}

async function seedSafetySubjects() {
  await pool.query(
    `INSERT INTO users (id, nickname)
     VALUES
       ('u-owner', 'Owner'),
       ('u-reporter', 'Reporter'),
       ('u-commenter', 'Commenter'),
       ('u-sender', 'Sender'),
       ('u-recipient', 'Recipient'),
       ('u-outsider', 'Outsider')`
  );
  await pool.query(
    `INSERT INTO group_collections (id, owner_id, name, contact_wechat, deadline)
     VALUES ('col-1', 'u-owner', 'Collection', 'owner-wechat', now() + interval '1 day')`
  );
  await pool.query(
    `INSERT INTO posts (id, author_id, collection_id, title, deadline)
     VALUES
       ('p-1', 'u-owner', 'col-1', 'Child post', now() + interval '1 day'),
       ('p-orphan', 'u-owner', NULL, 'Orphan post', now() + interval '1 day')`
  );
  await pool.query(
    `INSERT INTO comments (id, post_id, author_id, body)
     VALUES ('c-1', 'p-1', 'u-commenter', 'A comment')`
  );
  await pool.query(
    `INSERT INTO message_threads (id, buyer_user_id, publisher_user_id)
     VALUES ('t-1', 'u-reporter', 'u-sender')`
  );
  await pool.query(
    `INSERT INTO direct_messages (id, thread_id, sender_id, body, created_at)
     VALUES
       ('m-own', 't-1', 'u-reporter', 'Reporter message', now()),
       ('m-1', 't-1', 'u-sender', 'Sender message', now() + interval '1 second')`
  );
}
