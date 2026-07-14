import { formatDateTime, formatRelativeTime, riskLabel } from "./formatters.js";

const MODERATION_STATUSES = Object.freeze([
  "review", "active", "rejected", "hidden", "removed", "ignored", "all"
]);

const DECISIONS = Object.freeze([
  ["approve", "通过"],
  ["reject", "拒绝"],
  ["hide", "隐藏"],
  ["remove", "移除"],
  ["ignore", "忽略信号"]
]);

export function renderModerationWorkspace({
  reviews = [],
  status = "review",
  dialog = null,
  loading = false,
  busy = false
} = {}) {
  const section = element("section", "moderation-panel");
  const header = element("header", "content-heading");
  const headingBlock = element("div");
  const heading = element("h1");
  heading.tabIndex = -1;
  heading.textContent = "发布审核";
  const intro = element("p", "muted");
  intro.textContent = "处理发布前文本、图片和资料变更；每次决定都写入管理员审计。";
  headingBlock.append(heading, intro);
  const refresh = actionButton("刷新", "refresh-moderation");
  refresh.disabled = busy;
  header.append(headingBlock, refresh);
  section.append(header, moderationToolbar(status, busy));
  if (loading && !reviews.length) {
    section.append(emptyState("正在加载审核队列…"));
  } else if (!reviews.length) {
    section.append(emptyState("当前状态没有审核记录。"));
  } else {
    const list = element("div", "moderation-list");
    for (const review of reviews) list.append(moderationItem(review, busy));
    section.append(list);
  }
  if (dialog) section.append(moderationDialog(dialog.review, dialog.decision, busy));
  return section;
}

function moderationToolbar(status, busy) {
  const form = element("form", "queue-toolbar compact-toolbar");
  form.id = "moderation-filter-form";
  const label = element("label", "compact-field");
  const text = element("span", "visually-hidden");
  text.textContent = "审核状态";
  const select = element("select");
  select.name = "status";
  select.setAttribute("aria-label", "审核状态");
  for (const value of MODERATION_STATUSES) {
    const option = element("option");
    option.value = value;
    option.textContent = moderationStatusLabel(value);
    option.selected = value === status;
    select.append(option);
  }
  label.append(text, select);
  const submit = element("button", "secondary-button");
  submit.type = "submit";
  submit.disabled = busy;
  submit.textContent = "应用";
  form.append(label, submit);
  return form;
}

function moderationItem(review, busy) {
  const article = element("article", "moderation-item");
  const header = element("header", "moderation-item-header");
  const heading = element("h2");
  heading.textContent = `${targetTypeLabel(review.targetType)} · ${review.targetID}`;
  const state = element("p", `risk-text risk-${review.riskLevel}`);
  state.textContent = `${riskLabel(review.riskLevel)}风险 · ${moderationStatusLabel(review.status)}`;
  header.append(heading, state);
  const meta = summaryList([
    ["所有者", review.ownerID || "—"],
    ["信号来源", review.source || "systemRule"],
    ["创建时间", `${formatDateTime(review.createdAt)}（${formatRelativeTime(review.createdAt)}）`],
    ["最近更新", formatDateTime(review.updatedAt)]
  ]);
  article.append(header, meta);
  if (review.textSnapshot) {
    const text = element("pre", "moderation-text");
    text.textContent = review.textSnapshot;
    article.append(text);
  }
  if (review.imageURLs?.length) {
    const images = element("div", "moderation-images");
    for (const url of review.imageURLs) {
      const image = element("img");
      image.src = url;
      image.alt = "待审核图片";
      image.loading = "lazy";
      images.append(image);
    }
    article.append(images);
  }
  if (Object.keys(review.rawSummary || {}).length) {
    const details = element("details", "provider-details");
    const summary = element("summary");
    summary.textContent = "查看服务商信号";
    const pre = element("pre", "structured-data");
    pre.textContent = JSON.stringify(review.rawSummary, null, 2);
    details.append(summary, pre);
    article.append(details);
  }
  const actions = element("div", "row-actions moderation-actions");
  for (const [decision, label] of DECISIONS) {
    const button = actionButton(label, "open-moderation-decision",
      decision === "remove" ? "secondary-button danger-button" : "secondary-button");
    button.dataset.reviewId = review.id;
    button.dataset.decision = decision;
    button.disabled = busy;
    actions.append(button);
  }
  article.append(actions);
  return article;
}

function moderationDialog(review, decision, busy) {
  const label = DECISIONS.find(([value]) => value === decision)?.[1] || "处理";
  const dialog = element("dialog", "workspace-dialog");
  dialog.setAttribute("aria-labelledby", "moderation-dialog-title");
  const heading = element("h2");
  heading.id = "moderation-dialog-title";
  heading.tabIndex = -1;
  heading.textContent = `${label}审核记录`;
  const impact = element("p", "muted");
  impact.textContent = decision === "ignore"
    ? `仅忽略记录 ${review.id} 的审核信号，不修改当前对象。`
    : `将对 ${targetTypeLabel(review.targetType)} ${review.targetID} 应用“${label}”。`;
  const form = element("form", "dialog-form");
  form.id = "moderation-decision-form";
  form.dataset.reviewId = review.id;
  form.dataset.decision = decision;
  const field = element("div", "field");
  const reasonLabel = element("label");
  reasonLabel.htmlFor = "moderation-decision-reason";
  reasonLabel.textContent = "审核理由";
  const reason = element("textarea");
  reason.id = "moderation-decision-reason";
  reason.name = "reason";
  reason.required = true;
  reason.maxLength = 1000;
  reason.rows = 4;
  field.append(reasonLabel, reason);
  form.append(field);
  if (decision === "remove") {
    const confirm = element("label", "confirm-check");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    checkbox.required = true;
    const copy = element("span");
    copy.textContent = "我已核对当前对象并确认移除。";
    confirm.append(checkbox, copy);
    form.append(confirm);
  }
  const actions = element("div", "button-row");
  const submit = element("button", decision === "remove" ? "primary-button danger-button" : "primary-button");
  submit.type = "submit";
  submit.disabled = busy;
  submit.textContent = busy ? "处理中…" : `确认${label}`;
  const cancel = actionButton("取消", "close-workspace-dialog");
  cancel.disabled = busy;
  actions.append(submit, cancel);
  form.append(actions);
  dialog.append(heading, impact, form);
  return dialog;
}

function summaryList(rows) {
  const list = element("dl", "inspector-summary moderation-summary");
  for (const [term, value] of rows) {
    const row = element("div");
    const dt = element("dt");
    dt.textContent = term;
    const dd = element("dd");
    dd.textContent = value;
    row.append(dt, dd);
    list.append(row);
  }
  return list;
}

function moderationStatusLabel(value) {
  return ({
    review: "待审核",
    active: "已通过",
    rejected: "已拒绝",
    hidden: "已隐藏",
    removed: "已移除",
    ignored: "已忽略",
    all: "全部状态"
  })[value] || value;
}

function targetTypeLabel(value) {
  return ({
    post: "帖子",
    comment: "评论",
    collection: "拼单合集",
    profileText: "个人资料文字",
    avatar: "头像",
    profileBackground: "个人主页背景"
  })[value] || value;
}

function actionButton(label, action, className = "secondary-button") {
  const button = element("button", className);
  button.type = "button";
  button.dataset.action = action;
  button.textContent = label;
  return button;
}

function emptyState(text) {
  const node = element("p", "empty-state");
  node.textContent = text;
  return node;
}

function element(tag, className = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
