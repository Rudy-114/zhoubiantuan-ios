// Test runs never borrow credentials or a database from the developer's env.
Object.assign(process.env, {
  NODE_ENV: 'test', ENV_FILE: '/dev/null',
  JWT_SECRET: 'synthetic-jwt-key-for-isolated-tests-only',
  EMAIL_CODE_SECRET: 'synthetic-email-code-key-for-isolated-tests',
  OSS_BUCKET: 'test-bucket', OSS_REGION: 'cn-shanghai',
  OSS_ENDPOINT: 'https://oss-cn-shanghai.aliyuncs.com',
  ALIYUN_ACCESS_KEY_ID: 'test-key', ALIYUN_ACCESS_KEY_SECRET: 'test-secret',
  MODERATION_PROVIDER: 'mock', EMAIL_PROVIDER: 'console',
  PUBLIC_API_BASE_URL: 'http://127.0.0.1:18081/api', PUBLIC_ASSET_BASE_URL: '', CDN_ASSET_BASE_URL: '',
  DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://127.0.0.1:1/zbt_test_disabled'
});
for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'OSS_INTERNAL_ENDPOINT',
  'ALIYUN_TEXT_AGENT_APP_ID', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'ADMIN_EMAILS']) delete process.env[key];
