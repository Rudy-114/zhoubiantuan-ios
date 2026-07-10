import assert from "node:assert/strict";
import { pool } from "../../src/db.js";

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function resetDatabase() {
  const { rows } = await pool.query("SELECT current_database() AS name, inet_server_addr()::text AS host");
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
