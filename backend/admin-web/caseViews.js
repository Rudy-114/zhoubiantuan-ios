import { formatCount, formatDateTime, formatRelativeTime, riskLabel, statusLabel } from "./formatters.js";
import {
  CASE_CATEGORIES,
  CASE_SORTS,
  CASE_STATUSES,
  RISK_LEVELS,
  SUBJECT_TYPES,
  caseMatchesSearch,
  dueLabel,
  revealedEvidence
} from "./workspace.js";

const SUBJECT_LABELS = Object.freeze({
  post: "帖子",
  comment: "评论",
  user: "用户",
  direct_message: "私信",
  collection: "拼单合集"
});

const CATEGORY_LABELS = Object.freeze({
  suspected_scam: "疑似诈骗",
  false_or_expired_group_buy: "虚假或过期拼单",
  invalid_contact: "联系方式异常",
  copyright_or_stolen_media: "版权或盗图",
  harassment_or_abuse: "骚扰或辱骂",
  sexual_or_illegal: "色情或违法",
  spam_or_advertising: "垃圾广告",
  direct_message_risk: "私信风险",
  other: "其他"
});

const DECISION_LABELS = Object.freeze({
  no_action: "无需处置",
  temporary_hide: "暂时隐藏",
  request_correction: "要求整改",
  permanent_remove: "永久移除",
  approve_revision: "发布已通过整改",
  restore: "恢复内容",
  uphold_appeal: "维持原处理",
  overturn_appeal: "撤销原处理",
  restrict_user: "限制账号",
  restore_user: "解除账号限制"
});

const DESTRUCTIVE_DECISIONS = new Set([
  "permanent_remove", "restore", "uphold_appeal", "overturn_appeal", "restrict_user", "restore_user"
]);

export function renderCaseWorkspace({
  title,
  description,
  cases = [],
  counts = {},
  filters = {},
  search = "",
  nextCursor = null,
  detail = null,
  selectedCaseID = "",
  revealMap = new Map(),
  dialog = null,
  loading = false,
  busy = false
} = {}) {
  const layout = element("div", `case-layout${selectedCaseID ? " has-inspector" : ""}`);
  layout.append(renderCaseQueue({
    title,
    description,
    cases,
    counts,
    filters,
    search,
    nextCursor,
    selectedCaseID,
    loading,
    busy
  }));
  if (selectedCaseID) layout.append(renderCaseInspector({
    detail,
    selectedCaseID,
    revealMap,
    dialog,
    loading,
    busy
  }));
  return layout;
}

export function renderCaseQueue({
  title = "安全案件",
  description = "按风险、状态和整改时限处理。",
  cases = [],
  filters = {},
  search = "",
  nextCursor = null,
  selectedCaseID = "",
  loading = false,
  busy = false
} = {}) {
  const section = element("section", "queue-panel");
  section.setAttribute("aria-labelledby", "queue-title");
  const header = element("header", "content-heading");
  const headingBlock = element("div");
  const heading = element("h1");
  heading.id = "queue-title";
  heading.tabIndex = -1;
  heading.textContent = title;
  const intro = element("p", "muted");
  intro.textContent = description;
  headingBlock.append(heading, intro);
  const refresh = actionButton("刷新", "refresh-cases");
  refresh.disabled = busy;
  header.append(headingBlock, refresh);
  section.append(header, filterToolbar(filters, search, busy));

  const visibleCases = cases.filter((item) => caseMatchesSearch(item, search));
  if (loading && !cases.length) {
    section.append(loadingRows());
  } else if (!visibleCases.length) {
    section.append(emptyState(search ? "当前页没有匹配案件。" : "当前筛选没有案件。"));
  } else {
    section.append(caseTable(visibleCases, selectedCaseID));
  }
  if (nextCursor) {
    const more = actionButton("加载更多", "load-more-cases", "secondary-button load-more-button");
    more.disabled = busy;
    section.append(more);
  }
  return section;
}

export function renderCaseInspector({
  detail,
  selectedCaseID,
  revealMap = new Map(),
  dialog = null,
  loading = false,
  busy = false
} = {}) {
  const inspector = element("aside", "case-inspector");
  inspector.setAttribute("aria-label", "案件详情");
  const close = actionButton("关闭详情", "close-case", "text-button inspector-close");
  inspector.append(close);
  if (loading && !detail) {
    inspector.setAttribute("aria-busy", "true");
    inspector.append(emptyState("正在加载案件详情…"));
    return inspector;
  }
  if (!detail || detail.id !== selectedCaseID) {
    inspector.append(emptyState("案件详情暂时不可用。"));
    return inspector;
  }

  const header = element("header", "inspector-header");
  const mobilePageHeading = element("h1", "mobile-inspector-page-title");
  mobilePageHeading.tabIndex = -1;
  mobilePageHeading.textContent = "案件详情";
  const eyebrow = element("p", `risk-text risk-${detail.riskLevel}`);
  eyebrow.textContent = `${riskLabel(detail.riskLevel)}风险 · ${statusLabel(detail.status)}`;
  const heading = element("h2");
  heading.tabIndex = -1;
  heading.textContent = detail.subjectTitle;
  const identifier = element("p", "muted tabular");
  identifier.textContent = `${subjectLabel(detail.subjectType)} · ${detail.id}`;
  header.append(mobilePageHeading, eyebrow, heading, identifier);
  inspector.append(header);

  inspector.append(detailSection("案件概况", summaryList([
    ["举报原因", categoryLabel(detail.category)],
    ["影响范围", detail.impactScope || "—"],
    ["独立举报人", formatCount(detail.independentReporterCount)],
    ["举报总数", formatCount(detail.reportCount)],
    ["整改截止", detail.correctionDueAt ? dueLabel(detail.correctionDueAt) : "无"],
    ["人工保持", detail.manualHold ? "已启用" : "未启用"]
  ])));

  inspector.append(detailSection("举报汇总", reportList(detail.reports)));
  inspector.append(detailSection("证据", evidenceList(detail, revealMap)));
  inspector.append(detailSection("AI 建议", safeObjectView(detail.aiRecommendation, "暂无 AI 建议。")));
  inspector.append(detailSection("时间线", timeline(detail.events)));
  inspector.append(detailSection("动作记录", actionList(detail.actions)));
  inspector.append(detailSection("整改与申诉", revisionAndAppeal(detail)));
  inspector.append(detailSection("关联案件", relatedCases(detail.relatedCases)));
  inspector.append(detailSection("人工决定", decisionControls(detail, busy), "decision-section"));
  if (dialog?.kind === "evidence") inspector.append(evidenceDialog(detail, dialog.evidence, busy));
  if (dialog?.kind === "decision") inspector.append(decisionDialog(detail, dialog.decision, busy));
  return inspector;
}

function filterToolbar(filters, search, busy) {
  const form = element("form", "queue-toolbar");
  form.id = "case-filter-form";
  const searchLabel = visuallyHiddenLabel("case-search", "搜索案件");
  const searchInput = element("input");
  searchInput.id = "case-search";
  searchInput.name = "search";
  searchInput.type = "search";
  searchInput.placeholder = "搜索标题或 ID";
  searchInput.value = search;
  searchInput.autocomplete = "off";
  const status = selectField("status", "状态", CASE_STATUSES, filters.status, statusLabel);
  const subject = selectField("subjectType", "类型", SUBJECT_TYPES, filters.subjectType, subjectLabel);
  const category = selectField("category", "原因", CASE_CATEGORIES, filters.category, categoryLabel);
  const risk = selectField("riskLevel", "风险", RISK_LEVELS, filters.riskLevel, riskLabel);
  const sort = selectField("sort", "排序", CASE_SORTS, filters.sort || "urgent", sortLabel, false);
  const submit = element("button", "secondary-button");
  submit.type = "submit";
  submit.disabled = busy;
  submit.textContent = "应用筛选";
  form.append(searchLabel, searchInput, status, subject, category, risk, sort, submit);
  return form;
}

function selectField(name, label, values, selected, labeler, includeAll = true) {
  const wrapper = element("label", "compact-field");
  const text = element("span", "visually-hidden");
  text.textContent = label;
  const select = element("select");
  select.name = name;
  select.setAttribute("aria-label", label);
  if (includeAll) select.append(option("", `全部${label}`));
  for (const value of values) select.append(option(value, labeler(value), value === selected));
  wrapper.append(text, select);
  return wrapper;
}

function caseTable(cases, selectedCaseID) {
  const wrapper = element("div", "table-scroll");
  const table = element("table", "case-table");
  const caption = element("caption", "visually-hidden");
  caption.textContent = "安全案件队列";
  const head = element("thead");
  const headRow = element("tr");
  for (const label of ["优先级", "主体", "原因", "状态", "独立举报人", "截止/年龄", "最近更新"]) {
    const cell = element("th");
    cell.scope = "col";
    cell.textContent = label;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = element("tbody");
  for (const item of cases) body.append(caseRow(item, selectedCaseID));
  table.append(caption, head, body);
  wrapper.append(table);
  return wrapper;
}

function caseRow(item, selectedCaseID) {
  const row = element("tr", item.id === selectedCaseID ? "is-selected" : "");
  row.append(
    tableCell("优先级", riskStatus(item.riskLevel)),
    tableCell("主体", caseOpenButton(item)),
    tableCell("原因", categoryLabel(item.category)),
    tableCell("状态", statusLabel(item.status)),
    tableCell("独立举报人", formatCount(item.independentReporterCount), "tabular"),
    tableCell("截止/年龄", item.correctionDueAt ? dueLabel(item.correctionDueAt) : formatRelativeTime(item.updatedAt), "tabular"),
    tableCell("最近更新", formatRelativeTime(item.updatedAt), "tabular")
  );
  return row;
}

function caseOpenButton(item) {
  const wrapper = element("div", "case-subject");
  const button = actionButton(item.subjectTitle, "open-case", "row-link");
  button.dataset.caseId = item.id;
  const meta = element("span", "muted tabular");
  meta.textContent = `${subjectLabel(item.subjectType)} · ${item.subjectID}`;
  wrapper.append(button, meta);
  return wrapper;
}

function evidenceList(detail, revealMap) {
  const list = element("div", "evidence-list");
  if (!detail.evidence?.length) return emptyState("没有保留证据。" );
  for (const metadata of detail.evidence) {
    const model = revealedEvidence(metadata, revealMap);
    const article = element("article", "evidence-item");
    const heading = element("h4");
    heading.textContent = `${evidenceTypeLabel(metadata.type)} · ${formatDateTime(metadata.createdAt)}`;
    const summary = element("p", "muted");
    summary.textContent = [
      metadata.hasText ? "含文本" : "无文本",
      metadata.hasStructuredData ? "含结构化快照" : "无结构化快照",
      `${formatCount(metadata.objectCount)} 张图片`
    ].join(" · ");
    article.append(heading, summary);
    if (!model.revealed) {
      const hidden = element("p", "evidence-hidden");
      hidden.textContent = detail.subjectType === "direct_message"
        ? "私信原文默认隐藏；查看会写入审计记录。"
        : "原始证据默认隐藏；查看会写入审计记录。";
      const reveal = actionButton("填写理由并查看", "open-evidence-dialog", "secondary-button");
      reveal.dataset.evidenceId = metadata.id;
      article.append(hidden, reveal);
    } else {
      article.append(rawEvidence(model.revealed, model.accessReason));
    }
    list.append(article);
  }
  return list;
}

function rawEvidence(evidence, reason) {
  const container = element("div", "revealed-evidence");
  const audited = element("p", "audited-label");
  audited.textContent = `已审计查看 · 理由：${reason}`;
  container.append(audited);
  if (evidence.textSnapshot) {
    const text = element("pre", "evidence-text");
    text.textContent = evidence.textSnapshot;
    container.append(text);
  }
  const messages = evidence.structuredSnapshot?.messages;
  if (Array.isArray(messages)) {
    const messageList = element("ol", "message-window");
    for (const message of messages) {
      const item = element("li");
      const sender = element("strong");
      sender.textContent = message.senderLabel || "对话参与者";
      const copy = element("p");
      copy.textContent = message.body || message.text || message.content || "[非文本消息]";
      item.append(sender, copy);
      if (message.imageURL) item.append(evidenceImage(message.imageURL, reason, "私信证据图片"));
      messageList.append(item);
    }
    container.append(messageList);
  } else if (evidence.structuredSnapshot && Object.keys(evidence.structuredSnapshot).length) {
    container.append(safeObjectView(evidence.structuredSnapshot));
  }
  for (const url of evidence.objectURLs || []) container.append(evidenceImage(url, reason, "案件证据图片"));
  return container;
}

function evidenceImage(path, reason, alt) {
  const image = element("img", "evidence-image");
  image.alt = alt;
  image.loading = "lazy";
  image.src = auditedObjectURL(path, reason);
  return image;
}

function auditedObjectURL(path, reason) {
  if (typeof path !== "string" || !path.startsWith("/admin/api/")) return "";
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}reason=${encodeURIComponent(reason)}`;
}

function evidenceDialog(detail, evidence, busy) {
  const dialog = dialogFrame("查看原始证据", "查看会记录管理员设备、案件、证据和理由。", "evidence-dialog-title");
  const form = element("form", "dialog-form");
  form.id = "evidence-reveal-form";
  form.dataset.caseId = detail.id;
  form.dataset.evidenceId = evidence.id;
  form.append(textAreaField("evidence-access-reason", "reason", "查看理由", 500));
  form.append(dialogActions("确认并查看", "close-workspace-dialog", busy));
  dialog.append(form);
  return dialog;
}

function decisionDialog(detail, decision, busy) {
  const label = DECISION_LABELS[decision] || "处理案件";
  const dialog = dialogFrame(label, decisionImpact(detail, decision), "decision-dialog-title");
  const form = element("form", "dialog-form");
  form.id = "case-decision-form";
  form.dataset.caseId = detail.id;
  form.dataset.decision = decision;
  form.append(textAreaField("case-decision-reason", "reason", "处理理由", 1000));
  if (decision === "restrict_user" || decision === "restore_user") {
    const hidden = element("input");
    hidden.type = "hidden";
    hidden.name = "userID";
    hidden.value = detail.subjectOwnerID || "";
    form.append(hidden);
  }
  if (DESTRUCTIVE_DECISIONS.has(decision)) {
    const confirm = element("label", "confirm-check");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    checkbox.name = "confirmed";
    checkbox.required = true;
    const text = element("span");
    text.textContent = `我已核对单个案件，并确认执行“${label}”。`;
    confirm.append(checkbox, text);
    form.append(confirm);
  }
  form.append(dialogActions(`确认${label}`, "close-workspace-dialog", busy,
    DESTRUCTIVE_DECISIONS.has(decision)));
  dialog.append(form);
  return dialog;
}

function decisionControls(detail, busy) {
  const controls = element("div", "decision-controls");
  const decisions = availableCaseDecisions(detail);
  for (const decision of decisions) {
    const button = actionButton(DECISION_LABELS[decision], "open-case-decision",
      DESTRUCTIVE_DECISIONS.has(decision) ? "secondary-button danger-button" : "secondary-button");
    button.dataset.decision = decision;
    button.disabled = busy;
    controls.append(button);
  }
  return controls;
}

export function availableCaseDecisions(detail = {}) {
  const decisions = detail.status === "appealed"
    ? ["uphold_appeal", "overturn_appeal"]
    : ["no_action", "temporary_hide"];
  if (detail.status !== "appealed" && ["post", "collection"].includes(detail.subjectType)) {
    decisions.push("request_correction", "permanent_remove");
    if (detail.revisions?.some((revision) => revision.status === "approved")) decisions.push("approve_revision");
    if (detail.actions?.some((action) => action.status === "applied")) decisions.push("restore");
  }
  if (detail.subjectOwnerID) decisions.push(isUserRestricted(detail) ? "restore_user" : "restrict_user");
  return [...new Set(decisions)];
}

function isUserRestricted(detail) {
  const actions = (detail.actions || [])
    .filter((action) => action.targetType === "user" && ["restrict_user", "restore_user"].includes(action.type));
  return actions.at(-1)?.type === "restrict_user";
}

function reportList(reports = []) {
  const list = element("ul", "plain-list");
  if (!reports.length) return emptyState("没有举报记录。" );
  for (const report of reports) {
    const item = element("li");
    const title = element("strong");
    title.textContent = report.reporterLabel;
    const copy = element("span", "muted");
    copy.textContent = `${categoryLabel(report.reasonCode)} · ${formatDateTime(report.createdAt)} · ${report.status}`;
    item.append(title, copy);
    list.append(item);
  }
  return list;
}

function timeline(events = []) {
  const list = element("ol", "timeline-list");
  if (!events.length) return emptyState("没有案件事件。" );
  for (const event of events) {
    const item = element("li");
    const title = element("strong");
    title.textContent = eventTypeLabel(event.type);
    const meta = element("span", "muted tabular");
    meta.textContent = `${formatDateTime(event.createdAt)} · ${event.actorLabel}`;
    item.append(title, meta);
    list.append(item);
  }
  return list;
}

function actionList(actions = []) {
  const list = element("ul", "plain-list");
  if (!actions.length) return emptyState("没有处理动作。" );
  for (const action of actions) {
    const item = element("li");
    const title = element("strong");
    title.textContent = `${action.type} · ${action.status}`;
    const copy = element("span", "muted");
    copy.textContent = `${action.actorType} · ${formatDateTime(action.appliedAt || action.createdAt)}`;
    item.append(title, copy);
    list.append(item);
  }
  return list;
}

function revisionAndAppeal(detail) {
  const container = element("div", "stack-list");
  if (!detail.revisions?.length && !detail.appeal) return emptyState("没有整改版本或申诉。" );
  for (const revision of detail.revisions || []) {
    const item = element("div", "subsection-row");
    const title = element("strong");
    title.textContent = `整改版本 ${revision.number} · ${revision.status}`;
    const meta = element("span", "muted");
    meta.textContent = formatDateTime(revision.createdAt);
    item.append(title, meta);
    container.append(item);
  }
  if (detail.appeal) {
    const item = element("div", "subsection-row");
    const title = element("strong");
    title.textContent = `申诉 · ${detail.appeal.status}`;
    const meta = element("span", "muted");
    meta.textContent = formatDateTime(detail.appeal.createdAt);
    item.append(title, meta);
    container.append(item);
  }
  return container;
}

function relatedCases(cases = []) {
  const list = element("ul", "plain-list");
  if (!cases.length) return emptyState("没有关联案件。" );
  for (const item of cases) {
    const row = element("li");
    const button = actionButton(item.subjectTitle, "open-case", "row-link");
    button.dataset.caseId = item.id;
    const meta = element("span", "muted");
    meta.textContent = `${statusLabel(item.status)} · ${formatRelativeTime(item.updatedAt)}`;
    row.append(button, meta);
    list.append(row);
  }
  return list;
}

function safeObjectView(value, empty = "没有可显示的数据。") {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) {
    return emptyState(empty);
  }
  const pre = element("pre", "structured-data");
  pre.textContent = JSON.stringify(value, null, 2);
  return pre;
}

function summaryList(rows) {
  const list = element("dl", "inspector-summary");
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

function detailSection(title, content, className = "") {
  const section = element("section", `inspector-section ${className}`.trim());
  const heading = element("h3");
  heading.textContent = title;
  section.append(heading, content);
  return section;
}

function dialogFrame(title, description, titleID) {
  const dialog = element("dialog", "workspace-dialog");
  dialog.setAttribute("aria-labelledby", titleID);
  const heading = element("h2");
  heading.id = titleID;
  heading.tabIndex = -1;
  heading.textContent = title;
  const copy = element("p", "muted");
  copy.textContent = description;
  dialog.append(heading, copy);
  return dialog;
}

function dialogActions(confirmLabel, cancelAction, busy, danger = false) {
  const actions = element("div", "button-row");
  const confirm = element("button", danger ? "primary-button danger-button" : "primary-button");
  confirm.type = "submit";
  confirm.disabled = busy;
  confirm.textContent = busy ? "处理中…" : confirmLabel;
  const cancel = actionButton("取消", cancelAction, "secondary-button");
  cancel.disabled = busy;
  actions.append(confirm, cancel);
  return actions;
}

function textAreaField(id, name, label, maxlength) {
  const wrapper = element("div", "field");
  const labelNode = element("label");
  labelNode.htmlFor = id;
  labelNode.textContent = label;
  const textarea = element("textarea");
  textarea.id = id;
  textarea.name = name;
  textarea.required = true;
  textarea.maxLength = maxlength;
  textarea.rows = 4;
  wrapper.append(labelNode, textarea);
  return wrapper;
}

function decisionImpact(detail, decision) {
  const subject = `${subjectLabel(detail.subjectType)}“${detail.subjectTitle}”`;
  const impacts = {
    no_action: `${subject}将结案，不施加限制。`,
    temporary_hide: `${subject}将立即对普通用户隐藏。`,
    request_correction: `${subject}将保持限制并进入 24 小时整改。`,
    permanent_remove: `${subject}将永久标记为移除，但数据库记录会保留。`,
    approve_revision: `${subject}将发布最新已通过的整改版本。`,
    restore: `${subject}的本案件可逆动作将回滚。`,
    uphold_appeal: `${subject}的原处理将维持，申诉结案。`,
    overturn_appeal: `${subject}的申诉动作将按原决定精确回滚。`,
    restrict_user: `账号 ${detail.subjectOwnerID} 将不能发布、评论、私信或关注。`,
    restore_user: `账号 ${detail.subjectOwnerID} 的本案件限制将解除；其他案件仍会阻止解除。`
  };
  return impacts[decision] || `${subject}将执行人工决定。`;
}

function loadingRows() {
  const container = element("div", "loading-lines");
  container.setAttribute("aria-label", "正在加载案件");
  for (let index = 0; index < 5; index += 1) container.append(element("span"));
  return container;
}

function riskStatus(value) {
  const span = element("span", `risk-text risk-${value}`);
  span.textContent = riskLabel(value);
  return span;
}

function tableCell(label, value, className = "") {
  const cell = element("td", className);
  cell.dataset.label = label;
  if (value instanceof Node) cell.append(value);
  else cell.textContent = value;
  return cell;
}

function option(value, label, selected = false) {
  const node = element("option");
  node.value = value;
  node.textContent = label;
  node.selected = selected;
  return node;
}

function visuallyHiddenLabel(forID, label) {
  const node = element("label", "visually-hidden");
  node.htmlFor = forID;
  node.textContent = label;
  return node;
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

function subjectLabel(value) {
  return SUBJECT_LABELS[value] || "未知主体";
}

function categoryLabel(value) {
  return CATEGORY_LABELS[value] || "未知原因";
}

function evidenceTypeLabel(value) {
  return ({ report: "举报证据", target_snapshot: "主体快照", direct_message_window: "私信窗口" })[value] || value || "证据";
}

function eventTypeLabel(value) {
  return ({
    case_received: "案件接收",
    report_added: "新增举报",
    admin_decision_applied: "管理员决定",
    admin_user_restriction_changed: "账号限制变更"
  })[value] || value;
}

function sortLabel(value) {
  return ({ urgent: "风险优先", oldest: "最早案件", newest: "最近更新", deadline: "整改截止" })[value] || value;
}

function element(tag, className = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
