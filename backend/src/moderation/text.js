import { arrayOfStrings } from "../validators.js";

export function moderationText(fields, options = {}) {
  if (typeof fields === "string") return fields;
  const omitKeys = new Set(options.omitKeys || []);
  return Object.entries(fields || {})
    .filter(([key]) => !omitKeys.has(key))
    .flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => `${key}: ${JSON.stringify(item)}`) : [`${key}: ${value ?? ""}`])
    .join("\n")
    .slice(0, 6000);
}

export function publicContentModerationText(fields) {
  return moderationText(fields);
}

export function postModerationSnapshot(body, collection, title) {
  return {
    title,
    categoryTags: arrayOfStrings(body.categoryTags),
    fandomTags: arrayOfStrings(body.fandomTags),
    price: String(body.price || "").trim(),
    deposit: String(body.deposit || "").trim(),
    condition: String(body.condition || "").trim(),
    description: String(body.description || "").trim(),
    wechat: String(body.wechat ?? collection?.contact_wechat ?? "").trim(),
    qq: String(body.qq ?? collection?.contact_qq ?? "").trim(),
    groupNumber: String(body.groupNumber ?? collection?.contact_group_number ?? "").trim(),
    groupInfo: String(body.groupInfo ?? collection?.group_info ?? "").trim(),
    externalLink: String(body.externalLink || "").trim(),
    pingguAveragePrice: String(body.pingguAveragePrice || "").trim(),
    pingguNote: String(body.pingguNote || "").trim(),
    unsoldRoles: Array.isArray(body.unsoldRoles) ? body.unsoldRoles : []
  };
}
