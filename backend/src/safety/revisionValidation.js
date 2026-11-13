import { assertOwnedObjectKeys } from "../moderation/index.js";
import { badRequest, trimmedString } from "../validators.js";

const MAX_TITLE_LENGTH = 200;
const MAX_COLLECTION_NAME_LENGTH = 200;
const MAX_COMPACT_TEXT_LENGTH = 256;
const MAX_LONG_TEXT_LENGTH = 5000;
const MAX_EXTERNAL_LINK_LENGTH = 2048;
const MAX_ARRAY_ITEM_LENGTH = 160;
const MAX_OBJECT_KEY_LENGTH = 1024;
const MAX_POST_IMAGE_ITEMS = 16;
const MAX_POST_TAGS = 32;
const MAX_UNSOLD_ROLES = 100;
const MAX_ROLE_QUANTITY = 100000;
const MAX_ROLE_PRICE_ADJUSTMENT = 1000000;
const SINGLE_LINE_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const MULTILINE_UNSAFE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const POST_FIELDS = new Set([
  "title",
  "imageNames",
  "imageObjectKeys",
  "previewImageObjectKeys",
  "groupType",
  "categoryTags",
  "fandomTags",
  "price",
  "deposit",
  "condition",
  "isFormed",
  "description",
  "externalLink",
  "imageAspect",
  "pingguAveragePrice",
  "pingguNote",
  "unsoldRoles"
]);

const COLLECTION_FIELDS = new Set([
  "name",
  "contactWechat",
  "contactQQ",
  "contactGroupNumber",
  "groupInfo",
  "deadline",
  "defaultNote",
  "deadlineConfirmed"
]);

const ROLE_FIELDS = new Set(["id", "name", "quantity", "priceAdjustment"]);

export function postRevisionSnapshot(_client, _targetId, ownerId, snapshot) {
  assertSnapshotObject(snapshot);
  assertAllowedFields(snapshot, POST_FIELDS, "整改内容");

  const title = normalizedString(snapshot.title, "标题", MAX_TITLE_LENGTH, { required: true });
  const imageNames = normalizedStringArray(snapshot.imageNames, "图片名称", {
    maxItems: MAX_POST_IMAGE_ITEMS,
    maxItemLength: MAX_ARRAY_ITEM_LENGTH,
    deduplicate: true
  });
  const imageObjectKeys = normalizedOwnedObjectKeys(
    ownerId,
    snapshot.imageObjectKeys,
    "图片对象",
    MAX_POST_IMAGE_ITEMS
  );
  const previewImageObjectKeys = normalizedOwnedObjectKeys(
    ownerId,
    snapshot.previewImageObjectKeys,
    "预览图片对象",
    MAX_POST_IMAGE_ITEMS
  );

  return {
    title,
    imageNames,
    imageObjectKeys,
    previewImageObjectKeys,
    groupType: normalizedGroupType(snapshot.groupType),
    categoryTags: normalizedStringArray(snapshot.categoryTags, "分类标签", {
      maxItems: MAX_POST_TAGS,
      maxItemLength: MAX_ARRAY_ITEM_LENGTH,
      deduplicate: true
    }),
    fandomTags: normalizedStringArray(snapshot.fandomTags, "作品标签", {
      maxItems: MAX_POST_TAGS,
      maxItemLength: MAX_ARRAY_ITEM_LENGTH,
      deduplicate: true
    }),
    price: normalizedString(snapshot.price, "价格", MAX_COMPACT_TEXT_LENGTH),
    deposit: normalizedString(snapshot.deposit, "定金", MAX_COMPACT_TEXT_LENGTH),
    condition: normalizedString(snapshot.condition, "成团条件", MAX_COMPACT_TEXT_LENGTH),
    isFormed: normalizedBoolean(snapshot.isFormed, "成团状态"),
    description: normalizedString(snapshot.description, "说明", MAX_LONG_TEXT_LENGTH, { allowMultiline: true }),
    externalLink: normalizedString(snapshot.externalLink, "外部链接", MAX_EXTERNAL_LINK_LENGTH),
    imageAspect: normalizedImageAspect(snapshot.imageAspect),
    pingguAveragePrice: normalizedString(snapshot.pingguAveragePrice, "拼谷均价", MAX_COMPACT_TEXT_LENGTH),
    pingguNote: normalizedString(snapshot.pingguNote, "拼谷说明", MAX_LONG_TEXT_LENGTH, { allowMultiline: true }),
    unsoldRoles: normalizedUnsoldRoles(snapshot.unsoldRoles)
  };
}

export function collectionRevisionSnapshot(_client, _targetId, _ownerId, snapshot) {
  assertSnapshotObject(snapshot);
  assertAllowedFields(snapshot, COLLECTION_FIELDS, "整改内容");
  if (Object.hasOwn(snapshot, "deadlineConfirmed") && typeof snapshot.deadlineConfirmed !== "boolean") {
    throw badRequest("截团时间确认状态必须是布尔值");
  }

  const normalized = {
    name: normalizedString(snapshot.name, "合集名称", MAX_COLLECTION_NAME_LENGTH, { required: true }),
    contactWechat: normalizedString(snapshot.contactWechat, "微信", MAX_COMPACT_TEXT_LENGTH),
    contactQQ: normalizedString(snapshot.contactQQ, "QQ", MAX_COMPACT_TEXT_LENGTH),
    contactGroupNumber: normalizedString(snapshot.contactGroupNumber, "QQ群号", MAX_COMPACT_TEXT_LENGTH),
    groupInfo: normalizedString(snapshot.groupInfo, "拉群说明", MAX_LONG_TEXT_LENGTH, { allowMultiline: true }),
    deadline: normalizedDeadline(snapshot.deadline, snapshot.deadlineConfirmed === true),
    defaultNote: normalizedString(snapshot.defaultNote, "默认说明", MAX_LONG_TEXT_LENGTH, {
      required: true,
      allowMultiline: true
    })
  };

  if (!normalized.contactWechat && !normalized.contactQQ && !normalized.contactGroupNumber) {
    throw badRequest("微信、QQ、QQ群号至少填写一个");
  }
  return normalized;
}

function assertSnapshotObject(snapshot) {
  if (!isPlainObject(snapshot)) throw badRequest("整改内容必须是对象");
}

function assertAllowedFields(value, allowedFields, label) {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) throw badRequest(`${label}包含不支持的字段: ${field}`);
  }
}

function normalizedString(value, label, maxLength, { required = false, allowMultiline = false } = {}) {
  if (value == null) {
    if (required) throw badRequest(`${label}不能为空`);
    return "";
  }
  if (typeof value !== "string") throw badRequest(`${label}必须是字符串`);
  assertSafeControlCharacters(value, label, allowMultiline);
  const text = trimmedString(value);
  if (required && !text) throw badRequest(`${label}不能为空`);
  if (countCodePoints(text) > maxLength) throw badRequest(`${label}不能超过 ${maxLength} 个字符`);
  return text;
}

function normalizedStringArray(value, label, { maxItems, maxItemLength, deduplicate = false, rejectEmpty = false }) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw badRequest(`${label}必须是数组`);
  if (value.length > maxItems) throw badRequest(`${label}最多包含 ${maxItems} 项`);

  const normalized = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") throw badRequest(`${label}必须只包含字符串`);
    assertSafeControlCharacters(item, label, false);
    const text = item.trim();
    if (!text) {
      if (rejectEmpty) throw badRequest(`${label}不能为空`);
      continue;
    }
    if (countCodePoints(text) > maxItemLength) throw badRequest(`${label}单项不能超过 ${maxItemLength} 个字符`);
    if (deduplicate && seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function normalizedOwnedObjectKeys(ownerId, value, label, maxItems) {
  const keys = normalizedStringArray(value, label, {
    maxItems,
    maxItemLength: MAX_OBJECT_KEY_LENGTH,
    deduplicate: true,
    rejectEmpty: true
  });
  return assertOwnedObjectKeys(ownerId, keys, ["post"]);
}

function normalizedGroupType(value) {
  if (typeof value !== "string") throw badRequest("拼团类型必须是字符串");
  assertSafeControlCharacters(value, "拼团类型", false);
  const groupType = value.trim();
  if (groupType === "followGroup" || groupType === "跟团") return "followGroup";
  if (groupType === "splitGoods" || groupType === "拼谷") return "splitGoods";
  throw badRequest("拼团类型不支持");
}

function normalizedBoolean(value, label) {
  if (typeof value !== "boolean") throw badRequest(`${label}必须是布尔值`);
  return value;
}

function normalizedImageAspect(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 10) {
    throw badRequest("图片比例无效");
  }
  return value;
}

function normalizedUnsoldRoles(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw badRequest("未售角色必须是数组");
  if (value.length > MAX_UNSOLD_ROLES) throw badRequest(`未售角色最多包含 ${MAX_UNSOLD_ROLES} 项`);
  const roles = value.map(normalizedUnsoldRole);
  const seenIds = new Set();
  for (const role of roles) {
    if (seenIds.has(role.id)) throw badRequest("未售角色 ID 不能重复");
    seenIds.add(role.id);
  }
  return roles;
}

function normalizedUnsoldRole(role) {
  if (!isPlainObject(role)) throw badRequest("未售角色格式无效");
  assertAllowedFields(role, ROLE_FIELDS, "未售角色");
  const id = normalizedString(role.id, "角色 ID", MAX_ARRAY_ITEM_LENGTH, { required: true });
  const name = normalizedString(role.name, "角色名称", MAX_ARRAY_ITEM_LENGTH, { required: true });
  if (!Number.isInteger(role.quantity) || role.quantity < 0 || role.quantity > MAX_ROLE_QUANTITY) {
    throw badRequest("角色数量无效");
  }
  if (typeof role.priceAdjustment !== "number" || !Number.isFinite(role.priceAdjustment) ||
      Math.abs(role.priceAdjustment) > MAX_ROLE_PRICE_ADJUSTMENT) {
    throw badRequest("角色调价无效");
  }
  return { id, name, quantity: role.quantity, priceAdjustment: role.priceAdjustment };
}

function normalizedDeadline(value, deadlineConfirmed) {
  if (typeof value !== "string" || !value.trim()) throw badRequest("请填写有效截团时间");
  assertSafeControlCharacters(value, "截团时间", false);
  const deadline = new Date(value.trim());
  if (Number.isNaN(deadline.getTime())) throw badRequest("请填写有效截团时间");
  if (deadline.getTime() <= Date.now() && !deadlineConfirmed) {
    throw badRequest("截团时间已过，请确认后再提交");
  }
  return deadline.toISOString();
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function countCodePoints(value) {
  return Array.from(value).length;
}

function assertSafeControlCharacters(value, label, allowMultiline) {
  const unsafePattern = allowMultiline ? MULTILINE_UNSAFE_CONTROL_CHARACTERS : SINGLE_LINE_CONTROL_CHARACTERS;
  if (unsafePattern.test(value)) throw badRequest(`${label}包含不支持的控制字符`);
}
