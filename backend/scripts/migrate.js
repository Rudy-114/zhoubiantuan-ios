import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, withTransaction } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.resolve(__dirname, "../sql");

try {
  const files = (await fs.readdir(sqlDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('zbt:schema-migrations', 0))");
      await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      const seen = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
      if (seen.rows[0]) {
        console.log(`skip ${file}`);
        return;
      }
      const sql = await fs.readFile(path.join(sqlDir, file), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      console.log(`applied ${file}`);
    });
  }
} finally {
  await pool.end();
}
