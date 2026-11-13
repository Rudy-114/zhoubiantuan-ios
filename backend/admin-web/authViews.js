export function renderLoginView({
  username = "",
  deviceName = "",
  notice = "",
  error = "",
  fieldError = "",
  busy = false
} = {}) {
  const main = authFrame(
    "管理员登录",
    "登录需要密码、本浏览器中不可导出的设备密钥，以及服务端签发的一次性挑战。"
  );
  main.append(statusMessages({ notice, error }));
  main.append(form({ id: "login-form", busy }, [
    field({ id: "login-username", name: "username", label: "管理员名", value: username,
      autocomplete: "username", maxlength: 64 }),
    passwordField({ id: "login-password", name: "password", label: "密码",
      autocomplete: "current-password", error: fieldError }),
    field({ id: "login-device-name", name: "displayName", label: "本设备名称",
      hint: "仅在申请新设备时提交；例如“办公室 Mac”。", value: deviceName,
      autocomplete: "off", maxlength: 80 }),
    buttonRow([
      actionButton("登录", { value: "login", primary: true, busy }),
      actionButton("申请新设备", { value: "request", busy })
    ])
  ]));
  main.append(linkActions([
    ["首次初始化根设备", "show-root-enrollment"],
    ["根设备丢失或不可用", "show-recovery"]
  ]));
  return main;
}

export function renderRootEnrollmentView({
  username = "",
  deviceName = "",
  notice = "",
  error = "",
  fieldError = "",
  busy = false
} = {}) {
  const main = authFrame(
    "初始化根设备",
    "此操作仅用于尚无任何受信设备的管理员账户。初始化码只能使用一次。"
  );
  main.append(statusMessages({ notice, error }));
  main.append(form({ id: "root-enrollment-form", busy }, [
    field({ id: "enrollment-username", name: "username", label: "管理员名", value: username,
      autocomplete: "username", maxlength: 64 }),
    passwordField({ id: "enrollment-password", name: "password", label: "密码",
      autocomplete: "current-password" }),
    field({ id: "enrollment-device-name", name: "displayName", label: "根设备名称",
      value: deviceName, autocomplete: "off", maxlength: 80 }),
    field({ id: "enrollment-bootstrap", name: "bootstrapCode", label: "一次性初始化码",
      autocomplete: "off", spellcheck: false, maxlength: 128, error: fieldError }),
    buttonRow([actionButton("登记根设备", { primary: true, busy })])
  ]));
  main.append(linkActions([["返回登录", "show-login"]]));
  return main;
}

export function renderRecoveryView({
  username = "",
  deviceName = "",
  notice = "",
  error = "",
  fieldError = "",
  busy = false
} = {}) {
  const main = authFrame(
    "恢复根设备",
    "恢复成功会立即撤销所有旧会话、旧设备和待审批申请，并把本浏览器登记为新的根设备。"
  );
  const warning = element("p", "destructive-warning");
  warning.textContent = "这是高影响操作。确认旧根设备已无法安全使用后再继续。";
  main.append(warning, statusMessages({ notice, error }));
  main.append(form({ id: "recovery-form", busy }, [
    field({ id: "recovery-username", name: "username", label: "管理员名", value: username,
      autocomplete: "username", maxlength: 64 }),
    passwordField({ id: "recovery-password", name: "password", label: "密码",
      autocomplete: "current-password" }),
    field({ id: "recovery-code", name: "recoveryCode", label: "一次性恢复码",
      autocomplete: "off", spellcheck: false, maxlength: 128, error: fieldError }),
    field({ id: "recovery-device-name", name: "displayName", label: "新根设备名称",
      value: deviceName, autocomplete: "off", maxlength: 80 }),
    buttonRow([actionButton("撤销旧设备并恢复", { primary: true, danger: true, busy })])
  ]));
  main.append(linkActions([["返回登录", "show-login"]]));
  return main;
}

export function renderStartupView(message = "正在检查本设备…") {
  const main = authFrame("安全后台", message);
  main.setAttribute("aria-busy", "true");
  return main;
}

function authFrame(title, description) {
  const shell = element("main", "auth-layout");
  shell.id = "workspace";
  const brand = element("p", "auth-brand");
  brand.textContent = "周边团 · 安全后台";
  const heading = element("h1");
  heading.tabIndex = -1;
  heading.textContent = title;
  const intro = element("p", "auth-intro");
  intro.textContent = description;
  shell.append(brand, heading, intro);
  return shell;
}

function form({ id, busy }, children) {
  const node = element("form", "auth-form");
  node.id = id;
  node.noValidate = false;
  if (busy) node.setAttribute("aria-busy", "true");
  node.append(...children);
  return node;
}

function field({
  id,
  name,
  label,
  value = "",
  hint = "",
  error = "",
  autocomplete,
  maxlength,
  spellcheck
} = {}) {
  const wrapper = element("div", "field");
  const labelNode = element("label");
  labelNode.htmlFor = id;
  labelNode.textContent = label;
  const input = element("input");
  input.id = id;
  input.name = name;
  input.value = value;
  input.required = true;
  if (autocomplete) input.autocomplete = autocomplete;
  if (maxlength) input.maxLength = maxlength;
  if (spellcheck === false) input.spellcheck = false;
  wrapper.append(labelNode, input);
  const descriptions = [];
  if (hint) {
    const hintNode = element("p", "field-hint");
    hintNode.id = `${id}-hint`;
    hintNode.textContent = hint;
    descriptions.push(hintNode.id);
    wrapper.append(hintNode);
  }
  if (error) {
    const errorNode = element("p", "field-error");
    errorNode.id = `${id}-error`;
    errorNode.textContent = error;
    descriptions.push(errorNode.id);
    input.setAttribute("aria-invalid", "true");
    wrapper.append(errorNode);
  }
  if (descriptions.length) input.setAttribute("aria-describedby", descriptions.join(" "));
  return wrapper;
}

function passwordField({ id, name, label, autocomplete, error = "" }) {
  const wrapper = element("div", "field");
  const labelNode = element("label");
  labelNode.htmlFor = id;
  labelNode.textContent = label;
  const controls = element("div", "password-controls");
  const input = element("input");
  input.id = id;
  input.name = name;
  input.type = "password";
  input.required = true;
  input.maxLength = 256;
  input.autocomplete = autocomplete;
  if (error) {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", `${id}-error`);
  }
  const reveal = element("button", "quiet-button");
  reveal.type = "button";
  reveal.dataset.action = "toggle-password";
  reveal.dataset.target = id;
  reveal.setAttribute("aria-controls", id);
  reveal.setAttribute("aria-pressed", "false");
  reveal.textContent = "显示";
  controls.append(input, reveal);
  wrapper.append(labelNode, controls);
  if (error) {
    const errorNode = element("p", "field-error");
    errorNode.id = `${id}-error`;
    errorNode.textContent = error;
    wrapper.append(errorNode);
  }
  return wrapper;
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

function actionButton(label, { value, primary = false, danger = false, busy = false } = {}) {
  const button = element("button", primary ? "primary-button" : "secondary-button");
  button.type = "submit";
  button.name = "intent";
  if (value) button.value = value;
  button.disabled = busy;
  if (danger) button.classList.add("danger-button");
  button.textContent = busy && primary ? "处理中…" : label;
  return button;
}

function buttonRow(buttons) {
  const row = element("div", "button-row");
  row.append(...buttons);
  return row;
}

function linkActions(items) {
  const nav = element("nav", "auth-links");
  nav.setAttribute("aria-label", "其他认证方式");
  for (const [label, action] of items) {
    const button = element("button", "text-button");
    button.type = "button";
    button.dataset.action = action;
    button.textContent = label;
    nav.append(button);
  }
  return nav;
}

function element(tag, className = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
