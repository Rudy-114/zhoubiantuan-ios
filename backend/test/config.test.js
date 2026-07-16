import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configURL = new URL("../src/config.js", import.meta.url);

test("derives production-only behavior after loading NODE_ENV from ENV_FILE", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "zbt-config-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const environmentFile = path.join(directory, "backend.env");
  await writeFile(environmentFile, [
    "NODE_ENV=production",
    "JWT_SECRET=synthetic-jwt-secret-with-more-than-thirty-two-characters",
    "EMAIL_CODE_SECRET=synthetic-email-secret-with-more-than-thirty-two-characters",
    "OSS_BUCKET=synthetic-bucket",
    "OSS_REGION=cn-shanghai",
    "OSS_ENDPOINT=oss-cn-shanghai.aliyuncs.com",
    "ALIYUN_ACCESS_KEY_ID=synthetic-access-key",
    "ALIYUN_ACCESS_KEY_SECRET=synthetic-access-secret-with-safe-length"
  ].join("\n"), { mode: 0o600 });

  const environment = { ...process.env, ENV_FILE: environmentFile };
  delete environment.NODE_ENV;
  const child = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `const { config } = await import(${JSON.stringify(configURL.href)});` +
      "process.stdout.write(JSON.stringify({" +
      "nodeEnv: config.nodeEnv," +
      "moderationProvider: config.moderation.provider," +
      "adminCookieSecure: config.admin.cookieSecure" +
      "}));"
  ], {
    cwd: backendDirectory,
    env: environment,
    encoding: "utf8"
  });

  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), {
    nodeEnv: "production",
    moderationProvider: "aliyun",
    adminCookieSecure: true
  });
});
