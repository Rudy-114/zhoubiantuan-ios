import { createHash } from "node:crypto";
import { badRequest } from "./validators.js";

export function requestHash(body) {
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  }
  return createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex");
}

export function assertPostReplay(post, userId, hash) {
  if (post.author_id !== userId || post.submission_hash !== hash || post.status === "deleted") {
    const error = badRequest("这次发布的内容已发生变化，请保留草稿并刷新后重试", "submission_conflict");
    error.status = 409;
    throw error;
  }
  return post;
}
