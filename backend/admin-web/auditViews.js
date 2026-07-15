import { formatCount, formatDateTime, formatRelativeTime, riskLabel, statusLabel } from "./formatters.js";

export function renderAuditWorkspace({
  events = [],
  eventType = "",
  nextCursor = null,
  loading = false,
  busy = false
} = {}) {
  const section = element("section", "audit-panel");
  const header = contentHeader("审计记录", "设备认证、证据查看与人工决定均保留可追溯记录。", "refresh-audit", busy);
  section.append(header, auditToolbar(eventType, busy));
  if (loading && !events.length) {
    section.append(emptyState("正在加载审计记录…"));
  } else if (!events.length) {
    section.append(emptyState("当前筛选没有审计记录。"));
  } else {
    section.append(auditTable(events));
  }
  if (nextCursor) {
    const more = actionButton("加载更多", "load-more-audit", "secondary-button load-more-button");
    more.disabled = busy;
    section.append(more);
  }
  return section;
}

export function renderUserRiskWorkspace({ cases = [], loading = false, busy = false } = {}) {
  const section = element("section", "user-risk-panel");
  section.append(contentHeader(
    "用户风险",
    "仅显示已确认并已处置案件；时间越久权重应越低。本页不计算驳回举报分数。",
    "refresh-cases",
    busy
  ));
  const policy = element("p", "policy-note");
  policy.textContent = "风险判断必须回到具体案件和证据，不能仅凭举报数量限制账号。";
  section.append(policy);
  if (loading && !cases.length) {
    section.append(emptyState("正在加载已处置案件…"));
  } else if (!cases.length) {
    section.append(emptyState("没有已确认并已处置的案件。"));
  } else {
    const list = element("div", "risk-case-list");
    for (const item of cases) list.append(riskCase(item));
    section.append(list);
  }
  return section;
}

function auditToolbar(eventType, busy) {
  const form = element("form", "queue-toolbar compact-toolbar");
  form.id = "audit-filter-form";
  const label = element("label", "compact-field");
  const text = element("span");
  text.textContent = "事件类型";
  const input = element("input");
  input.name = "eventType";
  input.value = eventType;
  input.placeholder = "例如 safety.evidence_viewed";
  input.pattern = "[a-z0-9_.-]{1,80}";
  input.autocomplete = "off";
  label.append(text, input);
  const submit = element("button", "secondary-button");
  submit.type = "submit";
  submit.disabled = busy;
  submit.textContent = "应用";
  form.append(label, submit);
  return form;
}

function auditTable(events) {
  const wrapper = element("div", "table-scroll");
  const table = element("table", "audit-table");
  const caption = element("caption", "visually-hidden");
  caption.textContent = "管理员审计记录";
  const head = element("thead");
  const row = element("tr");
  for (const label of ["时间", "管理员设备", "事件", "主体", "最小数据"]) {
    const cell = element("th");
    cell.scope = "col";
    cell.textContent = label;
    row.append(cell);
  }
  head.append(row);
  const body = element("tbody");
  for (const event of events) body.append(auditRow(event));
  table.append(caption, head, body);
  wrapper.append(table);
  return wrapper;
}

function auditRow(event) {
  const row = element("tr", event.eventType.startsWith("safety.evidence_") ? "audit-evidence-row" : "");
  row.append(
    tableCell("时间", formatDateTime(event.createdAt), "tabular"),
    tableCell("管理员设备", [event.adminUsername, event.deviceName].filter(Boolean).join(" · ") || "系统"),
    tableCell("事件", eventLabel(event.eventType)),
    tableCell("主体", [event.subjectType, event.subjectID].filter(Boolean).join(" · ") || "—", "tabular"),
    tableCell("最小数据", compactData(event.data))
  );
  return row;
}

function riskCase(item) {
  const article = element("article", "risk-case-row");
  const heading = element("h2");
  const open = actionButton(item.subjectTitle, "open-case", "row-link");
  open.dataset.caseId = item.id;
  heading.append(open);
  const state = element("p", `risk-text risk-${item.riskLevel}`);
  state.textContent = `${riskLabel(item.riskLevel)}风险 · ${statusLabel(item.status)}`;
  const meta = element("p", "muted");
  meta.textContent = `${formatCount(item.independentReporterCount)} 名独立举报人 · 处置更新于 ${formatRelativeTime(item.updatedAt)}`;
  article.append(heading, state, meta);
  return article;
}

function contentHeader(title, description, action, busy) {
  const header = element("header", "content-heading");
  const block = element("div");
  const heading = element("h1");
  heading.tabIndex = -1;
  heading.textContent = title;
  const intro = element("p", "muted");
  intro.textContent = description;
  block.append(heading, intro);
  const refresh = actionButton("刷新", action);
  refresh.disabled = busy;
  header.append(block, refresh);
  return header;
}

function compactData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
  const entries = Object.entries(value).slice(0, 4);
  if (!entries.length) return "—";
  return entries.map(([key, item]) => `${key}: ${compactValue(item)}`).join("；");
}

function compactValue(value) {
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  if (["number", "boolean"].includes(typeof value)) return String(value);
  return "[结构化数据]";
}

function eventLabel(value) {
  return ({
    "safety.evidence_viewed": "查看证据原文",
    "safety.evidence_object_viewed": "查看证据图片",
    "safety.case_decided": "案件人工决定",
    "safety.user_restriction_changed": "账号限制变更",
    "moderation.review_decided": "发布审核决定",
    "admin.login_succeeded": "管理员登录",
    "admin.logout": "管理员退出"
  })[value] || value;
}

function tableCell(label, value, className = "") {
  const cell = element("td", className);
  cell.dataset.label = label;
  cell.textContent = value;
  return cell;
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
