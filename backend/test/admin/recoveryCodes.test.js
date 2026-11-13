import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import bcrypt from "bcryptjs";
import {
  parseCreateAdminArguments,
  readHiddenLine,
  runCreateAdmin
} from "../../scripts/create-admin.js";
import {
  generateBootstrapCode,
  generateRecoveryCodes,
  hashBootstrapCode,
  hashRecoveryCode
} from "../../src/admin/recoveryCodes.js";

const pepper = "test-admin-recovery-pepper-with-32-plus-characters";

test("generates ten unique human-readable recovery codes and domain-separated hashes", () => {
  const codes = generateRecoveryCodes(10);
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.ok(codes.every((code) => /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/.test(code)));

  const recoveryHash = hashRecoveryCode(codes[0], pepper);
  assert.match(recoveryHash, /^[a-f0-9]{64}$/);
  assert.equal(hashRecoveryCode(codes[0].toLowerCase(), pepper), recoveryHash);
  assert.notEqual(recoveryHash, codes[0]);
  assert.notEqual(hashBootstrapCode(codes[0], pepper), recoveryHash);
  assert.throws(() => hashRecoveryCode(codes[0], "short"), /ADMIN_RECOVERY_PEPPER/);
  assert.throws(() => hashRecoveryCode(codes[0], " ".repeat(32)), /ADMIN_RECOVERY_PEPPER/);
});

test("generates a high-entropy human-readable bootstrap code", () => {
  const code = generateBootstrapCode();
  assert.match(code, /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
  assert.match(hashBootstrapCode(code, pepper), /^[a-f0-9]{64}$/);
});

test("hidden TTY input disables echo and restores terminal mode", async () => {
  const stdin = new FakeTTY();
  const writes = [];
  const promise = readHiddenLine({ stdin, output: { write: (value) => writes.push(value) }, prompt: "密码：" });
  setImmediate(() => stdin.emit("data", Buffer.from("Secret phrase 123\r")));

  assert.equal(await promise, "Secret phrase 123");
  assert.deepEqual(stdin.rawModes, [true, false]);
  assert.equal(writes.join(""), "密码：\n");
  assert.ok(!writes.join("").includes("Secret phrase 123"));
});

test("creates one admin, ten recovery hashes, and one bootstrap hash in one transaction", async () => {
  const queries = [];
  let transactions = 0;
  const stdoutWrites = [];
  const now = new Date("2026-07-14T00:00:00.000Z");
  const password = "Long admin password 2026";

  await runCreateAdmin({
    argv: ["--username", " RootAdmin ", "--allow-stdin"],
    stdin: Readable.from([`${password}\n${password}\n`]),
    stdout: { write: (value) => stdoutWrites.push(value) },
    stderr: { write() {} },
    pepper,
    now,
    withTransactionImpl: async (callback) => {
      transactions += 1;
      return callback({
        async query(text, params) {
          queries.push({ text, params });
          return { rows: text.includes("RETURNING id") ? [{ id: "admin-test" }] : [] };
        }
      });
    }
  });

  assert.equal(transactions, 1);
  assert.equal(queries.length, 4);
  assert.match(queries[0].text, /LOCK TABLE admin_users/);
  assert.match(queries[1].text, /INSERT INTO admin_users/);
  assert.equal(queries[1].params[1], "RootAdmin");
  assert.equal(queries[1].params[2], "rootadmin");
  assert.equal(bcrypt.getRounds(queries[1].params[3]), 12);
  assert.match(queries[2].text, /INSERT INTO admin_recovery_codes/);
  assert.equal(queries[2].params[1].length, 10);
  assert.ok(queries[2].params[1].every((value) => /^[a-f0-9]{64}$/.test(value)));
  assert.match(queries[3].text, /INSERT INTO admin_bootstrap_codes/);
  assert.equal(queries[3].params[3].toISOString(), "2026-07-14T00:10:00.000Z");

  assert.equal(stdoutWrites.length, 1);
  const output = stdoutWrites[0];
  assert.match(output, /管理员：RootAdmin/);
  assert.match(output, /引导码：[A-Z2-9-]+/);
  assert.equal((output.match(/^恢复码 /gm) || []).length, 10);
  assert.ok(!output.includes(password));
  assert.ok(!output.includes(queries[1].params[3]));
  assert.ok(!output.includes(pepper));
  assert.ok(!output.includes("DATABASE_URL"));
});

test("refuses to create a second admin before inserting any one-time material", async () => {
  const password = "Long admin password 2026";
  const queries = [];
  const writes = [];
  await assert.rejects(
    runCreateAdmin({
      argv: ["--username", "second", "--allow-stdin"],
      stdin: Readable.from([`${password}\n${password}\n`]),
      stdout: { write: (value) => writes.push(value) },
      stderr: { write() {} },
      pepper,
      withTransactionImpl: async (callback) => callback({
        async query(text) {
          queries.push(text);
          return { rows: [] };
        }
      })
    }),
    /已存在/
  );
  assert.equal(queries.length, 2);
  assert.match(queries[0], /LOCK TABLE admin_users/);
  assert.match(queries[1], /INSERT INTO admin_users/);
  assert.equal(writes.length, 0);
});

test("refuses piped passwords without opt-in and rejects mismatch before a transaction", async () => {
  assert.throws(
    () => parseCreateAdminArguments(["--username", "--allow-stdin"]),
    /--username|管理员名/
  );
  let transactions = 0;
  await assert.rejects(
    runCreateAdmin({
      argv: ["--username", "root"],
      stdin: Readable.from(["Long admin password 2026\nLong admin password 2026\n"]),
      stdout: { write() {} },
      stderr: { write() {} },
      pepper,
      withTransactionImpl: async () => { transactions += 1; }
    }),
    /--allow-stdin/
  );
  await assert.rejects(
    runCreateAdmin({
      argv: ["--username", "root", "--allow-stdin"],
      stdin: Readable.from(["Long admin password 2026\nDifferent password 2026\n"]),
      stdout: { write() {} },
      stderr: { write() {} },
      pepper,
      withTransactionImpl: async () => { transactions += 1; }
    }),
    /不一致/
  );
  assert.equal(transactions, 0);
});

class FakeTTY extends EventEmitter {
  isTTY = true;
  rawModes = [];

  setRawMode(value) {
    this.rawModes.push(value);
  }

  resume() {}
  pause() {}
}
