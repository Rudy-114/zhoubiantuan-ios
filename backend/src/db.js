import pg from "pg";
import { config } from "./config.js";
import { logger } from "./logger.js";

const { Pool } = pg;

export const pool = new Pool({
  max: config.db.max,
  connectionTimeoutMillis: config.db.connectionTimeoutMillis,
  query_timeout: config.db.query_timeout,
  statement_timeout: config.db.statement_timeout,
  ...(config.db.host ? {
        host: config.db.host,
        port: config.db.port,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password
      }
    : { connectionString: config.databaseUrl })
});
pool.on("error", (error) => logger.error("database.idle_connection_error", { error }));

export async function query(text, params = []) {
  return pool.query(text, params);
}

const commitOperations = new WeakMap();
// Reserve sync IDs only once the callback has released all business work.
// The operation may fill a result object retained by the caller before COMMIT.
export function beforeCommit(client, operation) {
  const queue = commitOperations.get(client);
  if (!queue) return false;
  queue.push(operation);
  return true;
}

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    commitOperations.set(client, []);
    const result = await callback(client);
    for (const operation of commitOperations.get(client)) await operation();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    commitOperations.delete(client);
    client.release();
  }
}
