import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.resolve(__dirname, "../../sql");
const localHosts = [null, "127.0.0.1", "::1"];
const loopbackHosts = new Set(["127.0.0.1", "::1"]);
let migrationDatabaseCounter = 0;
const safeDatabaseOptions = assertSafeMigrationTestEnvironment(process.env);
const pool = new Pool(connectionOptions(safeDatabaseOptions.database));

export { pool };

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function assertSafeMigrationTestEnvironment(environment) {
  assert.equal(environment.NODE_ENV, "test", "migration database helpers require NODE_ENV=test");
  assert.ok(environment.DATABASE_URL, "migration database helpers require DATABASE_URL");
  assert.ok(!environment.DB_HOST, "DB_HOST must be unset for migration database tests");

  let databaseUrl;
  try {
    databaseUrl = new URL(environment.DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL must be a valid URL");
  }

  assert.ok(["postgres:", "postgresql:"].includes(databaseUrl.protocol), "DATABASE_URL must use PostgreSQL");
  assert.equal(databaseUrl.search, "", "DATABASE_URL must not include query parameters or fragments");
  assert.equal(databaseUrl.hash, "", "DATABASE_URL must not include query parameters or fragments");

  const databaseName = decodeURIComponent(databaseUrl.pathname).replace(/^\/+/, "");
  assert.match(databaseName, /^zbt_safety_test_/, "DATABASE_URL must target a zbt_safety_test_ database");
  const hostname = databaseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  assert.ok(loopbackHosts.has(hostname), `DATABASE_URL must use a loopback host, received ${databaseUrl.hostname}`);
  const port = Number(databaseUrl.port || 5432);
  assert.ok(Number.isInteger(port) && port >= 1 && port <= 65535, "DATABASE_URL must use a port from 1 to 65535");

  const options = { host: hostname, port, database: databaseName };
  if (databaseUrl.username) options.user = decodeURIComponent(databaseUrl.username);
  if (databaseUrl.password) options.password = decodeURIComponent(databaseUrl.password);
  return options;
}

export async function resetDatabase() {
  const { rows } = await pool.query("SELECT current_database() AS name, host(inet_server_addr()) AS host");
  assert.match(rows[0].name, /^zbt_safety_test_/);
  assert.ok([null, "127.0.0.1", "::1"].includes(rows[0].host), `refusing non-local test database host ${rows[0].host}`);
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'");
  for (const { tablename } of tables.rows) {
    await pool.query(`TRUNCATE TABLE ${quoteIdentifier(tablename)} RESTART IDENTITY CASCADE`);
  }
}

export async function closeDatabase() {
  await pool.end();
}

export async function withMigrationDatabase(callback) {
  const { rows } = await pool.query(
    "SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port"
  );
  const baseDatabase = rows[0];
  assert.match(baseDatabase.name, /^zbt_safety_test_/);
  assert.ok(localHosts.includes(baseDatabase.host), `refusing non-local test database host ${baseDatabase.host}`);

  const databaseName = `zbt_safety_test_migration_${process.pid}_${migrationDatabaseCounter++}`;
  const adminPool = new Pool(connectionOptions("postgres"));
  let migrationPool;
  let databaseCreated = false;

  try {
    const admin = await adminPool.query("SELECT host(inet_server_addr()) AS host, inet_server_port() AS port");
    assert.ok(localHosts.includes(admin.rows[0].host), `refusing non-local admin database host ${admin.rows[0].host}`);
    assert.equal(Number(admin.rows[0].port), Number(baseDatabase.port), "refusing a different PostgreSQL cluster");

    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    databaseCreated = true;
    migrationPool = new Pool(connectionOptions(databaseName));
    await applyMigrationsThrough(migrationPool, "012_report_dedup.sql");

    return await callback({
      pool: migrationPool,
      applyMigration: (file) => applyMigration(migrationPool, file),
      applyDownMigration: (file) => applyDownMigration(migrationPool, file)
    });
  } finally {
    try {
      if (migrationPool) await migrationPool.end();
    } finally {
      try {
        if (databaseCreated) {
          await adminPool.query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
            [databaseName]
          );
          await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
        }
      } finally {
        await adminPool.end();
      }
    }
  }
}

function connectionOptions(database) {
  return { ...safeDatabaseOptions, database };
}

async function applyMigrationsThrough(migrationPool, lastFile) {
  const files = (await fs.readdir(sqlDir))
    .filter((file) => file.endsWith(".sql") && file <= lastFile)
    .sort();
  for (const file of files) {
    await applyMigration(migrationPool, file);
  }
}

async function applyMigration(migrationPool, file) {
  const sql = await readMigration(sqlDir, file);
  return withMigrationTransaction(migrationPool, async (client) => {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const seen = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
    if (seen.rows[0]) return false;
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
    return true;
  });
}

async function applyDownMigration(migrationPool, file) {
  const sql = await readMigration(path.join(sqlDir, "down"), file);
  return withMigrationTransaction(migrationPool, async (client) => {
    await client.query(sql);
    await client.query("DELETE FROM schema_migrations WHERE version = $1", [file]);
  });
}

async function readMigration(directory, file) {
  assert.match(file, /^\d{3}_[a-z0-9_]+\.sql$/, "invalid migration filename");
  return fs.readFile(path.join(directory, file), "utf8");
}

async function withMigrationTransaction(migrationPool, callback) {
  const client = await migrationPool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
