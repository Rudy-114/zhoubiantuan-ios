import test from "node:test";
import assert from "node:assert/strict";
import { PRIVACY_POLICY_PATHS, privacyPolicyHtml } from "../src/legal.js";

test("privacy policy page is public App Store material", () => {
  const html = privacyPolicyHtml();

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /周边团隐私政策/);
  assert.match(html, /support@zhoubiantuanmail\.top/);
  assert.match(html, /不会将你的个人信息出售给第三方/);
  assert.match(html, /跨 App 或跨网站追踪/);
  assert.match(html, /设置 - 账号与安全 - 删除账号/);
});

test("privacy policy exposes clean and API-compatible paths", () => {
  assert.deepEqual(PRIVACY_POLICY_PATHS, ["/privacy-policy", "/privacy", "/api/privacy-policy", "/api/privacy"]);
});
