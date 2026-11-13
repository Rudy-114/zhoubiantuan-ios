import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/app.js";

const EXPECTED_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'"
];

test("serves the same-origin admin shell and client routes with strict CSP", async () => {
  await withServer(createApp({ adminWebEnabled: true }), async (baseUrl) => {
    const shell = await fetch(`${baseUrl}/admin`);
    assert.equal(shell.status, 200);
    assert.match(shell.headers.get("content-type") || "", /^text\/html/u);
    assert.equal(shell.headers.get("cache-control"), "no-store");
    const csp = shell.headers.get("content-security-policy") || "";
    for (const directive of EXPECTED_CSP) assert.ok(csp.includes(directive), directive);
    const html = await shell.text();
    assert.match(html, /lang="zh-Hans"/u);
    assert.match(html, /href="\/admin\/styles\.css"/u);
    assert.match(html, /src="\/admin\/app\.js"/u);
    assert.doesNotMatch(html, /https?:\/\//u);

    const css = await fetch(`${baseUrl}/admin/styles.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") || "", /^text\/css/u);

    const sources = new Map();
    for (const asset of [
      "deviceKeys.js",
      "api.js",
      "formatters.js",
      "app.js",
      "authViews.js",
      "deviceViews.js",
      "workspace.js",
      "caseViews.js",
      "aiViews.js",
      "moderationViews.js",
      "auditViews.js"
    ]) {
      const response = await fetch(`${baseUrl}/admin/${asset}`);
      assert.equal(response.status, 200, asset);
      assert.match(response.headers.get("content-type") || "", /javascript/u, asset);
      sources.set(asset, await response.text());
    }
    assert.doesNotMatch(sources.get("deviceKeys.js"), /localStorage/u);
    assert.match(sources.get("deviceKeys.js"), /generateKey\([\s\S]*?false,[\s\S]*?\["sign", "verify"\]/u);
    assert.doesNotMatch(sources.get("deviceKeys.js"), /exportKey\([^)]*privateKey/u);
    assert.match(sources.get("api.js"), /credentials: "same-origin"/u);
    assert.doesNotMatch(sources.get("api.js"), /console\./u);
    assert.doesNotMatch(sources.get("app.js"), /localStorage|sessionStorage|console\./u);
    assert.match(sources.get("app.js"), /globalThis\.addEventListener\("keydown", handleKeyDown\)/u);
    assert.match(sources.get("app.js"), /view\.querySelector\("\.nav-toggle"\)\?\.focus\(\)/u);
    assert.match(sources.get("aiViews.js"), /执行闸门/u);
    assert.match(sources.get("aiViews.js"), /运行版本一致/u);
    assert.match(sources.get("aiViews.js"), /夹具版本一致/u);
    assert.doesNotMatch(sources.get("aiViews.js"), /data-action.{0,80}(enforce|gate|override)/u);
    assert.match(sources.get("caseViews.js"), /标记举报滥用/u);
    assert.match(sources.get("caseViews.js"), /我确认只标记当前这一条举报/u);
    assert.match(sources.get("caseViews.js"), /同一举报账号已计数/u);

    const clientRoute = await fetch(`${baseUrl}/admin/cases/case-example`);
    assert.equal(clientRoute.status, 200);
    assert.match(clientRoute.headers.get("content-type") || "", /^text\/html/u);
    assert.equal(await clientRoute.text(), html);

    const apiMiss = await fetch(`${baseUrl}/admin/api/not-a-route`);
    assert.equal(apiMiss.status, 404);
    assert.match(apiMiss.headers.get("content-type") || "", /application\/json/u);
    assert.equal((await apiMiss.json()).code, "admin_route_not_found");
  });
});

test("keeps the admin web and APIs disabled behind ADMIN_WEB_ENABLED", async () => {
  await withServer(createApp({ adminWebEnabled: false }), async (baseUrl) => {
    const shell = await fetch(`${baseUrl}/admin`);
    assert.equal(shell.status, 404);
    const api = await fetch(`${baseUrl}/admin/api/auth/session`);
    assert.equal(api.status, 404);
    assert.equal(api.headers.get("cache-control"), "no-store");
    assert.equal((await api.json()).code, "admin_disabled");
  });
});

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
