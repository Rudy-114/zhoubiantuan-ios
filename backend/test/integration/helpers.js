import fs from 'node:fs/promises';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { pool, query, withTransaction } from '../../src/db.js';
import { createApp } from '../../src/app.js';
import { signToken } from '../../src/auth.js';
import { config } from '../../src/config.js';

export { pool, query, withTransaction };
export function id(prefix = 'test') { return `${prefix}-${randomUUID()}`; }

export async function startTestApp(options = {}) {
  const target = new URL(process.env.TEST_DATABASE_URL || 'postgres://127.0.0.1/disabled');
  if (!target.pathname.startsWith('/zbt_test')) throw new Error('Set TEST_DATABASE_URL to a disposable zbt_test* database');
  const sqlDir = new URL('../../sql/', import.meta.url);
  for (const file of (await fs.readdir(sqlDir)).filter(f => f.endsWith('.sql')).sort()) {
    await withTransaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('zbt:schema-migrations', 0))");
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [file])).rows.length) return;
      await client.query(await fs.readFile(new URL(file, sqlDir), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
    });
  }
  const app = createApp(options);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    app, base,
    request: (path, { token, body, method = 'GET' } = {}) => fetch(`${base}${path}`, {
      method, signal: AbortSignal.timeout(15000),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    }),
    close: async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); }
  };
}

export async function makeUser({ verified = true, role = 'user' } = {}) {
  const userId = id('u');
  const email = `${userId}@example.test`;
  const { rows } = await query('INSERT INTO users(id,email,nickname,moderation_role) VALUES($1,$2,$3,$4) RETURNING *',
    [userId, email, userId, role]);
  await query(`INSERT INTO auth_identities(id,user_id,provider,provider_subject,email,email_verified)
    VALUES($1,$2,'email',$3,$3,$4)`, [id('ident'), userId, email, verified]);
  return { ...rows[0], token: signToken(rows[0]) };
}

export async function makeCode(user, { code = '123456', purpose = 'login', createdAt = new Date() } = {}) {
  const codeId = id('evc');
  const hash = createHash('sha256').update(`${user.email}:${purpose}:${code}:${config.email.codeSecret}`).digest('hex');
  await query(`INSERT INTO email_verification_codes(id,email,purpose,code_hash,created_at,expires_at)
    VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`, [codeId, user.email, purpose, hash, createdAt]);
  return codeId;
}
