import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const valid = { NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(48), EMAIL_CODE_SECRET: 'b'.repeat(48),
  MODERATION_PROVIDER: 'aliyun', MODERATION_DAILY_CALL_LIMIT: '100', EMAIL_PROVIDER: 'smtp',
  SMTP_HOST: 'smtp.example.test', SMTP_USER: 'test-account', SMTP_PASS: 'synthetic-smtp-pass',
  EMAIL_FROM: 'sender@example.test', PUBLIC_API_BASE_URL: 'https://api.example.test/api' };
function run(overrides) {
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    `await import('./test/setup.js'); Object.assign(process.env, ${JSON.stringify({ ...valid, ...overrides })}); await import('./src/config.js');`],
  { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
}
test('production rejects misspelled modes, invalid limits, unsafe proxy and incomplete services', () => {
  assert.equal(run({}).status, 0);
  for (const [name, value] of Object.entries({ NODE_ENV: 'prodution', MODERATION_PROVIDER: 'mok',
    MODERATION_DAILY_CALL_LIMIT: '-1', DB_POOL_MAX: '0', DB_QUERY_TIMEOUT_MS: 'NaN', TRUST_PROXY: 'true',
    SMTP_SECURE: 'yes', EMAIL_PROVIDER: 'console', SMTP_HOST: '', JWT_SECRET: 'replace-with-a-long-random-string',
    PUBLIC_API_BASE_URL: 'http://api.example.test/api' })) {
    const result = run({ [name]: value });
    assert.notEqual(result.status, 0, name);
  }
  assert.equal(run({ TRUST_PROXY: 'loopback', MODERATION_DAILY_CALL_LIMIT: '0' }).status, 0);
});
