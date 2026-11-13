import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";
import { config } from "../src/config.js";
import { pool, withTransaction } from "../src/db.js";
import {
  assertRecoveryPepper,
  generateBootstrapCode,
  generateRecoveryCodes,
  hashBootstrapCode,
  hashRecoveryCode
} from "../src/admin/recoveryCodes.js";

const PASSWORD_COST = 12;

export async function runCreateAdmin({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  pepper = process.env.ADMIN_RECOVERY_PEPPER,
  now = new Date(),
  withTransactionImpl = withTransaction
} = {}) {
  const options = parseCreateAdminArguments(argv);
  const secret = assertRecoveryPepper(pepper);
  let password = "";
  let confirmation = "";
  let bootstrapCode = "";
  let recoveryCodes = [];

  try {
    [password, confirmation] = await readPasswordPair({
      stdin,
      output: stderr,
      allowStdin: options.allowStdin
    });
    validatePassword(password, confirmation);
    const passwordHash = await bcrypt.hash(password, PASSWORD_COST);
    password = "";
    confirmation = "";

    bootstrapCode = generateBootstrapCode();
    recoveryCodes = generateRecoveryCodes(10);
    const adminUserId = `admin-${randomUUID()}`;
    const bootstrapId = `aboot-${randomUUID()}`;
    const expiresAt = new Date(now.getTime() + config.admin.bootstrapTtlMinutes * 60 * 1000);
    const recoveryHashes = recoveryCodes.map((code) => hashRecoveryCode(code, secret));
    const bootstrapHash = hashBootstrapCode(bootstrapCode, secret);

    await withTransactionImpl(async (client) => {
      if (!client || typeof client.query !== "function") {
        throw new TypeError("Admin bootstrap requires a transaction client");
      }
      await client.query("LOCK TABLE admin_users IN EXCLUSIVE MODE");
      const created = await client.query(
        `INSERT INTO admin_users (id, username, username_normalized, password_hash)
         SELECT $1, $2, $3, $4
         WHERE NOT EXISTS (SELECT 1 FROM admin_users)
         RETURNING id`,
        [adminUserId, options.username, options.usernameNormalized, passwordHash]
      );
      if (!created.rows[0]) throw safeError("管理员已存在，拒绝创建第二个管理员");
      await client.query(
        `INSERT INTO admin_recovery_codes (admin_user_id, code_hash)
         SELECT $1, code_hash FROM unnest($2::text[]) AS codes(code_hash)`,
        [adminUserId, recoveryHashes]
      );
      await client.query(
        `INSERT INTO admin_bootstrap_codes (id, admin_user_id, code_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [bootstrapId, adminUserId, bootstrapHash, expiresAt]
      );
    });

    stdout.write(formatOneTimeOutput({
      username: options.username,
      expiresAt,
      bootstrapCode,
      recoveryCodes
    }));
  } finally {
    password = "";
    confirmation = "";
    bootstrapCode = "";
    recoveryCodes.fill("");
    recoveryCodes = [];
  }
}

export function parseCreateAdminArguments(argv) {
  if (!Array.isArray(argv)) throw safeError("参数无效");
  let username;
  let allowStdin = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-stdin" && !allowStdin) {
      allowStdin = true;
    } else if (argument === "--username" && username === undefined) {
      username = argv[index + 1];
      index += 1;
    } else {
      throw safeError("用法：admin:create -- --username <name> [--allow-stdin]");
    }
  }
  const normalized = normalizedUsername(username);
  return { ...normalized, allowStdin };
}

export async function readPasswordPair({ stdin, output, allowStdin }) {
  if (stdin?.isTTY) {
    const password = await readHiddenLine({ stdin, output, prompt: "管理员密码：" });
    const confirmation = await readHiddenLine({ stdin, output, prompt: "再次输入密码：" });
    return [password, confirmation];
  }
  if (!allowStdin) {
    throw safeError("拒绝从管道读取密码；自动化测试必须显式传入 --allow-stdin");
  }
  const lines = [];
  const reader = createInterface({ input: stdin, crlfDelay: Infinity, terminal: false });
  try {
    for await (const line of reader) {
      lines.push(line);
      if (lines.length > 2) break;
    }
  } finally {
    reader.close();
  }
  if (lines.length !== 2) throw safeError("标准输入必须恰好包含两行密码");
  return lines;
}

export function readHiddenLine({ stdin, output, prompt }) {
  if (!stdin?.isTTY || typeof stdin.setRawMode !== "function") {
    return Promise.reject(safeError("隐藏密码输入需要 TTY"));
  }
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf8");
    const characters = [];
    let settled = false;
    let rawModeEnabled = false;

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      if (rawModeEnabled) stdin.setRawMode(false);
      stdin.pause();
      output.write("\n");
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(characters.join(""));
    };
    const onEnd = () => finish(safeError("密码输入意外结束"));
    const onData = (chunk) => {
      for (const character of decoder.write(chunk)) {
        if (character === "\u0003") return finish(safeError("已取消管理员创建"));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") {
          characters.pop();
          continue;
        }
        if (/^[\u0000-\u001f]$/u.test(character)) {
          return finish(safeError("密码包含不支持的控制字符"));
        }
        if (characters.length >= 256) return finish(safeError("密码过长"));
        characters.push(character);
      }
    };

    try {
      output.write(prompt);
      stdin.setRawMode(true);
      rawModeEnabled = true;
      stdin.on("data", onData);
      stdin.once("end", onEnd);
      stdin.resume();
    } catch {
      finish(safeError("无法启用隐藏密码输入"));
    }
  });
}

function normalizedUsername(value) {
  if (typeof value !== "string") throw safeError("必须通过 --username 提供管理员名");
  const username = value.trim().normalize("NFKC");
  const usernameNormalized = username.toLowerCase();
  if (!username || Array.from(username).length > 64 ||
      Array.from(usernameNormalized).length > 64 || /[\u0000-\u001f\u007f]/u.test(username)) {
    throw safeError("管理员名无效");
  }
  if (username.startsWith("-") || !/^[\p{L}\p{N}._-]+$/u.test(username)) {
    throw safeError("管理员名只能包含字母、数字、点、下划线或连字符");
  }
  return { username, usernameNormalized };
}

function validatePassword(password, confirmation) {
  if (password !== confirmation) throw safeError("两次输入的密码不一致");
  if (typeof password !== "string" || Array.from(password).length < 14 ||
      Array.from(password).length > 256 || /[\u0000-\u001f\u007f]/u.test(password)) {
    throw safeError("管理员密码必须为 14 至 256 个字符且不能包含控制字符");
  }
}

function formatOneTimeOutput({ username, expiresAt, bootstrapCode, recoveryCodes }) {
  return [
    `管理员：${username}`,
    `引导码有效期：${expiresAt.toISOString()}`,
    `引导码：${bootstrapCode}`,
    ...recoveryCodes.map((code, index) => `恢复码 ${index + 1}：${code}`),
    "以上一次性材料不会再次显示，请立即离线保存。",
    ""
  ].join("\n");
}

function safeError(message) {
  const error = new Error(message);
  error.safeToDisplay = true;
  return error;
}

async function main() {
  try {
    await runCreateAdmin();
  } catch (error) {
    const message = error?.safeToDisplay ? error.message : "管理员创建失败";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
