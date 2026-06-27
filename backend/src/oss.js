import OSS from "ali-oss";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "./config.js";

const client = new OSS({
  region: config.oss.region,
  endpoint: config.oss.endpoint,
  bucket: config.oss.bucket,
  accessKeyId: config.oss.accessKeyId,
  accessKeySecret: config.oss.accessKeySecret,
  secure: true
});

const readClient = new OSS({
  region: config.oss.region,
  endpoint: config.oss.publicEndpoint || config.oss.endpoint,
  bucket: config.oss.bucket,
  accessKeyId: config.oss.accessKeyId,
  accessKeySecret: config.oss.accessKeySecret,
  secure: true
});

export function signedReadUrl(objectKey, expires = 900) {
  if (!objectKey) return "";
  return readClient.signatureUrl(objectKey, { expires, method: "GET" });
}

export function publicAssetUrl(objectKey) {
  if (!objectKey) return "";
  const baseURL = (config.publicAssetBaseUrl || config.publicApiBaseUrl).replace(/\/+$/, "");
  const encodedPath = String(objectKey)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const proxyPrefix = config.publicAssetBaseUrl ? "" : "/assets";
  return `${baseURL}${proxyPrefix}/${encodedPath}`;
}

export function createUploadTarget({ userId, kind, filename, contentType }) {
  const ext = extensionFor(filename, contentType);
  const safeKind = ["post", "avatar", "background", "message"].includes(kind) ? kind : "post";
  const objectKey = `${safeKind}/${userId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;
  const uploadUrl = readClient.signatureUrl(objectKey, {
    expires: 900,
    method: "PUT",
    "Content-Type": contentType || "application/octet-stream"
  });
  return {
    objectKey,
    uploadUrl,
    expiresIn: 900,
    readUrl: signedReadUrl(objectKey)
  };
}

export async function deleteObjects(objectKeys = []) {
  const keys = (Array.isArray(objectKeys) ? objectKeys : []).filter(
    (key) => typeof key === "string" && key.length > 0
  );
  if (!keys.length) return { deleted: 0 };
  let deleted = 0;
  for (const key of keys) {
    try {
      await client.delete(key);
      deleted += 1;
    } catch {
      // Best-effort cleanup: orphaned objects can be swept later. Never let OSS
      // availability block account deletion.
    }
  }
  return { deleted };
}

function extensionFor(filename, contentType) {
  const fromName = path.extname(String(filename || "")).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  return ".jpg";
}
