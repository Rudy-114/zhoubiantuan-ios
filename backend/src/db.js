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

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
