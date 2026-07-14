import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/app.js";

test("admin API stays same-origin, no-store, size-bounded, and isolated from consumer CORS", async () => {
  await withServer(async (baseUrl) => {
    const oversized = await fetch(`${baseUrl}/admin/api/auth/device-requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example"
      },
      body: JSON.stringify({ padding: "x".repeat(257 * 1024) })
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.headers.get("cache-control"), "no-store");
    assert.equal(oversized.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(await oversized.json(), {
      error: "管理员请求体过大",
      code: "admin_payload_too_large"
    });

    const malformed = await fetch(`${baseUrl}/admin/api/auth/device-requests`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: "{"
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(await malformed.json(), {
      error: "管理员请求 JSON 无效",
      code: "admin_json_invalid"
    });

    const missing = await fetch(`${baseUrl}/admin/api/not-a-route`, {
      headers: { origin: "https://attacker.example" }
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");
    assert.equal(missing.headers.get("access-control-allow-origin"), null);
    assert.equal((await missing.json()).code, "admin_route_not_found");

    const consumer = await fetch(`${baseUrl}/`, {
      headers: { origin: "https://consumer.example" }
    });
    assert.equal(consumer.status, 200);
    assert.equal(consumer.headers.get("access-control-allow-origin"), "*");
  });
});

async function withServer(callback) {
  const server = createApp().listen(0, "127.0.0.1");
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
