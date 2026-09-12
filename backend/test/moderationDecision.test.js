import assert from "node:assert/strict";
import test from "node:test";
import { applyModerationDecision, moderationDecision } from "../src/moderation/decisionService.js";

test("normalizes every legacy moderation decision through one shared contract", () => {
  assert.deepEqual(moderationDecision("approve"), {
    name: "approve",
    decision: "approve",
    reviewStatus: "active",
    targetStatus: "active"
  });
  assert.equal(moderationDecision("reject").targetStatus, "rejected");
  assert.equal(moderationDecision("hide").targetStatus, "hidden");
  assert.equal(moderationDecision("remove").targetStatus, "removed");
  assert.equal(moderationDecision("ignore").targetStatus, null);
  assert.throws(() => moderationDecision("unknown"), /审核处理动作无效/u);
});

test("applies shared decisions to every supported moderation target", async () => {
  const queries = [];
  const client = {
    async query(text, params) {
      queries.push({ text: String(text), params });
      return { rows: [] };
    }
  };
  const approve = moderationDecision("approve");
  const fixtures = [
    { target_type: "post", target_id: "post-1" },
    { target_type: "comment", target_id: "comment-1" },
    { target_type: "collection", target_id: "collection-1" },
    { target_type: "profileText", owner_id: "user-1", snapshot: { nickname: "合成昵称" } },
    { target_type: "avatar", owner_id: "user-1", snapshot: { avatarObjectKey: "avatar/user-1/a.png" } },
    { target_type: "profileBackground", owner_id: "user-1", snapshot: { backgroundObjectKey: "background/user-1/b.png" } }
  ];
  for (const review of fixtures) await applyModerationDecision(client, review, approve);
  assert.equal(queries.length, fixtures.length);
  assert.match(queries[0].text, /UPDATE posts/u);
  assert.match(queries[1].text, /UPDATE comments/u);
  assert.match(queries[2].text, /UPDATE group_collections/u);
  assert.match(queries[3].text, /SET nickname/u);
  assert.match(queries[4].text, /avatar_object_key/u);
  assert.match(queries[5].text, /background_object_key/u);

  await applyModerationDecision(client, fixtures[0], moderationDecision("ignore"));
  assert.equal(queries.length, fixtures.length);
});
