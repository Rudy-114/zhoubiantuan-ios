import { formatDateTime, formatRelativeTime } from "./formatters.js";

export function renderPendingDeviceView({ pending, notice = "", error = "", busy = false } = {}) {
  const main = element("main", "pending-layout");
  main.id = "workspace";
  const heading = element("h1");
  heading.tabIndex = -1;
  heading.textContent = "等待根设备批准";
  const intro = element("p", "auth-intro");
  intro.textContent = "密码验证只创建了设备申请，并未授予后台访问权限。请在已登录的根设备上核对并批准。";
  const codeLabel = element("p", "pending-label");
  codeLabel.textContent = "六位校验码";
  const code = element("p", "pending-code tabular");
  code.textContent = pending?.shortCode || "—";
  const details = element("dl", "definition-list");
  details.append(
    definition("设备名称", pending?.deviceName || "—"),
    definition("申请编号", pending?.requestID || "—", true),
    definition("有效期至", formatDateTime(pending?.expiresAt))
  );
  main.append(heading, intro, statusMessages({ notice, error }), codeLabel, code, details);
  const actions = element("div", "button-row");
  actions.append(
    actionButton("检查批准状态", "check-device-status", { primary: true, busy }),
    actionButton("取消并返回登录", "cancel-device-request", { busy })
  );
  main.append(actions);
  return main;
}

export function renderAuthenticatedView({
  session,
  devices = [],
  requests = [],
  dialog = null,
  notice = "",
  error = "",
  busy = false
} = {}) {
  const main = element("main", "device-workspace");
  main.id = "workspace";
  const header = element("header", "workspace-header");
  const headingBlock = element("div");
  const eyebrow = element("p", "auth-brand");
  eyebrow.textContent = "周边团 · 安全后台";
  const heading = element("h1");
  heading.tabIndex = -1;
  heading.textContent = session?.isRoot ? "受信设备" : "已登录";
  const sessionText = element("p", "muted");
  sessionText.textContent = `${session?.username || "管理员"} · ${session?.deviceName || "本设备"}${session?.isRoot ? " · 根设备" : ""}`;
  headingBlock.append(eyebrow, heading, sessionText);
  const headerActions = element("div", "row-actions");
  if (session?.isRoot) headerActions.append(actionButton("刷新设备", "refresh-device-data", { busy }));
  headerActions.append(actionButton("退出登录", "logout", { busy }));
  header.append(headingBlock, headerActions);
  main.append(header, statusMessages({ notice, error }));

  if (!session?.isRoot) {
    const copy = element("p", "auth-intro");
    copy.textContent = "此设备已获批准。设备审批与恢复仅能在根设备上进行。";
    main.append(copy);
    return main;
  }

  const pendingSection = sectionHeading("待审批申请", "逐一核对设备名称、环境摘要和六位校验码。");
  const pendingList = element("div", "device-list");
  const pendingRequests = requests.filter((request) => request.status === "pending");
  if (!pendingRequests.length) pendingList.append(emptyState("目前没有待审批设备。"));
  for (const request of pendingRequests) pendingList.append(pendingRequestRow(request, busy));
  pendingSection.append(pendingList);

  const devicesSection = sectionHeading("已登记设备", "撤销状态会明确显示；私钥和公钥材料不会出现在此页面。");
  const deviceList = element("div", "device-list");
  if (!devices.length) deviceList.append(emptyState("没有可显示的设备。"));
  for (const device of devices) deviceList.append(deviceRow(device));
  devicesSection.append(deviceList);
  main.append(pendingSection, devicesSection);
  if (dialog) main.append(decisionDialog(dialog, busy));
  return main;
}

function pendingRequestRow(request, busy) {
  const article = element("article", "device-row");
  const body = element("div");
  const title = element("h3");
  title.textContent = request.name;
  const detail = element("p", "muted");
  detail.textContent = request.userAgentSummary || "浏览器环境未知";
  const time = element("p", "muted tabular");
  time.textContent = `申请于 ${formatRelativeTime(request.createdAt)} · ${formatDateTime(request.expiresAt)} 失效`;
  body.append(title, detail, time);
  const actions = element("div", "row-actions");
  actions.append(
    actionButton("批准", "open-approve-device", { primary: true, busy, requestID: request.id }),
    actionButton("拒绝", "open-reject-device", { busy, requestID: request.id })
  );
  article.append(body, actions);
  return article;
}

function deviceRow(device) {
  const article = element("article", "device-row");
  const body = element("div");
  const title = element("h3");
  title.textContent = device.name;
  const state = element("p", `device-state status-${device.status}`);
  state.textContent = `${device.status === "approved" ? "已批准" : "已撤销"}${device.isRoot ? " · 根设备" : ""}`;
  const time = element("p", "muted tabular");
  time.textContent = device.lastUsedAt
    ? `最近使用 ${formatRelativeTime(device.lastUsedAt)}`
    : `登记于 ${formatDateTime(device.createdAt)}`;
  body.append(title, state, time);
  article.append(body);
  return article;
}

function decisionDialog(dialog, busy) {
  const panel = element("dialog", "decision-dialog");
  panel.setAttribute("aria-labelledby", "device-dialog-title");
  const title = element("h2");
  title.id = "device-dialog-title";
  title.tabIndex = -1;
  title.textContent = dialog.type === "approve" ? "批准设备" : "拒绝设备";
  const intro = element("p");
  intro.textContent = dialog.type === "approve"
    ? `确认“${dialog.request.name}”上的六位校验码与此处输入一致。`
    : `拒绝“${dialog.request.name}”后，该申请将被删除。`;
  const form = element("form", "auth-form");
  form.id = "device-decision-form";
  form.dataset.decision = dialog.type;
  form.dataset.requestId = dialog.request.id;
  const shortCode = inputField("decision-short-code", "shortCode", "六位校验码", {
    maxlength: 6,
    pattern: "[A-Za-z2-9]{6}",
    spellcheck: false
  });
  form.append(shortCode);
  if (dialog.type === "reject") {
    form.append(inputField("decision-reason", "reason", "拒绝原因", { maxlength: 500 }));
  }
  const actions = element("div", "button-row");
  const confirm = element("button", dialog.type === "approve" ? "primary-button" : "secondary-button danger-button");
  confirm.type = "submit";
  confirm.disabled = busy;
  confirm.textContent = busy ? "处理中…" : (dialog.type === "approve" ? "确认批准" : "确认拒绝");
  const cancel = actionButton("取消", "close-device-dialog", { busy });
  actions.append(confirm, cancel);
  form.append(actions);
  panel.append(title, intro, form);
  return panel;
}

function sectionHeading(title, description) {
  const section = element("section", "device-section");
  const heading = element("h2");
  heading.textContent = title;
  const intro = element("p", "muted");
  intro.textContent = description;
  section.append(heading, intro);
  return section;
}

function inputField(id, name, label, { maxlength, pattern, spellcheck } = {}) {
  const wrapper = element("div", "field");
  const labelNode = element("label");
  labelNode.htmlFor = id;
  labelNode.textContent = label;
  const input = element("input");
  input.id = id;
  input.name = name;
  input.required = true;
  input.autocomplete = "off";
  if (maxlength) input.maxLength = maxlength;
  if (pattern) input.pattern = pattern;
  if (spellcheck === false) input.spellcheck = false;
  wrapper.append(labelNode, input);
  return wrapper;
}

function definition(term, value, tabular = false) {
  const wrapper = element("div", "definition-row");
  const dt = element("dt");
  dt.textContent = term;
  const dd = element("dd", tabular ? "tabular" : "");
  dd.textContent = value;
  wrapper.append(dt, dd);
  return wrapper;
}

function emptyState(text) {
  const node = element("p", "empty-state");
  node.textContent = text;
  return node;
}

function statusMessages({ notice, error }) {
  const container = element("div", "status-messages");
  if (notice) {
    const message = element("p", "notice-message");
    message.setAttribute("role", "status");
    message.textContent = notice;
    container.append(message);
  }
  if (error) {
    const message = element("p", "error-summary");
    message.setAttribute("role", "alert");
    message.textContent = error;
    container.append(message);
  }
  return container;
}

function actionButton(label, action, { primary = false, busy = false, requestID = "" } = {}) {
  const button = element("button", primary ? "primary-button" : "secondary-button");
  button.type = "button";
  button.dataset.action = action;
  if (requestID) button.dataset.requestId = requestID;
  button.disabled = busy;
  button.textContent = label;
  return button;
}

function element(tag, className = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
