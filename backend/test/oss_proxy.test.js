import test from "node:test";
import assert from "node:assert/strict";

test("public asset URLs fall back to API proxy without CDN base", async () => {
  process.env.OSS_BUCKET ||= "test-bucket";
  process.env.OSS_REGION ||= "cn-shanghai";
  process.env.OSS_ENDPOINT ||= "oss-cn-shanghai.aliyuncs.com";
  process.env.ALIYUN_ACCESS_KEY_ID ||= "test-key";
  process.env.ALIYUN_ACCESS_KEY_SECRET ||= "test-secret";
  process.env.PUBLIC_API_BASE_URL = "https://api.example.com/api";
  delete process.env.PUBLIC_ASSET_BASE_URL;
  delete process.env.CDN_ASSET_BASE_URL;

  const { publicAssetUrl } = await import("../src/oss.js");

  assert.equal(
    publicAssetUrl("post/u-1/2026-06-02/a b.jpg"),
    "https://api.example.com/api/assets/post/u-1/2026-06-02/a%20b.jpg"
  );
});
