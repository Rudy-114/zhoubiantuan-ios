// Test runs never borrow credentials or a database from the developer's env.
Object.assign(process.env, {
  NODE_ENV: 'test', ENV_FILE: '/dev/null',
  JWT_SECRET: 'synthetic-jwt-key-for-isolated-tests-only',
  EMAIL_CODE_SECRET: 'synthetic-email-code-key-for-isolated-tests',
  OSS_BUCKET: 'test-bucket', OSS_REGION: 'cn-shanghai',
  OSS_ENDPOINT: 'https://oss-cn-shanghai.aliyuncs.com',
  ALIYUN_ACCESS_KEY_ID: 'test-key', ALIYUN_ACCESS_KEY_SECRET: 'test-secret',
  MODERATION_PROVIDER: 'mock', MODERATION_FAIL_MODE: 'review', MODERATION_DAILY_CALL_LIMIT: '1000',
  EMAIL_PROVIDER: 'console', EMAIL_CODE_TTL_MINUTES: '10', EMAIL_CODE_RESEND_SECONDS: '60',
  SMTP_SECURE: 'true', SMTP_PORT: '465', TRUST_PROXY: 'false',
  DB_POOL_MAX: '10', DB_CONNECT_TIMEOUT_MS: '5000', DB_QUERY_TIMEOUT_MS: '10000', DB_STATEMENT_TIMEOUT_MS: '10000', DB_PORT: '5432',
  PUBLIC_API_BASE_URL: 'http://127.0.0.1:18081/api', PUBLIC_ASSET_BASE_URL: '', CDN_ASSET_BASE_URL: '',
  DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://127.0.0.1:1/zbt_test_disabled'
});
for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'OSS_INTERNAL_ENDPOINT',
  'ALIYUN_TEXT_AGENT_APP_ID', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'ADMIN_EMAILS']) delete process.env[key];
