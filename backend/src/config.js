import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultEnvPath = path.resolve(__dirname, "../../.project-secrets/backend.env");

dotenv.config({ path: process.env.ENV_FILE || defaultEnvPath });
dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 8080),
  publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL || `http://localhost:${process.env.PORT || 8080}`,
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-before-beta",
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
  email: {
    provider: process.env.EMAIL_PROVIDER || "console",
    from: process.env.EMAIL_FROM || "",
    codeSecret: process.env.EMAIL_CODE_SECRET || process.env.JWT_SECRET || "dev-only-email-code-secret",
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
