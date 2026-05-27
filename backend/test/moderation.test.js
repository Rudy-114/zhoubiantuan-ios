import test from "node:test";
import assert from "node:assert/strict";
import { MockModerationProvider } from "../src/moderation/mockProvider.js";
import { combineModerationResults, moderationErrorResult } from "../src/moderation/result.js";
import { postModerationSnapshot, publicContentModerationText } from "../src/moderation/text.js";

test("mock moderation maps text triggers", async () => {
  const provider = new MockModerationProvider();

  assert.equal((await provider.reviewText({ text: "正常内容" })).status, "active");
  assert.equal((await provider.reviewText({ text: "触发人工审核" })).status, "review");
  assert.equal((await provider.reviewText({ text: "触发驳回测试" })).status, "rejected");
});

test("mock moderation maps image triggers", async () => {
  const provider = new MockModerationProvider();

  assert.equal((await provider.reviewImages({ imageObjectKeys: ["post/u/date/ok.jpg"] })).status, "active");
  assert.equal((await provider.reviewImages({ imageObjectKeys: ["post/u/date/review.jpg"] })).status, "review");
  assert.equal((await provider.reviewImages({ imageObjectKeys: ["post/u/date/block.jpg"] })).status, "rejected");
});

test("combined moderation prefers block, then review, then pass", () => {
  assert.equal(combineModerationResults([{ outcome: "pass" }, { outcome: "review" }]).status, "review");
  assert.equal(combineModerationResults([{ outcome: "review" }, { outcome: "block" }]).status, "rejected");
  assert.equal(combineModerationResults([{ outcome: "pass" }, { outcome: "pass" }]).status, "active");
});

test("moderation errors fail into review", () => {
  const result = moderationErrorResult(new Error("timeout"), "imageSignal");
  assert.equal(result.status, "review");
  assert.match(result.reason, /人工审核/);
});

test("public content moderation excludes structured contact handles", () => {
  const snapshot = postModerationSnapshot(
    {
      title: "普通团",
      description: "正常描述",
      wechat: "wx-114514",
      qq: "114514",
      groupInfo: "正常群说明"
    },
    null,
    "普通团"
  );
  const text = publicContentModerationText(snapshot);

  assert.match(text, /普通团/);
  assert.match(text, /正常描述/);
  assert.doesNotMatch(text, /wechat/i);
  assert.doesNotMatch(text, /\bqq\b/i);
  assert.doesNotMatch(text, /wx-114514/);
  assert.doesNotMatch(text, /114514/);
});
