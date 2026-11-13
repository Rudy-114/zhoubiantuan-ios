import { AdminAPIError, adminFetch } from "./api.js";
import {
  canonicalChallengePayload,
  getOrCreateDeviceIdentity,
  signChallenge
} from "./deviceKeys.js";
import {
  renderLoginView,
  renderRecoveryView,
  renderRootEnrollmentView,
  renderStartupView
} from "./authViews.js";
import { renderPendingDeviceView } from "./deviceViews.js";
import { createWorkspaceController } from "./workspace.js";

export const AuthScreen = Object.freeze({
  LOGIN: "login",
  ROOT_ENROLLMENT: "root_enrollment",
  DEVICE_PENDING: "device_pending",
  RECOVERY: "recovery",
  AUTHENTICATED: "authenticated"
});

const TITLES = Object.freeze({
  [AuthScreen.LOGIN]: "管理员登录 · 周边团安全后台",
  [AuthScreen.ROOT_ENROLLMENT]: "初始化根设备 · 周边团安全后台",
  [AuthScreen.DEVICE_PENDING]: "等待设备批准 · 周边团安全后台",
  [AuthScreen.RECOVERY]: "恢复根设备 · 周边团安全后台",
  [AuthScreen.AUTHENTICATED]: "受信设备 · 周边团安全后台"
});

const app = document.querySelector("#app");
const state = {
  screen: AuthScreen.LOGIN,
  identity: null,
  session: null,
  username: "",
  deviceName: "此浏览器",
  pending: null,
  devices: [],
  requests: [],
  dialog: null,
  notice: "",
  error: "",
  fieldError: "",
  busy: false,
  ready: false,
  suppressUnauthorized: 0
};
const workspace = app ? createWorkspaceController({
  api: adminFetch,
  onRender: render,
  onLoadDevices: loadDeviceData
}) : null;

if (app) {
  app.replaceChildren(renderStartupView());
  app.addEventListener("click", handleClick);
  app.addEventListener("submit", handleSubmit);
  globalThis.addEventListener("keydown", handleKeyDown);
  globalThis.addEventListener("admin:unauthorized", handleUnauthorized);
  globalThis.addEventListener("popstate", () => void workspace?.handlePopState());
  void start();
}

function handleKeyDown(event) {
  if (state.screen !== AuthScreen.AUTHENTICATED || !workspace?.handleKeyDown(event)) return;
  event.preventDefault();
}

async function start() {
  try {
    state.identity = await getOrCreateDeviceIdentity();
    const payload = await adminFetch("/admin/api/auth/session");
    state.session = payload.session;
    state.screen = AuthScreen.AUTHENTICATED;
    await loadDeviceData();
    await workspace?.activate();
  } catch (error) {
    if (!(error instanceof AdminAPIError) || error.status !== 401) state.error = safeMessage(error);
    state.screen = AuthScreen.LOGIN;
  } finally {
    state.ready = true;
    render({ focusHeading: true });
  }
}

function handleClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || !app.contains(button)) return;
  if (state.screen === AuthScreen.AUTHENTICATED && workspace?.handleClick(button)) return;
  const action = button.dataset.action;
  if (action === "toggle-password") return togglePassword(button);
  if (action === "show-login") return navigate(AuthScreen.LOGIN);
  if (action === "show-root-enrollment") return navigate(AuthScreen.ROOT_ENROLLMENT);
  if (action === "show-recovery") return navigate(AuthScreen.RECOVERY);
  if (action === "cancel-device-request") {
    state.pending = null;
    return navigate(AuthScreen.LOGIN, { notice: "设备申请页面已关闭。未获批准前，本设备不能登录。" });
  }
  if (action === "check-device-status") return void checkDeviceStatus();
  if (action === "refresh-device-data") return void refreshDeviceData();
  if (action === "logout") return void logout();
  if (action === "close-device-dialog") {
    state.dialog = null;
    render();
    return;
  }
  if (action === "open-revoke-device") {
    const device = state.devices.find((item) => item.id === button.dataset.deviceId);
    if (!device || device.isRoot || device.status !== "approved") return;
    state.dialog = { type: "revoke", device };
    state.error = "";
    render();
    queueMicrotask(() => app.querySelector("dialog h2")?.focus());
    return;
  }
  if (action === "open-approve-device" || action === "open-reject-device") {
    const request = state.requests.find((item) => item.id === button.dataset.requestId);
    if (!request) return;
    state.dialog = { type: action === "open-approve-device" ? "approve" : "reject", request };
    state.error = "";
    render();
    queueMicrotask(() => app.querySelector("dialog h2")?.focus());
  }
}

function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form));
  if (state.screen === AuthScreen.AUTHENTICATED && workspace?.handleSubmit(form, values)) {
    return;
  }
  if (form.id === "login-form") {
    const intent = event.submitter?.value || "login";
    void (intent === "request" ? requestDevice(values) : login(values));
  } else if (form.id === "root-enrollment-form") {
    void enrollRoot(values);
  } else if (form.id === "recovery-form") {
    void recoverRoot(values);
  } else if (form.id === "device-decision-form") {
    void decideDevice(form, values);
  }
}

async function login({ username, password, displayName }) {
  beginRequest({ username, deviceName: displayName });
  try {
    const challenge = await adminFetch("/admin/api/auth/challenges", {
      method: "POST",
      body: { username, deviceID: state.identity.deviceID, purpose: "login" }
    });
    const signature = await signChallenge(state.identity, canonicalChallengePayload(challenge));
    const payload = await adminFetch("/admin/api/auth/login", {
      method: "POST",
      body: {
        username,
        password,
        deviceID: state.identity.deviceID,
        challengeID: challenge.challengeID,
        nonce: challenge.nonce,
        signature
      }
    });
    state.session = payload.session;
    state.pending = null;
    state.screen = AuthScreen.AUTHENTICATED;
    state.notice = "设备验证成功。";
    await loadDeviceData();
    await workspace?.activate();
    finishRequest({ focusHeading: true });
  } catch (error) {
    failRequest(error, "管理员名、密码或设备验证失败。", AuthScreen.LOGIN);
  }
}

async function requestDevice({ username, password, displayName }) {
  beginRequest({ username, deviceName: displayName });
  try {
    const payload = await adminFetch("/admin/api/auth/device-requests", {
      method: "POST",
      body: deviceRequestBody({ username, password, displayName })
    });
    if (payload.status === "approved") {
      state.screen = AuthScreen.LOGIN;
      state.notice = "根设备已登记。请使用刚登记的设备重新登录。";
    } else {
      state.pending = {
        username,
        deviceName: displayName,
        requestID: payload.requestID,
        shortCode: payload.shortCode,
        expiresAt: payload.expiresAt
      };
      state.screen = AuthScreen.DEVICE_PENDING;
      state.notice = "申请已创建。请把校验码与根设备上的申请逐项核对。";
    }
    finishRequest({ focusHeading: true });
  } catch (error) {
    failRequest(error, "无法创建设备申请。", AuthScreen.LOGIN);
  }
}

async function enrollRoot({ username, password, displayName, bootstrapCode }) {
  beginRequest({ username, deviceName: displayName });
  try {
    await adminFetch("/admin/api/auth/device-requests", {
      method: "POST",
      body: { ...deviceRequestBody({ username, password, displayName }), bootstrapCode }
    });
    state.screen = AuthScreen.LOGIN;
    state.notice = "根设备初始化完成。初始化码已失效，请重新输入密码登录。";
    finishRequest({ focusHeading: true });
  } catch (error) {
    failRequest(error, "根设备初始化失败。", AuthScreen.ROOT_ENROLLMENT);
  }
}

async function recoverRoot({ username, password, recoveryCode, displayName }) {
  beginRequest({ username, deviceName: displayName });
  try {
    await adminFetch("/admin/api/auth/recover", {
      method: "POST",
      body: { ...deviceRequestBody({ username, password, displayName }), recoveryCode }
    });
    state.session = null;
    state.devices = [];
    state.requests = [];
    state.screen = AuthScreen.LOGIN;
    state.notice = "恢复完成：所有旧会话、旧设备和待审批申请均已撤销。本设备已成为新的根设备，请重新登录。";
    finishRequest({ focusHeading: true });
  } catch (error) {
    failRequest(error, "根设备恢复失败。", AuthScreen.RECOVERY);
  }
}

async function checkDeviceStatus() {
  if (!state.pending) return navigate(AuthScreen.LOGIN);
  beginRequest();
  state.suppressUnauthorized += 1;
  try {
    await adminFetch("/admin/api/auth/challenges", {
      method: "POST",
      body: {
        username: state.pending.username,
        deviceID: state.identity.deviceID,
        purpose: "login"
      }
    });
    state.screen = AuthScreen.LOGIN;
    state.notice = "本设备已获批准。请重新输入密码完成登录。";
    state.pending = null;
    finishRequest({ focusHeading: true });
  } catch (error) {
    if (error instanceof AdminAPIError && error.status === 401) {
      state.notice = "尚未检测到批准。请在根设备确认后重试。";
      state.error = "";
      finishRequest();
    } else {
      failRequest(error, "暂时无法检查批准状态。", AuthScreen.DEVICE_PENDING);
    }
  } finally {
    state.suppressUnauthorized = Math.max(0, state.suppressUnauthorized - 1);
  }
}

async function decideDevice(form, values) {
  const decision = form.dataset.decision;
  if (decision === "revoke") return revokeDevice(form, values);
  const request = state.requests.find((item) => item.id === form.dataset.requestId);
  if (!request || !["approve", "reject"].includes(decision)) return;
  beginRequest();
  try {
    if (state.session.deviceID !== state.identity.deviceID) {
      throw new Error("当前会话与本地设备密钥不一致，请退出后重新登录");
    }
    const purpose = decision === "approve" ? "approve_device" : "reject_device";
    const challenge = await adminFetch("/admin/api/auth/challenges", {
      method: "POST",
      body: { purpose, targetID: request.id }
    });
    const signature = await signChallenge(state.identity, canonicalChallengePayload(challenge));
    await adminFetch(`/admin/api/auth/device-requests/${encodeURIComponent(request.id)}/${decision}`, {
      method: "POST",
      body: {
        shortCode: String(values.shortCode || "").trim().toUpperCase(),
        challengeID: challenge.challengeID,
        nonce: challenge.nonce,
        signature,
        ...(decision === "reject" ? { reason: values.reason } : {})
      }
    });
    state.dialog = null;
    state.notice = decision === "approve" ? "设备已批准。" : "设备申请已拒绝并删除。";
    await loadDeviceData();
    finishRequest();
  } catch (error) {
    failRequest(error, decision === "approve" ? "设备批准失败。" : "设备拒绝失败。", AuthScreen.AUTHENTICATED);
  }
}

async function revokeDevice(form, values) {
  const device = state.devices.find((item) => item.id === form.dataset.deviceId);
  if (!device || device.isRoot || device.status !== "approved") return;
  beginRequest();
  try {
    if (state.session.deviceID !== state.identity.deviceID) {
      throw new Error("当前会话与本地设备密钥不一致，请退出后重新登录");
    }
    const challenge = await adminFetch("/admin/api/auth/challenges", {
      method: "POST",
      body: { purpose: "revoke_device", targetID: device.id }
    });
    const signature = await signChallenge(state.identity, canonicalChallengePayload(challenge));
    await adminFetch(`/admin/api/auth/devices/${encodeURIComponent(device.id)}/revoke`, {
      method: "POST",
      body: {
        reason: values.reason,
        challengeID: challenge.challengeID,
        nonce: challenge.nonce,
        signature
      }
    });
    state.dialog = null;
    state.notice = "设备已撤销，该设备的所有会话已失效。";
    await loadDeviceData();
    finishRequest();
  } catch (error) {
    failRequest(error, "设备撤销失败。", AuthScreen.AUTHENTICATED);
  }
}

async function refreshDeviceData() {
  beginRequest();
  try {
    await loadDeviceData();
    state.notice = "设备列表已刷新。";
    finishRequest();
  } catch (error) {
    failRequest(error, "设备列表刷新失败。", AuthScreen.AUTHENTICATED);
  }
}

async function logout() {
  beginRequest();
  try {
    await adminFetch("/admin/api/auth/logout", { method: "POST" });
    state.notice = "已安全退出。设备密钥仍保存在本浏览器中。";
  } catch (error) {
    state.notice = "本地会话已结束。";
    state.error = safeMessage(error, "退出请求未能确认。请刷新页面检查会话状态。");
  }
  state.session = null;
  state.devices = [];
  state.requests = [];
  state.dialog = null;
  state.screen = AuthScreen.LOGIN;
  workspace?.deactivate();
  finishRequest({ focusHeading: true, keepMessages: true });
}

async function loadDeviceData() {
  state.devices = [];
  state.requests = [];
  if (!state.session?.isRoot) return;
  const [devicePayload, requestPayload] = await Promise.all([
    adminFetch("/admin/api/auth/devices"),
    adminFetch("/admin/api/auth/device-requests")
  ]);
  state.devices = devicePayload.devices;
  state.requests = requestPayload.requests;
}

function deviceRequestBody({ username, password, displayName }) {
  return {
    username,
    password,
    deviceID: state.identity.deviceID,
    displayName,
    publicKeyJWK: state.identity.publicKeyJWK
  };
}

function beginRequest({ username, deviceName } = {}) {
  if (username !== undefined) state.username = username;
  if (deviceName !== undefined) state.deviceName = deviceName;
  state.busy = true;
  state.notice = "";
  state.error = "";
  state.fieldError = "";
  render();
}

function finishRequest({ focusHeading = false, keepMessages = true } = {}) {
  state.busy = false;
  if (!keepMessages) {
    state.notice = "";
    state.error = "";
  }
  render({ focusHeading });
}

function failRequest(error, fallback, screen = state.screen) {
  state.busy = false;
  if (screen === AuthScreen.AUTHENTICATED && error instanceof AdminAPIError && error.status === 401) {
    if (state.screen !== AuthScreen.LOGIN) handleUnauthorized();
    return;
  }
  state.screen = screen;
  state.error = safeMessage(error, fallback);
  state.fieldError = screen === AuthScreen.AUTHENTICATED ? "" : state.error;
  render();
  queueMicrotask(() => app.querySelector("[aria-invalid='true']")?.focus());
}

function handleUnauthorized() {
  if (state.suppressUnauthorized > 0 || !state.ready) return;
  state.session = null;
  state.devices = [];
  state.requests = [];
  state.dialog = null;
  state.screen = AuthScreen.LOGIN;
  state.notice = "";
  state.error = "会话已失效，请重新登录。";
  state.fieldError = "";
  workspace?.deactivate();
  render({ focusHeading: true });
}

function navigate(screen, { notice = "" } = {}) {
  state.screen = screen;
  state.notice = notice;
  state.error = "";
  state.fieldError = "";
  state.dialog = null;
  render({ focusHeading: true });
}

function togglePassword(button) {
  const input = document.getElementById(button.dataset.target);
  if (!input || input.tagName !== "INPUT") return;
  const reveal = input.type === "password";
  input.type = reveal ? "text" : "password";
  button.textContent = reveal ? "隐藏" : "显示";
  button.setAttribute("aria-pressed", String(reveal));
  input.focus();
}

function render({ focusHeading = false, focusNavToggle = false } = {}) {
  if (!app) return;
  document.title = state.screen === AuthScreen.AUTHENTICATED
    ? workspace?.getTitle() || TITLES[state.screen]
    : TITLES[state.screen] || "周边团安全后台";
  let view;
  if (!state.ready) {
    view = renderStartupView();
  } else if (state.screen === AuthScreen.ROOT_ENROLLMENT) {
    view = renderRootEnrollmentView(state);
  } else if (state.screen === AuthScreen.RECOVERY) {
    view = renderRecoveryView(state);
  } else if (state.screen === AuthScreen.DEVICE_PENDING) {
    view = renderPendingDeviceView(state);
  } else if (state.screen === AuthScreen.AUTHENTICATED) {
    view = workspace.renderView({
      session: state.session,
      devices: state.devices,
      requests: state.requests,
      deviceDialog: state.dialog,
      deviceNotice: state.notice,
      deviceError: state.error,
      deviceBusy: state.busy
    });
  } else {
    view = renderLoginView(state);
  }
  app.replaceChildren(view);
  const dialog = view.querySelector("dialog");
  if (dialog && !dialog.open) {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!workspace?.closeDialog()) {
        state.dialog = null;
        render();
      }
    }, { once: true });
    dialog.addEventListener("keydown", trapDialogFocus);
    dialog.showModal();
  }
  if (focusHeading) {
    queueMicrotask(() => [
      view.querySelector(".mobile-inspector-page-title"),
      view.querySelector(".case-inspector h2"),
      ...view.querySelectorAll("h1")
    ].find((heading) => heading?.getClientRects().length > 0)?.focus());
  } else if (focusNavToggle) {
    queueMicrotask(() => view.querySelector(".nav-toggle")?.focus());
  }
}

function trapDialogFocus(event) {
  if (event.key !== "Tab") return;
  const dialog = event.currentTarget;
  const focusable = [...dialog.querySelectorAll(
    "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"
  )].filter((element) => element.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const activeIndex = focusable.indexOf(document.activeElement);
  const shouldWrapBackward = event.shiftKey && activeIndex <= 0;
  const shouldWrapForward = !event.shiftKey && (activeIndex < 0 || activeIndex === focusable.length - 1);
  if (!shouldWrapBackward && !shouldWrapForward) return;
  event.preventDefault();
  (shouldWrapBackward ? focusable.at(-1) : focusable[0]).focus();
}

function safeMessage(error, fallback = "管理员服务暂时不可用。") {
  if (error instanceof AdminAPIError) return error.message || fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
