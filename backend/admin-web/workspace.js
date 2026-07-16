import { formatRelativeTime, riskLabel, statusLabel } from "./formatters.js";
import { renderCaseWorkspace } from "./caseViews.js";
import { renderModerationWorkspace } from "./moderationViews.js";
import { renderAuditWorkspace, renderUserRiskWorkspace } from "./auditViews.js";
import { renderAIHealthWorkspace } from "./aiViews.js";
import { renderDeviceManagementPanel } from "./deviceViews.js";

export const WorkspaceRoute = Object.freeze({
  OVERVIEW: "overview",
  CASES: "cases",
  AUTOMATIC: "automatic",
  CORRECTIONS: "corrections",
  APPEALS: "appeals",
  MODERATION: "moderation",
  USER_RISK: "user_risk",
  AUDIT: "audit",
  DEVICES: "devices",
  AI_HEALTH: "ai_health"
});

export const CASE_STATUSES = Object.freeze([
  "received",
  "triaging",
  "monitoring",
  "manual_review",
  "awaiting_correction",
  "rechecking",
  "appealed",
  "resolved_no_action",
  "resolved_restored",
  "resolved_actioned"
]);

export const SUBJECT_TYPES = Object.freeze([
  "post", "comment", "user", "direct_message", "collection"
]);

export const CASE_CATEGORIES = Object.freeze([
  "suspected_scam",
  "false_or_expired_group_buy",
  "invalid_contact",
  "copyright_or_stolen_media",
  "harassment_or_abuse",
  "sexual_or_illegal",
  "spam_or_advertising",
  "direct_message_risk",
  "other"
]);

export const RISK_LEVELS = Object.freeze(["none", "low", "medium", "high", "urgent"]);
export const CASE_SORTS = Object.freeze(["urgent", "oldest", "newest", "deadline"]);

const ROUTE_PATHS = Object.freeze({
  [WorkspaceRoute.OVERVIEW]: "/admin",
  [WorkspaceRoute.CASES]: "/admin/cases",
  [WorkspaceRoute.AUTOMATIC]: "/admin/automatic-actions",
  [WorkspaceRoute.CORRECTIONS]: "/admin/corrections",
  [WorkspaceRoute.APPEALS]: "/admin/appeals",
  [WorkspaceRoute.MODERATION]: "/admin/moderation",
  [WorkspaceRoute.USER_RISK]: "/admin/user-risk",
  [WorkspaceRoute.AUDIT]: "/admin/audit",
  [WorkspaceRoute.DEVICES]: "/admin/devices",
  [WorkspaceRoute.AI_HEALTH]: "/admin/ai-health"
});

const FILTER_FIELDS = Object.freeze([
  ["status", new Set(CASE_STATUSES)],
  ["subjectType", new Set(SUBJECT_TYPES)],
  ["category", new Set(CASE_CATEGORIES)],
  ["riskLevel", new Set(RISK_LEVELS)],
  ["sort", new Set(CASE_SORTS)]
]);

export function serializeCaseFilters(filters = {}, { cursor = "", limit = 50 } = {}) {
  const params = new URLSearchParams();
  for (const [field, allowed] of FILTER_FIELDS) {
    const value = filters?.[field];
    if (typeof value === "string" && allowed.has(value)) params.set(field, value);
  }
  if (!params.has("sort")) params.set("sort", "urgent");
  const boundedLimit = Number.isInteger(Number(limit))
    ? Math.min(100, Math.max(1, Number(limit)))
    : 50;
  params.set("limit", String(boundedLimit));
  if (typeof cursor === "string" && cursor) params.set("cursor", cursor);
  return params.toString();
}

export function isLatestRequest(currentSequence, responseSequence) {
  return Number.isInteger(currentSequence) && currentSequence === responseSequence;
}

export function parseWorkspaceRoute(pathname = "/admin") {
  const path = typeof pathname === "string" ? pathname.replace(/\/+$/u, "") || "/" : "/";
  if (path === "/admin" || path === "/admin/") return { route: WorkspaceRoute.OVERVIEW, caseID: "" };
  const caseMatch = path.match(/^\/admin\/cases\/([^/]+)$/u);
  if (caseMatch) {
    try {
      return { route: WorkspaceRoute.CASES, caseID: decodeURIComponent(caseMatch[1]) };
    } catch {
      return { route: WorkspaceRoute.OVERVIEW, caseID: "" };
    }
  }
  const route = Object.entries(ROUTE_PATHS)
    .find(([, routePath]) => routePath === path)?.[0];
  return { route: route || WorkspaceRoute.OVERVIEW, caseID: "" };
}

export function workspacePath(route, caseID = "") {
  if (route === WorkspaceRoute.CASES && caseID) {
    return `/admin/cases/${encodeURIComponent(caseID)}`;
  }
  return ROUTE_PATHS[route] || ROUTE_PATHS[WorkspaceRoute.OVERVIEW];
}

export function dueLabel(value, { now = new Date() } = {}) {
  if (!value) return "无截止时间";
  const due = new Date(value);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(due.getTime()) || Number.isNaN(current.getTime())) return "无截止时间";
  if (due.getTime() < current.getTime()) {
    return `已逾期 ${formatRelativeTime(value, { now: current }).replace(/前$/u, "")}`;
  }
  return `${formatRelativeTime(value, { now: current }).replace(/后$/u, "")}后到期`;
}

export function caseMatchesSearch(safetyCase, search) {
  const query = String(search || "").trim().toLocaleLowerCase("zh-CN");
  if (!query) return true;
  return [safetyCase?.subjectTitle, safetyCase?.subjectID, safetyCase?.id]
    .some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(query));
}

export function revealedEvidence(metadata, revealMap) {
  const reveal = revealMap instanceof Map ? revealMap.get(metadata?.id) : null;
  return {
    metadata,
    revealed: reveal?.evidence || null,
    accessReason: reveal?.reason || ""
  };
}

const NAV_ITEMS = Object.freeze([
  [WorkspaceRoute.OVERVIEW, "总览"],
  [WorkspaceRoute.CASES, "全部案件"],
  [WorkspaceRoute.AUTOMATIC, "自动动作"],
  [WorkspaceRoute.CORRECTIONS, "整改"],
  [WorkspaceRoute.APPEALS, "申诉"],
  [WorkspaceRoute.MODERATION, "发布审核"],
  [WorkspaceRoute.USER_RISK, "用户风险"],
  [WorkspaceRoute.AUDIT, "审计"],
  [WorkspaceRoute.DEVICES, "受信设备"],
  [WorkspaceRoute.AI_HEALTH, "AI 健康"]
]);

const WORKLOAD_ITEMS = Object.freeze([
  ["manual_review", "人工复核", WorkspaceRoute.CASES, { status: "manual_review" }],
  ["auto_action", "自动动作", WorkspaceRoute.AUTOMATIC, {}],
  ["awaiting_correction", "等待整改", WorkspaceRoute.CORRECTIONS, {}],
  ["appealed", "待处理申诉", WorkspaceRoute.APPEALS, {}],
  ["ai_failed", "AI 失败", WorkspaceRoute.AI_HEALTH, {}],
  ["overdue", "已逾期", WorkspaceRoute.CORRECTIONS, {}]
]);

export function createWorkspaceController({ api, onRender, onLoadDevices } = {}) {
  if (typeof api !== "function" || typeof onRender !== "function") {
    throw new TypeError("工作区控制器参数无效");
  }
  const state = {
    active: false,
    route: WorkspaceRoute.OVERVIEW,
    selectedCaseID: "",
    caseReturnRoute: restoredCaseReturnRoute(globalThis.history?.state?.workspaceCaseReturnRoute),
    filters: restoredFilters(globalThis.history?.state?.workspaceFilters),
    search: "",
    cases: [],
    counts: emptyCounts(),
    nextCursor: null,
    detail: null,
    revealMap: new Map(),
    moderationReviews: [],
    moderationStatus: "review",
    auditEvents: [],
    auditEventType: "",
    auditNextCursor: null,
    aiHealth: null,
    dialog: null,
    mobileNavOpen: false,
    loading: false,
    busy: false,
    notice: "",
    error: "",
    listSequence: 0,
    detailSequence: 0,
    auditSequence: 0,
    aiHealthSequence: 0,
    moderationSequence: 0,
    countsSequence: 0
  };

  return {
    activate,
    deactivate,
    renderView,
    handleClick,
    handleSubmit,
    handlePopState,
    closeDialog,
    getTitle: () => `${routeTitle(displayRoute())} · 周边团安全后台`,
    getState: () => state
  };

  async function activate() {
    const parsed = parseWorkspaceRoute(globalThis.location?.pathname);
    const routeChanged = state.route !== parsed.route || state.selectedCaseID !== parsed.caseID;
    state.active = true;
    state.route = parsed.route;
    state.selectedCaseID = parsed.caseID;
    state.caseReturnRoute = parsed.caseID
      ? restoredCaseReturnRoute(globalThis.history?.state?.workspaceCaseReturnRoute)
      : "";
    if (routeChanged || (!state.cases.length && !state.loading)) await loadRoute({ reset: true });
  }

  function deactivate() {
    state.active = false;
    state.dialog = null;
    state.detail = null;
    state.caseReturnRoute = "";
    state.revealMap = new Map();
    state.cases = [];
    state.counts = emptyCounts();
    state.nextCursor = null;
    state.moderationReviews = [];
    state.auditEvents = [];
    state.auditNextCursor = null;
    state.aiHealth = null;
    state.listSequence += 1;
    state.detailSequence += 1;
    state.auditSequence += 1;
    state.aiHealthSequence += 1;
    state.moderationSequence += 1;
    state.countsSequence += 1;
  }

  function renderView({ session, devices = [], requests = [], deviceDialog = null,
    deviceNotice = "", deviceError = "", deviceBusy = false } = {}) {
    const content = routeContent({
      session,
      devices,
      requests,
      deviceDialog,
      deviceNotice,
      deviceError,
      deviceBusy
    });
    return workspaceShell({ session, content });
  }

  function handleClick(button) {
    const action = button?.dataset?.action;
    if (!action) return false;
    if (action === "toggle-workspace-nav") {
      state.mobileNavOpen = !state.mobileNavOpen;
      requestRender();
      return true;
    }
    if (action === "workspace-route") {
      void navigate(button.dataset.route);
      return true;
    }
    if (action === "workload-route") {
      const filters = safeHistoryFilters(button.dataset.filters);
      state.filters = { ...state.filters, ...filters };
      void navigate(button.dataset.route);
      return true;
    }
    if (action === "refresh-cases") {
      void loadCases({ reset: true });
      return true;
    }
    if (action === "load-more-cases") {
      void loadCases({ reset: false });
      return true;
    }
    if (action === "open-case") {
      void openCase(button.dataset.caseId);
      return true;
    }
    if (action === "close-case") {
      closeCase();
      return true;
    }
    if (action === "open-evidence-dialog") {
      const evidence = state.detail?.evidence?.find((item) => item.id === button.dataset.evidenceId);
      if (evidence) {
        state.dialog = { kind: "evidence", evidence };
        state.error = "";
        requestRender();
      }
      return true;
    }
    if (action === "open-report-abuse") {
      const report = state.detail?.reports?.find((item) => item.id === button.dataset.reportId);
      if (report && report.status !== "invalid") {
        state.dialog = { kind: "report_abuse", report };
        state.error = "";
        requestRender();
      }
      return true;
    }
    if (action === "open-case-decision") {
      if (state.detail) {
        state.dialog = { kind: "decision", decision: button.dataset.decision };
        state.error = "";
        requestRender();
      }
      return true;
    }
    if (action === "close-workspace-dialog") {
      closeDialog();
      return true;
    }
    if (action === "refresh-moderation") {
      void loadModeration();
      return true;
    }
    if (action === "open-moderation-decision") {
      const review = state.moderationReviews.find((item) => item.id === button.dataset.reviewId);
      if (review) {
        state.dialog = { kind: "moderation", review, decision: button.dataset.decision };
        requestRender();
      }
      return true;
    }
    if (action === "refresh-audit") {
      void loadAudit({ reset: true });
      return true;
    }
    if (action === "load-more-audit") {
      void loadAudit({ reset: false });
      return true;
    }
    if (action === "refresh-ai-health") {
      void loadAIHealth();
      return true;
    }
    return false;
  }

  function handleSubmit(form, values) {
    if (form.id === "case-filter-form") {
      state.filters = normalizeFilters(values);
      state.search = String(values.search || "").trim();
      saveFilters(state.filters);
      void loadCases({ reset: true });
      return true;
    }
    if (form.id === "evidence-reveal-form") {
      void revealCaseEvidence(form, values);
      return true;
    }
    if (form.id === "case-decision-form") {
      void submitCaseDecision(form, values);
      return true;
    }
    if (form.id === "report-abuse-form") {
      void submitReportAbuse(form, values);
      return true;
    }
    if (form.id === "moderation-filter-form") {
      state.moderationStatus = String(values.status || "review");
      void loadModeration();
      return true;
    }
    if (form.id === "moderation-decision-form") {
      void submitModerationDecision(form, values);
      return true;
    }
    if (form.id === "audit-filter-form") {
      state.auditEventType = String(values.eventType || "").trim();
      void loadAudit({ reset: true });
      return true;
    }
    if (form.id === "ai-evaluation-form") {
      void submitAIEvaluation(form, values);
      return true;
    }
    return false;
  }

  async function handlePopState() {
    if (!state.active) return;
    const parsed = parseWorkspaceRoute(globalThis.location?.pathname);
    state.aiHealthSequence += 1;
    state.route = parsed.route;
    state.selectedCaseID = parsed.caseID;
    state.caseReturnRoute = parsed.caseID
      ? restoredCaseReturnRoute(globalThis.history?.state?.workspaceCaseReturnRoute)
      : "";
    state.filters = restoredFilters(globalThis.history?.state?.workspaceFilters);
    state.dialog = null;
    state.mobileNavOpen = false;
    await loadRoute({ reset: true });
  }

  function closeDialog() {
    if (!state.dialog) return false;
    state.dialog = null;
    requestRender();
    return true;
  }

  async function navigate(route) {
    if (!Object.values(WorkspaceRoute).includes(route)) return;
    state.aiHealthSequence += 1;
    state.route = route;
    state.selectedCaseID = "";
    state.caseReturnRoute = "";
    state.detail = null;
    state.revealMap = new Map();
    state.dialog = null;
    state.mobileNavOpen = false;
    if (route !== WorkspaceRoute.CASES) {
      state.search = "";
      state.filters = { sort: "urgent" };
    }
    globalThis.history?.pushState?.({
      ...(globalThis.history.state || {}),
      workspaceFilters: state.filters,
      workspaceCaseReturnRoute: null
    }, "", workspacePath(route));
    await loadRoute({ reset: true });
  }

  async function loadRoute({ reset }) {
    state.notice = "";
    state.error = "";
    if (state.route === WorkspaceRoute.MODERATION) {
      await Promise.all([loadWorkloadCounts(), loadModeration()]);
      return;
    }
    if (state.route === WorkspaceRoute.AUDIT) {
      await Promise.all([loadWorkloadCounts(), loadAudit({ reset: true })]);
      return;
    }
    if (state.route === WorkspaceRoute.AI_HEALTH) {
      await Promise.all([loadWorkloadCounts(), loadAIHealth()]);
      return;
    }
    if (state.route === WorkspaceRoute.DEVICES) {
      state.loading = true;
      requestRender();
      try {
        await Promise.all([loadWorkloadCounts(), onLoadDevices?.()]);
      } catch (error) {
        state.error = messageFor(error, "设备列表加载失败。");
      } finally {
        state.loading = false;
        requestRender({ focusHeading: true });
      }
      return;
    }
    await loadCases({ reset });
    if (state.selectedCaseID) await loadCaseDetail(state.selectedCaseID);
  }

  async function loadCases({ reset = true } = {}) {
    state.countsSequence += 1;
    const sequence = ++state.listSequence;
    const filters = filtersForRoute();
    const cursor = reset ? "" : state.nextCursor || "";
    if (!reset && !cursor) return;
    state.loading = true;
    state.error = "";
    if (reset) state.nextCursor = null;
    requestRender();
    try {
      const query = serializeCaseFilters(filters, {
        cursor,
        limit: displayRoute() === WorkspaceRoute.OVERVIEW ? 12 : 50
      });
      const payload = await api(`/admin/api/cases?${query}`);
      if (!isLatestRequest(state.listSequence, sequence)) return;
      state.cases = reset ? payload.cases : [...state.cases, ...payload.cases];
      state.counts = { ...emptyCounts(), ...(payload.counts || {}) };
      state.nextCursor = payload.nextCursor;
    } catch (error) {
      if (isLatestRequest(state.listSequence, sequence)) {
        state.error = messageFor(error, "案件队列加载失败。");
      }
    } finally {
      if (isLatestRequest(state.listSequence, sequence)) {
        state.loading = false;
        requestRender({ focusHeading: reset });
      }
    }
  }

  async function loadWorkloadCounts() {
    const sequence = ++state.countsSequence;
    try {
      const payload = await api(`/admin/api/cases?${serializeCaseFilters({}, { limit: 1 })}`);
      if (isLatestRequest(state.countsSequence, sequence)) {
        state.counts = { ...emptyCounts(), ...(payload.counts || {}) };
      }
    } catch (error) {
      if (isLatestRequest(state.countsSequence, sequence)) {
        state.error = messageFor(error, "实时工作量加载失败。");
      }
    } finally {
      if (isLatestRequest(state.countsSequence, sequence)) requestRender();
    }
  }

  async function openCase(caseID) {
    if (typeof caseID !== "string" || !caseID) return;
    const returnRoute = state.selectedCaseID && state.caseReturnRoute
      ? state.caseReturnRoute
      : state.route;
    state.route = WorkspaceRoute.CASES;
    state.selectedCaseID = caseID;
    state.caseReturnRoute = returnRoute;
    state.dialog = null;
    state.detail = state.detail?.id === caseID ? state.detail : null;
    globalThis.history?.pushState?.({
      ...(globalThis.history.state || {}),
      workspaceFilters: state.filters,
      workspaceCaseReturnRoute: returnRoute
    }, "", workspacePath(WorkspaceRoute.CASES, caseID));
    requestRender();
    await loadCaseDetail(caseID);
  }

  function closeCase() {
    const returnRoute = state.caseReturnRoute || WorkspaceRoute.CASES;
    state.route = returnRoute;
    state.selectedCaseID = "";
    state.caseReturnRoute = "";
    state.detail = null;
    state.dialog = null;
    state.revealMap = new Map();
    globalThis.history?.pushState?.({
      ...(globalThis.history.state || {}),
      workspaceFilters: state.filters,
      workspaceCaseReturnRoute: null
    }, "", workspacePath(returnRoute));
    requestRender({ focusHeading: true });
  }

  async function loadCaseDetail(caseID) {
    const sequence = ++state.detailSequence;
    state.loading = true;
    state.error = "";
    requestRender();
    try {
      const payload = await api(`/admin/api/cases/${encodeURIComponent(caseID)}`);
      if (!isLatestRequest(state.detailSequence, sequence)) return;
      state.detail = payload.case;
      state.revealMap = new Map();
    } catch (error) {
      if (isLatestRequest(state.detailSequence, sequence)) {
        state.error = messageFor(error, "案件详情加载失败。");
      }
    } finally {
      if (isLatestRequest(state.detailSequence, sequence)) {
        state.loading = false;
        requestRender({ focusHeading: true });
      }
    }
  }

  async function revealCaseEvidence(form, values) {
    if (!state.detail || form.dataset.caseId !== state.detail.id) return;
    const evidenceID = form.dataset.evidenceId;
    const reason = String(values.reason || "").trim();
    state.busy = true;
    state.error = "";
    requestRender();
    try {
      const payload = await api(
        `/admin/api/cases/${encodeURIComponent(state.detail.id)}/evidence/${encodeURIComponent(evidenceID)}?reason=${encodeURIComponent(reason)}`
      );
      state.revealMap.set(evidenceID, { evidence: payload.evidence, reason });
      state.dialog = null;
      state.notice = "证据已按理由解锁并记录审计。";
    } catch (error) {
      state.error = messageFor(error, "证据查看失败。");
    } finally {
      state.busy = false;
      requestRender();
    }
  }

  async function submitCaseDecision(form, values) {
    if (!state.detail || form.dataset.caseId !== state.detail.id) return;
    const decision = form.dataset.decision;
    state.busy = true;
    state.error = "";
    requestRender();
    try {
      const isUserDecision = decision === "restrict_user" || decision === "restore_user";
      const path = isUserDecision
        ? `/admin/api/cases/${encodeURIComponent(state.detail.id)}/restrict-user`
        : `/admin/api/cases/${encodeURIComponent(state.detail.id)}/decision`;
      const body = isUserDecision
        ? {
            userID: values.userID,
            restricted: decision === "restrict_user",
            reason: values.reason,
            expectedVersion: state.detail.version
          }
        : {
            decision,
            reason: values.reason,
            expectedVersion: state.detail.version
          };
      const payload = await api(path, { method: "POST", body });
      const aiComparison = state.detail.aiComparison;
      state.detail = {
        ...payload.case,
        aiComparison: aiComparison ? { ...aiComparison, humanDecision: null } : aiComparison
      };
      state.revealMap = new Map();
      reconcileCase(payload.case);
      state.dialog = null;
      state.notice = "人工决定已提交，页面已按服务端结果更新。";
    } catch (error) {
      if (error?.status === 409 && error?.code === "case_changed") {
        state.dialog = null;
        await loadCaseDetail(state.detail.id);
        state.error = "案件在处理期间发生变化，已重新加载，请再次核对。";
      } else {
        state.error = messageFor(error, "人工决定提交失败。");
      }
    } finally {
      state.busy = false;
      requestRender();
    }
  }

  async function submitReportAbuse(form, values) {
    if (!state.detail || form.dataset.caseId !== state.detail.id) return;
    const reportID = form.dataset.reportId;
    const report = state.detail.reports?.find((item) => item.id === reportID);
    if (!report || report.status === "invalid") return;
    state.busy = true;
    state.error = "";
    requestRender();
    try {
      const payload = await api(
        `/admin/api/cases/${encodeURIComponent(state.detail.id)}/reports/${encodeURIComponent(reportID)}/invalidate`,
        {
          method: "POST",
          body: {
            reason: String(values.reason || ""),
            confirmed: values.confirmed === "on" || values.confirmed === true,
            expectedVersion: state.detail.version
          }
        }
      );
      const aiComparison = state.detail.aiComparison;
      state.detail = { ...payload.case, aiComparison };
      reconcileCase(payload.case);
      state.dialog = null;
      state.notice = "当前举报已标记无效，证据和其他线索仍保留。";
    } catch (error) {
      if (error?.status === 409 && error?.code === "case_changed") {
        state.dialog = null;
        await loadCaseDetail(state.detail.id);
        state.error = "案件在处理期间发生变化，已重新加载，请再次核对。";
      } else {
        state.error = messageFor(error, "举报滥用标记失败。");
      }
    } finally {
      state.busy = false;
      requestRender();
    }
  }

  async function loadModeration() {
    const sequence = ++state.moderationSequence;
    state.loading = true;
    state.error = "";
    requestRender();
    try {
      const payload = await api(`/admin/api/moderation-reviews?status=${encodeURIComponent(state.moderationStatus)}`);
      if (!isLatestRequest(state.moderationSequence, sequence)) return;
      state.moderationReviews = payload.reviews;
    } catch (error) {
      if (isLatestRequest(state.moderationSequence, sequence)) {
        state.error = messageFor(error, "发布审核队列加载失败。");
      }
    } finally {
      if (isLatestRequest(state.moderationSequence, sequence)) {
        state.loading = false;
        requestRender({ focusHeading: true });
      }
    }
  }

  async function submitModerationDecision(form, values) {
    const review = state.moderationReviews.find((item) => item.id === form.dataset.reviewId);
    if (!review) return;
    state.busy = true;
    state.error = "";
    requestRender();
    try {
      const payload = await api(
        `/admin/api/moderation-reviews/${encodeURIComponent(review.id)}/decision`,
        { method: "POST", body: { decision: form.dataset.decision, reason: values.reason } }
      );
      state.moderationReviews = state.moderationReviews
        .map((item) => item.id === payload.review.id ? payload.review : item)
        .filter((item) => state.moderationStatus === "all" || item.status === state.moderationStatus);
      state.dialog = null;
      state.notice = "发布审核决定已应用并记录审计。";
    } catch (error) {
      state.error = messageFor(error, "发布审核决定失败。");
    } finally {
      state.busy = false;
      requestRender();
    }
  }

  async function loadAudit({ reset = true } = {}) {
    const sequence = ++state.auditSequence;
    const cursor = reset ? "" : state.auditNextCursor || "";
    if (!reset && !cursor) return;
    state.loading = true;
    state.error = "";
    requestRender();
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (state.auditEventType) params.set("eventType", state.auditEventType);
      if (cursor) params.set("cursor", cursor);
      const payload = await api(`/admin/api/audit-events?${params}`);
      if (!isLatestRequest(state.auditSequence, sequence)) return;
      state.auditEvents = reset ? payload.events : [...state.auditEvents, ...payload.events];
      state.auditNextCursor = payload.nextCursor;
    } catch (error) {
      if (isLatestRequest(state.auditSequence, sequence)) {
        state.error = messageFor(error, "审计记录加载失败。");
      }
    } finally {
      if (isLatestRequest(state.auditSequence, sequence)) {
        state.loading = false;
        requestRender({ focusHeading: reset });
      }
    }
  }

  async function loadAIHealth() {
    const sequence = ++state.aiHealthSequence;
    state.loading = true;
    state.error = "";
    requestRender();
    try {
      const payload = await api("/admin/api/ai-health");
      if (!isLatestRequest(state.aiHealthSequence, sequence)) return;
      state.aiHealth = payload;
    } catch (error) {
      if (isLatestRequest(state.aiHealthSequence, sequence)) {
        state.error = messageFor(error, "AI 健康状态加载失败。");
      }
    } finally {
      if (isLatestRequest(state.aiHealthSequence, sequence)) {
        state.loading = false;
        requestRender({ focusHeading: true });
      }
    }
  }

  async function submitAIEvaluation(form, values) {
    if (!state.detail || form.dataset.caseId !== state.detail.id ||
        form.dataset.aiRunId !== state.detail.aiComparison?.run?.id) return;
    const caseID = state.detail.id;
    const aiRunID = form.dataset.aiRunId;
    const isCurrentEvaluation = () => state.detail?.id === caseID &&
      state.detail.aiComparison?.run?.id === aiRunID;
    state.busy = true;
    state.error = "";
    requestRender();
    try {
      const payload = await api(
        `/admin/api/cases/${encodeURIComponent(caseID)}/ai-evaluation`,
        {
          method: "POST",
          body: {
            aiRunID,
            categoryCorrect: values.categoryCorrect === "true",
            actionCorrect: values.actionCorrect === "true",
            scopeExpansionError: values.scopeExpansionError === "on",
            notes: String(values.notes || "").trim()
          }
        }
      );
      if (!isCurrentEvaluation()) return;
      state.detail.aiComparison = {
        ...state.detail.aiComparison,
        evaluation: payload.evaluation
      };
      state.notice = "人工对比已保存；案件决定没有改变。";
    } catch (error) {
      if (isCurrentEvaluation()) {
        state.error = messageFor(error, "人工对比保存失败。");
      }
    } finally {
      state.busy = false;
      requestRender();
    }
  }

  function filtersForRoute() {
    const route = displayRoute();
    const base = { ...state.filters };
    delete base.status;
    if (route === WorkspaceRoute.CORRECTIONS) return { ...base, status: "awaiting_correction", sort: "deadline" };
    if (route === WorkspaceRoute.APPEALS) return { ...base, status: "appealed", sort: "oldest" };
    if (route === WorkspaceRoute.AUTOMATIC) return { ...base, status: "resolved_actioned", sort: "newest" };
    if (route === WorkspaceRoute.USER_RISK) return { ...base, status: "resolved_actioned", sort: "newest" };
    if (route === WorkspaceRoute.OVERVIEW || route === WorkspaceRoute.AI_HEALTH) return { sort: "urgent" };
    return state.filters;
  }

  function displayRoute() {
    return state.selectedCaseID && state.caseReturnRoute ? state.caseReturnRoute : state.route;
  }

  function reconcileCase(detail) {
    const index = state.cases.findIndex((item) => item.id === detail.id);
    if (index >= 0) state.cases.splice(index, 1, listItemFromDetail(detail));
  }

  function routeContent(context) {
    if (state.route === WorkspaceRoute.MODERATION) {
      return renderModerationWorkspace({
        reviews: state.moderationReviews,
        status: state.moderationStatus,
        dialog: state.dialog?.kind === "moderation" ? state.dialog : null,
        loading: state.loading,
        busy: state.busy
      });
    }
    if (state.route === WorkspaceRoute.AUDIT) {
      return renderAuditWorkspace({
        events: state.auditEvents,
        eventType: state.auditEventType,
        nextCursor: state.auditNextCursor,
        loading: state.loading,
        busy: state.busy
      });
    }
    if (state.route === WorkspaceRoute.USER_RISK) {
      return renderUserRiskWorkspace({ cases: state.cases, loading: state.loading, busy: state.busy });
    }
    if (state.route === WorkspaceRoute.AI_HEALTH) {
      return renderAIHealthWorkspace({ health: state.aiHealth, loading: state.loading, busy: state.busy });
    }
    if (state.route === WorkspaceRoute.DEVICES) {
      return renderDeviceManagementPanel({
        session: context.session,
        devices: context.devices,
        requests: context.requests,
        dialog: context.deviceDialog,
        notice: context.deviceNotice,
        error: context.deviceError,
        busy: context.deviceBusy,
        embedded: true
      });
    }
    if (state.route === WorkspaceRoute.OVERVIEW) {
      return overviewView(state.cases, state.counts, state.loading);
    }
    const copy = routeCopy(displayRoute());
    return renderCaseWorkspace({
      ...copy,
      cases: state.cases,
      counts: state.counts,
      filters: displayRoute() === WorkspaceRoute.CASES ? state.filters : filtersForRoute(),
      search: state.search,
      nextCursor: state.nextCursor,
      detail: state.detail,
      selectedCaseID: state.selectedCaseID,
      revealMap: state.revealMap,
      dialog: state.dialog,
      loading: state.loading,
      busy: state.busy
    });
  }

  function workspaceShell({ session, content }) {
    const shell = element("div", "operations-shell");
    const sidebar = element("aside", `operations-sidebar${state.mobileNavOpen ? " is-open" : ""}`);
    const brand = element("div", "operations-brand");
    const brandName = element("strong");
    brandName.textContent = "周边团";
    const brandRole = element("span");
    brandRole.textContent = "安全后台";
    brand.append(brandName, brandRole);
    const nav = element("nav", "operations-nav");
    nav.setAttribute("aria-label", "后台主导航");
    for (const [route, label] of NAV_ITEMS) {
      const button = actionButton(label, "workspace-route", "nav-button");
      button.dataset.route = route;
      if (route === displayRoute()) button.setAttribute("aria-current", "page");
      nav.append(button);
    }
    const identity = element("p", "sidebar-identity");
    identity.textContent = `${session?.username || "管理员"}\n${session?.deviceName || "本设备"}`;
    sidebar.append(brand, nav, identity);

    const main = element("main", "operations-main");
    main.id = "workspace";
    const topbar = element("header", "operations-topbar");
    const menu = actionButton(state.mobileNavOpen ? "关闭导航" : "打开导航", "toggle-workspace-nav", "secondary-button nav-toggle");
    menu.setAttribute("aria-expanded", String(state.mobileNavOpen));
    const status = element("p", "muted session-summary");
    status.textContent = `${session?.deviceName || "本设备"}${session?.isRoot ? " · 根设备" : ""}`;
    const logout = actionButton("退出登录", "logout", "secondary-button");
    topbar.append(menu, status, logout);
    main.append(topbar, workloadStrip(state.counts), workspaceMessages(state.notice, state.error), content);
    shell.append(sidebar, main);
    return shell;
  }

  function requestRender({ focusHeading = false } = {}) {
    onRender({ focusHeading });
  }
}

function overviewView(cases, counts, loading) {
  const section = element("section", "overview-panel");
  const header = element("header", "content-heading");
  const block = element("div");
  const heading = element("h1");
  heading.tabIndex = -1;
  heading.textContent = "运营总览";
  const intro = element("p", "muted");
  intro.textContent = "先处理紧急风险、逾期整改与待处理申诉；所有动作回到单个案件完成。";
  block.append(heading, intro);
  const refresh = actionButton("刷新", "refresh-cases");
  header.append(block, refresh);
  section.append(header);
  const brief = element("dl", "overview-brief");
  brief.append(
    overviewMetric("需人工复核", counts.manual_review),
    overviewMetric("待处理申诉", counts.appealed),
    overviewMetric("逾期整改", counts.overdue)
  );
  section.append(brief);
  const queueHeading = element("h2");
  queueHeading.textContent = "当前优先案件";
  section.append(queueHeading);
  if (loading && !cases.length) {
    section.append(emptyState("正在加载优先案件…"));
  } else if (!cases.length) {
    section.append(emptyState("目前没有案件。"));
  } else {
    const list = element("div", "overview-case-list");
    for (const item of cases.slice(0, 12)) {
      const row = element("article", "overview-case-row");
      const open = actionButton(item.subjectTitle, "open-case", "row-link");
      open.dataset.caseId = item.id;
      const meta = element("p", "muted");
      meta.textContent = `${riskLabel(item.riskLevel)}风险 · ${statusLabel(item.status)} · ${formatRelativeTime(item.updatedAt)}`;
      row.append(open, meta);
      list.append(row);
    }
    section.append(list);
  }
  return section;
}

function workloadStrip(counts) {
  const section = element("section", "workload-strip");
  section.setAttribute("aria-label", "实时工作量");
  for (const [key, label, route, filters] of WORKLOAD_ITEMS) {
    const button = actionButton("", "workload-route", "workload-item");
    button.dataset.route = route;
    button.dataset.filters = JSON.stringify(filters);
    const count = element("strong", "tabular");
    count.textContent = String(Number(counts?.[key] || 0));
    const text = element("span");
    text.textContent = label;
    button.append(count, text);
    section.append(button);
  }
  return section;
}

function workspaceMessages(notice, error) {
  const container = element("div", "workspace-messages");
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

function routeCopy(route) {
  return ({
    [WorkspaceRoute.CASES]: {
      title: "安全案件",
      description: "按风险、状态、主体和举报原因筛选；打开单个案件后执行决定。"
    },
    [WorkspaceRoute.AUTOMATIC]: {
      title: "已处置与自动动作",
      description: "此列表包含已处置案件。打开详情核对动作记录中的 system/ai 来源；本视图不提供批量永久动作。"
    },
    [WorkspaceRoute.CORRECTIONS]: {
      title: "整改队列",
      description: "按截止时间处理等待整改案件，逾期状态始终使用文字明确标注。"
    },
    [WorkspaceRoute.APPEALS]: {
      title: "申诉队列",
      description: "维持或撤销原处理都需要单案确认和理由。"
    }
  })[route] || { title: "安全案件", description: "打开单个案件处理。" };
}

function routeTitle(route) {
  return NAV_ITEMS.find(([value]) => value === route)?.[1] || "安全后台";
}

function normalizeFilters(values) {
  const result = {};
  for (const [field, allowed] of FILTER_FIELDS) {
    const value = values?.[field];
    if (typeof value === "string" && allowed.has(value)) result[field] = value;
  }
  if (!result.sort) result.sort = "urgent";
  return result;
}

function restoredFilters(value) {
  return normalizeFilters(value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

function restoredCaseReturnRoute(value) {
  const allowed = new Set([
    WorkspaceRoute.OVERVIEW,
    WorkspaceRoute.CASES,
    WorkspaceRoute.AUTOMATIC,
    WorkspaceRoute.CORRECTIONS,
    WorkspaceRoute.APPEALS,
    WorkspaceRoute.USER_RISK,
    WorkspaceRoute.AI_HEALTH
  ]);
  return typeof value === "string" && allowed.has(value) ? value : "";
}

function safeHistoryFilters(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return restoredFilters(parsed);
  } catch {
    return {};
  }
}

function saveFilters(filters) {
  globalThis.history?.replaceState?.({
    ...(globalThis.history.state || {}),
    workspaceFilters: filters
  }, "", globalThis.location?.pathname || "/admin/cases");
}

function listItemFromDetail(detail) {
  return {
    id: detail.id,
    subjectType: detail.subjectType,
    subjectID: detail.subjectID,
    subjectTitle: detail.subjectTitle,
    category: detail.category,
    impactScope: detail.impactScope,
    status: detail.status,
    riskLevel: detail.riskLevel,
    reportCount: detail.reportCount,
    independentReporterCount: detail.independentReporterCount,
    correctionDueAt: detail.correctionDueAt,
    manualHold: detail.manualHold,
    version: detail.version,
    updatedAt: detail.updatedAt
  };
}

function overviewMetric(label, value) {
  const wrapper = element("div");
  const dt = element("dt");
  dt.textContent = label;
  const dd = element("dd", "tabular");
  dd.textContent = String(Number(value || 0));
  wrapper.append(dt, dd);
  return wrapper;
}

function emptyCounts() {
  return {
    manual_review: 0,
    auto_action: 0,
    awaiting_correction: 0,
    appealed: 0,
    ai_failed: 0,
    overdue: 0
  };
}

function messageFor(error, fallback) {
  return typeof error?.message === "string" && error.message ? error.message : fallback;
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
