import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultEnvPath = path.resolve(__dirname, "../../.project-secrets/backend.env");
const nodeEnv = process.env.NODE_ENV || "development";

dotenv.config({ path: process.env.ENV_FILE || defaultEnvPath });
dotenv.config();

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
  if (KNOWN_WEAK_SECRETS.has(value)) {
    throw new Error(`Environment variable ${name} uses a known insecure default; set a strong random value (e.g. \`openssl rand -base64 48\`)`);
  }
  if (value.length < 32) {
    console.warn(`[config] ${name} is shorter than 32 characters; use a longer random secret in production`);
  }
  return value;
}

function enumValue(name, fallback, allowedValues) {
  const value = process.env[name] || fallback;
  return allowedValues.includes(value) ? value : fallback;
}

function positiveFiniteInteger(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  nodeEnv,
  port: Number(process.env.PORT || 8080),
  publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL || `http://localhost:${process.env.PORT || 8080}/api`,
  publicAssetBaseUrl: process.env.PUBLIC_ASSET_BASE_URL || process.env.CDN_ASSET_BASE_URL || "",
  jwtSecret: requiredSecret("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "30d",
  databaseUrl: process.env.DATABASE_URL,
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
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
    provider: process.env.MODERATION_PROVIDER || (process.env.NODE_ENV === "production" ? "aliyun" : "mock"),
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
  admin: {
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
    provider: process.env.EMAIL_PROVIDER || "console",
    from: process.env.EMAIL_FROM || "",
    codeSecret: requiredSecret("EMAIL_CODE_SECRET"),
    codeTtlMinutes: Number(process.env.EMAIL_CODE_TTL_MINUTES || 10),
    codeResendSeconds: Number(process.env.EMAIL_CODE_RESEND_SECONDS || 60),
    smtp: {
      host: process.env.SMTP_HOST || "",
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE || "true").toLowerCase() !== "false",
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || ""
    }
  }
};
