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

test("public content moderation includes structured contact fields", () => {
  const snapshot = postModerationSnapshot(
    {
      title: "普通团",
      description: "正常描述",
      wechat: "wx-114514",
      qq: "114514",
      groupNumber: "743219008",
      groupInfo: "正常群说明",
      externalLink: "https://example.com/group"
    },
    null,
    "普通团"
  );
  const text = publicContentModerationText(snapshot);

  assert.match(text, /普通团/);
  assert.match(text, /正常描述/);
  assert.match(text, /wechat/i);
  assert.match(text, /\bqq\b/i);
  assert.match(text, /wx-114514/);
  assert.match(text, /114514/);
  assert.match(text, /743219008/);
  assert.match(text, /正常群说明/);
  assert.match(text, /example\.com/);
});

test("public content moderation includes group-buy context for short slang", () => {
  const text = publicContentModerationText({ title: "抢钱", description: "惩罚款小卡开团" });

  assert.match(text, /审核场景/);
  assert.match(text, /周边团购平台/);
  assert.match(text, /抢钱/);
  assert.match(text, /惩罚/);
  assert.match(text, /不要仅凭单词判违规/);
});

test("aliyun text moderation uses configured detection agent", async () => {
  process.env.OSS_BUCKET ||= "test-bucket";
  process.env.OSS_REGION ||= "cn-shanghai";
  process.env.OSS_ENDPOINT ||= "oss-cn-shanghai.aliyuncs.com";
  process.env.ALIYUN_ACCESS_KEY_ID ||= "test-key";
  process.env.ALIYUN_ACCESS_KEY_SECRET ||= "test-secret";
  process.env.ALIYUN_TEXT_AGENT_APP_ID = "txt_check_agent_01";

  const { AliyunModerationProvider } = await import(`../src/moderation/aliyunProvider.js?agent=${Date.now()}`);
  const provider = Object.create(AliyunModerationProvider.prototype);
  const capturedRequests = [];
  provider.request = async (action, params) => {
    capturedRequests.push({ action, params });
    return {
      Code: 200,
      Data: {
        RiskLevel: "none",
        Result: [{ Label: "nonLabel", Description: "未检测出风险" }]
      }
    };
  };

  const result = await provider.reviewText({
    text: "开团说明".repeat(1000),
    ownerId: "u-1",
    targetId: "post/unsafe id"
  });
  const capturedRequest = capturedRequests[0];
  const serviceParameters = JSON.parse(capturedRequest.params.ServiceParameters);
  assert.ok(capturedRequests.length > 1);
  assert.ok(capturedRequests.every(item => Array.from(JSON.parse(item.params.ServiceParameters).content).length <= 2000));

  assert.equal(capturedRequest.action, "MultiModalAgent");
  assert.equal(capturedRequest.params.AppID, "txt_check_agent_01");
  assert.equal(serviceParameters.accountId, "u-1");
  assert.equal(serviceParameters.dataId, "post_unsafe_id");
  assert.equal(serviceParameters.content.length, 2000);
  assert.equal(result.status, "active");
  assert.equal(result.source, "textAgent");
});
