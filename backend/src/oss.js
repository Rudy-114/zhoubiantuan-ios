import OSS from "ali-oss";
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
  return publicAssetUrlForBase(objectKey, {
    publicApiBaseUrl: config.publicApiBaseUrl,
    // Every app-visible URL rechecks visibility, including previously public posts.
    publicAssetBaseUrl: ""
  });
}

export const objectStorage = {
  async putImage(key, data) {
    await client.put(key, data, { mime: "image/jpeg", headers: {
      "x-oss-object-acl": "private", "x-oss-forbid-overwrite": "true",
      "Cache-Control": "private, no-store"
    } });
  },
  async readImage(key) {
    return fetch(signedReadUrl(key, 60), { signal: AbortSignal.timeout(15000), redirect: "error" });
  },
  async removeImage(key) { await client.delete(key); }
};

export function publicAssetUrlForBase(objectKey, { publicApiBaseUrl, publicAssetBaseUrl }) {
  if (!objectKey) return "";
  const baseURL = (publicAssetBaseUrl || publicApiBaseUrl).replace(/\/+$/, "");
  const encodedPath = String(objectKey)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const proxyPrefix = publicAssetBaseUrl ? "" : "/assets";
  return `${baseURL}${proxyPrefix}/${encodedPath}`;
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
