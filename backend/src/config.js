import dotenv from "dotenv";
import path from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultEnvPath = path.resolve(__dirname, "../../.project-secrets/backend.env");
dotenv.config({ path: process.env.ENV_FILE || defaultEnvPath });
if (process.env.NODE_ENV !== "test") dotenv.config();
const nodeEnv = enumValue("NODE_ENV", "development", ["development", "test", "production"]);

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

const KNOWN_WEAK_SECRETS = new Set([
  "dev-only-change-before-beta",
  "dev-only-email-code-secret"
]);

// Security-critical secrets must always be provided explicitly. We never fall
// back to a default. The previous behavior silently used a weak key whenever
// NODE_ENV !== "production" (e.g. when NODE_ENV was simply unset on the
// server), which meant tokens/codes could be signed with a publicly known key.
function requiredSecret(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  if (KNOWN_WEAK_SECRETS.has(value) || (nodeEnv === "production" && /^(replace|changeme|synthetic|test[-_])/i.test(value))) {
    throw new Error(`Environment variable ${name} uses a known insecure default; set a strong random value (e.g. \`openssl rand -base64 48\`)`);
  }
  if (value.length < 32) {
    if (nodeEnv === "production") throw new Error(`${name} must contain at least 32 characters in production`);
    console.warn(`[config] ${name} is shorter than 32 characters; use a longer random secret in production`);
  }
  return value;
}

function enumValue(name, fallback, allowedValues) {
  const value = process.env[name] || fallback;
  if (!allowedValues.includes(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function integer(name, fallback, min = 1, max = 1000000) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) {
    throw new Error(`Invalid ${name}: expected an integer from ${min} to ${max}`);
  }
  return Number(raw);
}

function trustProxy() {
  const raw = process.env.TRUST_PROXY || "false";
  if (raw === "false") return false;
  if (/^[1-5]$/.test(raw)) return Number(raw);
  const entries = raw.split(",").map(value => value.trim());
  for (const entry of entries) {
    if (["loopback", "linklocal", "uniquelocal"].includes(entry)) continue;
    const [address, mask, extra] = entry.split("/");
    const version = isIP(address);
    if (!version || extra || (mask !== undefined && (!/^\d+$/.test(mask) || Number(mask) < 1 || Number(mask) > (version === 4 ? 32 : 128)))) {
      throw new Error("TRUST_PROXY must specify trusted proxy addresses, a bounded hop count, or false");
    }
  }
  return entries;
}

function positiveFiniteInteger(name, fallback) { return integer(name, fallback); }
function nonNegativeFiniteNumber(name, fallback = 0) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid " + name);
  return value;
}
export const config = {
  nodeEnv,
  trustProxy: trustProxy(),
  port: integer("PORT", 8080, 1, 65535),
  publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL || `http://localhost:${process.env.PORT || 8080}/api`,
  publicAssetBaseUrl: process.env.PUBLIC_ASSET_BASE_URL || process.env.CDN_ASSET_BASE_URL || "",
  jwtSecret: requiredSecret("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "30d",
  databaseUrl: process.env.DATABASE_URL,
  db: {
    max: integer("DB_POOL_MAX", 10, 1, 100),
    connectionTimeoutMillis: integer("DB_CONNECT_TIMEOUT_MS", 5000, 100, 30000),
    query_timeout: integer("DB_QUERY_TIMEOUT_MS", 10000, 100, 120000),
    statement_timeout: integer("DB_STATEMENT_TIMEOUT_MS", 10000, 100, 120000),
    host: process.env.DB_HOST,
    port: integer("DB_PORT", 5432, 1, 65535),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  },
  oss: {
    bucket: required("OSS_BUCKET"),
    region: required("OSS_REGION"),
    endpoint: process.env.OSS_INTERNAL_ENDPOINT || process.env.OSS_ENDPOINT,
    publicEndpoint: process.env.OSS_ENDPOINT,
    accessKeyId: required("ALIYUN_ACCESS_KEY_ID"),
    accessKeySecret: required("ALIYUN_ACCESS_KEY_SECRET")
  },
  moderation: {
    dailyCallLimit: integer("MODERATION_DAILY_CALL_LIMIT", nodeEnv === "production" ? required("MODERATION_DAILY_CALL_LIMIT") : 1000, 0),
    provider: enumValue("MODERATION_PROVIDER", nodeEnv === "production" ? "aliyun" : "mock", ["aliyun", "mock"]),
    failMode: enumValue("MODERATION_FAIL_MODE", "review", ["review", "block"]),
    endpoint: process.env.ALIYUN_MODERATION_ENDPOINT || "https://green-cip.cn-shanghai.aliyuncs.com",
    textAgentAppId: process.env.ALIYUN_TEXT_AGENT_APP_ID || "",
    textService: process.env.ALIYUN_TEXT_MODERATION_SERVICE || "comment_detection",
    imageService: process.env.ALIYUN_IMAGE_MODERATION_SERVICE || "baselineCheck",
    adminEmails: String(process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  },
  safety: {
    enabled: String(process.env.SAFETY_CASES_ENABLED || "false").toLowerCase() === "true",
    aiMode: enumValue("SAFETY_AI_MODE", "off", ["off", "shadow", "enforce"]),
    autoActionsEnabled: String(process.env.SAFETY_AUTO_ACTIONS_ENABLED || "false").toLowerCase() === "true",
    reportAccountMax24h: positiveFiniteInteger("SAFETY_REPORT_ACCOUNT_MAX_24H", 20),
    reportIpMax24h: positiveFiniteInteger("SAFETY_REPORT_IP_MAX_24H", 60),
    reportBurstMaxMinute: positiveFiniteInteger("SAFETY_REPORT_BURST_MAX_MINUTE", 5),
    reportUploadOutstandingMax: positiveFiniteInteger("SAFETY_REPORT_UPLOAD_OUTSTANDING_MAX", 24),
    reportUploadAccountMax24h: positiveFiniteInteger("SAFETY_REPORT_UPLOAD_ACCOUNT_MAX_24H", 60),
    reportSupplementAccountMax24h: positiveFiniteInteger("SAFETY_REPORT_SUPPLEMENT_ACCOUNT_MAX_24H", 40),
    reportSupplementIpMax24h: positiveFiniteInteger("SAFETY_REPORT_SUPPLEMENT_IP_MAX_24H", 120),
    reportSupplementBurstMaxMinute: positiveFiniteInteger("SAFETY_REPORT_SUPPLEMENT_BURST_MAX_MINUTE", 10),
    contentRevisionAccountMax24h: positiveFiniteInteger("SAFETY_CONTENT_REVISION_ACCOUNT_MAX_24H", 20),
    contentRevisionIpMax24h: positiveFiniteInteger("SAFETY_CONTENT_REVISION_IP_MAX_24H", 60),
    contentRevisionBurstMaxMinute: positiveFiniteInteger("SAFETY_CONTENT_REVISION_BURST_MAX_MINUTE", 5)
  },
  safetyAi: {
    baseUrl: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: process.env.DASHSCOPE_API_KEY || "",
    model: "qwen3.7-plus-2026-05-26",
    promptVersion: "safety-case-prompt-v2",
    policyVersion: "safety-policy-v2",
    monthlyBudgetCny: nonNegativeFiniteNumber("SAFETY_AI_MONTHLY_BUDGET_CNY"),
    inputCnyPerMillion: nonNegativeFiniteNumber("SAFETY_QWEN_INPUT_CNY_PER_MILLION"),
    outputCnyPerMillion: nonNegativeFiniteNumber("SAFETY_QWEN_OUTPUT_CNY_PER_MILLION"),
    timeoutMs: positiveFiniteInteger("SAFETY_QWEN_TIMEOUT_MS", 12_000)
  },
  admin: {
    webEnabled: String(process.env.ADMIN_WEB_ENABLED || "false").toLowerCase() === "true",
    sessionCookieName: "zbt_admin_session",
    csrfCookieName: "zbt_admin_csrf",
    cookieSecure: nodeEnv === "production"
      ? true
      : String(process.env.ADMIN_COOKIE_SECURE || "false").toLowerCase() === "true",
    sessionIdleMinutes: 30,
    sessionAbsoluteHours: 8,
    challengeTtlSeconds: 120,
    deviceRequestTtlMinutes: 10,
    bootstrapTtlMinutes: 10
  },
  email: {
    provider: enumValue("EMAIL_PROVIDER", "console", ["console", "smtp", "aliyun"]),
    from: process.env.EMAIL_FROM || "",
    codeSecret: requiredSecret("EMAIL_CODE_SECRET"),
    codeTtlMinutes: integer("EMAIL_CODE_TTL_MINUTES", 10, 1, 30),
    codeResendSeconds: integer("EMAIL_CODE_RESEND_SECONDS", 60, 30, 3600),
    smtp: {
      host: process.env.SMTP_HOST || "",
      port: integer("SMTP_PORT", 465, 1, 65535),
      secure: enumValue("SMTP_SECURE", "true", ["true", "false"]) === "true",
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || ""
    }
  }
};

if (nodeEnv === "production" && config.moderation.provider !== "aliyun") {
  throw new Error("Production cannot start with mock content moderation");
}

if (nodeEnv === "production") {
  const url = new URL(config.publicApiBaseUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Production PUBLIC_API_BASE_URL must be HTTPS");
  if (!["smtp", "aliyun"].includes(config.email.provider) || !config.email.smtp.host || !config.email.smtp.user || !config.email.smtp.pass || !config.email.from) {
    throw new Error("Production requires a configured SMTP delivery service");
  }
}
