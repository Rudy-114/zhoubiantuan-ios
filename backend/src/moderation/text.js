import { arrayOfStrings } from "../validators.js";

const publicContentContext = [
  "审核场景: 欧美/二次元周边团购平台的公开帖子或拼团合集。",
  "判断原则: 联系方式、开团、引流到微信/QQ/QQ群是平台允许的交易沟通方式；不能因此直接判违规。",
  "语义提示: 标题、商品名、角色名、同人梗或价格吐槽中可能出现“抢钱”“惩罚”等短词；没有诈骗、暴力威胁、违法引导时不要仅凭单词判违规。",
  "仍需拦截: 色情低俗、违法违禁、涉政暴恐、辱骂骚扰、诈骗风险、隐私泄露等真实风险内容。"
].join("\n");

export function moderationText(fields, options = {}) {
  if (typeof fields === "string") return fields;
  const omitKeys = new Set(options.omitKeys || []);
  return Object.entries(fields || {})
    .filter(([key]) => !omitKeys.has(key))
    .flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => `${key}: ${JSON.stringify(item)}`) : [`${key}: ${value ?? ""}`])
    .join("\n");
}

export function publicContentModerationText(fields) {
  return `${publicContentContext}\n\n待审核内容:\n${moderationText(fields)}`;
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
