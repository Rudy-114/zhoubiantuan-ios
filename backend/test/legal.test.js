import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIVACY_POLICY_PATHS,
  SUPPORT_PAGE_PATHS,
  privacyPolicyHtml,
  supportPageHtml
} from "../src/legal.js";

test("privacy policy page is public App Store material", () => {
  const html = privacyPolicyHtml();

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /周边团隐私政策/);
  assert.match(html, /support@zhoubiantuanmail\.top/);
  assert.match(html, /不会将你的个人信息出售给第三方/);
  assert.match(html, /跨 App 或跨网站追踪/);
  assert.match(html, /设置 - 账号与安全 - 删除账号/);
  assert.match(html, /账号标识/);
  assert.match(html, /点赞、收藏、关注/);
  assert.match(html, /不可逆哈希/);
});

test("privacy policy exposes clean and API-compatible paths", () => {
  assert.deepEqual(PRIVACY_POLICY_PATHS, ["/privacy-policy", "/privacy", "/api/privacy-policy", "/api/privacy"]);
});

test("support page provides public App Store support information", () => {
  const html = supportPageHtml();

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /周边团用户支持/);
  assert.match(html, /support@zhoubiantuanmail\.top/);
  assert.match(html, /设置 - 账号与安全 - 删除账号/);
  assert.match(html, /举报与申诉/);
  assert.match(html, /社区安全与内容规范/);
  assert.match(html, /href="\/privacy-policy"/);
  assert.match(html, /prefers-reduced-motion/);
});

test("support page exposes clean and API-compatible paths", () => {
  assert.deepEqual(SUPPORT_PAGE_PATHS, ["/support", "/help", "/api/support", "/api/help"]);
});
