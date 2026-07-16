import assert from "node:assert/strict";
import test from "node:test";
import {
  caseMatchesSearch,
  createWorkspaceController,
  dueLabel,
  isLatestRequest,
  parseWorkspaceRoute,
  revealedEvidence,
  serializeCaseFilters,
  WorkspaceRoute
} from "../../admin-web/workspace.js";
import { riskLabel, statusLabel } from "../../admin-web/formatters.js";
import { availableCaseDecisions } from "../../admin-web/caseViews.js";

test("serializes only supported case filters and appends an opaque cursor", () => {
  assert.equal(
    serializeCaseFilters({
      status: "manual_review",
      subjectType: "post",
      category: "harassment_or_abuse",
      riskLevel: "urgent",
      sort: "oldest",
      ignored: "secret"
    }, { cursor: "opaque-cursor", limit: 25 }),
    "status=manual_review&subjectType=post&category=harassment_or_abuse&riskLevel=urgent&sort=oldest&limit=25&cursor=opaque-cursor"
  );
  assert.equal(serializeCaseFilters({}, {}), "sort=urgent&limit=50");
});

test("rejects stale async responses by request sequence", () => {
  assert.equal(isLatestRequest(4, 4), true);
  assert.equal(isLatestRequest(5, 4), false);
  assert.equal(isLatestRequest(3, 4), false);
});

test("maps workspace paths without placing filter or credential state in URLs", () => {
  assert.deepEqual(parseWorkspaceRoute("/admin"), { route: "overview", caseID: "" });
  assert.deepEqual(parseWorkspaceRoute("/admin/cases/case-123"), {
    route: "cases",
    caseID: "case-123"
  });
  assert.deepEqual(parseWorkspaceRoute("/admin/audit"), { route: "audit", caseID: "" });
  assert.deepEqual(parseWorkspaceRoute("/admin/not-real"), { route: "overview", caseID: "" });
});

test("formats explicit risk, state, due time, and local queue search", () => {
  assert.equal(riskLabel("urgent"), "紧急");
  assert.equal(statusLabel("awaiting_correction"), "等待整改");
  assert.equal(dueLabel("2026-07-14T02:00:00.000Z", {
    now: new Date("2026-07-14T01:30:00.000Z")
  }), "30 分钟后到期");
  assert.equal(dueLabel("2026-07-14T02:00:00.000Z", {
    now: new Date("2026-07-14T03:00:00.000Z")
  }), "已逾期 1 小时");
  assert.equal(caseMatchesSearch({ subjectTitle: "安静的周末拼单", subjectID: "post-1" }, "周末"), true);
  assert.equal(caseMatchesSearch({ subjectTitle: "安静的周末拼单", subjectID: "post-1" }, "user-2"), false);
});

test("never exposes raw evidence before an audited reveal response is present", () => {
  const metadata = { id: "evidence-1", type: "direct_message", hasText: true };
  assert.deepEqual(revealedEvidence(metadata, new Map()), {
    metadata,
    revealed: null,
    accessReason: ""
  });
  const reveal = {
    evidence: { id: "evidence-1", textSnapshot: "retained text", structuredSnapshot: { messages: [] } },
    reason: "复核上下文"
  };
  assert.deepEqual(revealedEvidence(metadata, new Map([[metadata.id, reveal]])), {
    metadata,
    revealed: reveal.evidence,
    accessReason: reveal.reason
  });
});

test("loads workload counts when a non-case workspace route is opened directly", async () => {
  const originalLocation = globalThis.location;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { pathname: "/admin/devices" }
  });
  let deviceLoads = 0;
  const controller = createWorkspaceController({
    api: async (path) => {
      assert.equal(path, "/admin/api/cases?sort=urgent&limit=1");
      return { cases: [], counts: { manual_review: 3, appealed: 2 }, nextCursor: null };
    },
    onRender: () => {},
    onLoadDevices: async () => { deviceLoads += 1; }
  });
  try {
    await controller.activate();
    assert.equal(deviceLoads, 1);
    assert.equal(controller.getState().counts.manual_review, 3);
    assert.equal(controller.getState().counts.appealed, 2);
  } finally {
    if (originalLocation === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation });
  }
});

test("loads AI health directly and submits a typed human comparison", async () => {
  const originalLocation = globalThis.location;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { pathname: "/admin/ai-health" }
  });
  const requests = [];
  const controller = createWorkspaceController({
    api: async (path, options) => {
      requests.push({ path, options });
      if (path === "/admin/api/ai-health") return { mode: "shadow", metrics: { realEvaluations: 4 } };
      if (path.startsWith("/admin/api/cases?")) return { cases: [], counts: {}, nextCursor: null };
      if (path.includes("/ai-evaluation")) {
        return { evaluation: { id: "evaluation-1", aiRunID: "run-1" } };
      }
      throw new Error(`unexpected path: ${path}`);
    },
    onRender: () => {}
  });
  try {
    await controller.activate();
    assert.equal(controller.getState().aiHealth.metrics.realEvaluations, 4);
    controller.getState().detail = {
      id: "case-1",
      aiComparison: { run: { id: "run-1" }, evaluation: null }
    };
    assert.equal(controller.handleSubmit({
      id: "ai-evaluation-form",
      dataset: { caseId: "case-1", aiRunId: "run-1" }
    }, {
      categoryCorrect: "true",
      actionCorrect: "false",
      scopeExpansionError: "on",
      notes: "Needs a human action"
    }), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(requests.at(-1), {
      path: "/admin/api/cases/case-1/ai-evaluation",
      options: {
        method: "POST",
        body: {
          aiRunID: "run-1",
          categoryCorrect: true,
          actionCorrect: false,
          scopeExpansionError: true,
          notes: "Needs a human action"
        }
      }
    });
    assert.equal(controller.getState().detail.aiComparison.evaluation.id, "evaluation-1");
  } finally {
    if (originalLocation === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation });
  }
});

test("submits one confirmed report-abuse mark without changing other clues", async () => {
  const requests = [];
  const controller = createWorkspaceController({
    api: async (path, options) => {
      requests.push({ path, options });
      return {
        case: {
          id: "case-1",
          version: "2026-07-16T08:01:00.000Z",
          reports: [
            { id: "report-1", status: "invalid", invalidReason: "coordinated" },
            { id: "report-2", status: "pending", countsTowardThreshold: true }
          ]
        }
      };
    },
    onRender: () => {}
  });
  controller.getState().detail = {
    id: "case-1",
    version: "2026-07-16T08:00:00.000Z",
    reports: [
      { id: "report-1", status: "pending", countsTowardThreshold: true },
      { id: "report-2", status: "pending", countsTowardThreshold: true }
    ],
    aiComparison: { run: { id: "run-1" } }
  };

  assert.equal(controller.handleSubmit({
    id: "report-abuse-form",
    dataset: { caseId: "case-1", reportId: "report-1" }
  }, {
    reason: "coordinated",
    confirmed: "on"
  }), true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(requests, [{
    path: "/admin/api/cases/case-1/reports/report-1/invalidate",
    options: {
      method: "POST",
      body: {
        reason: "coordinated",
        confirmed: true,
        expectedVersion: "2026-07-16T08:00:00.000Z"
      }
    }
  }]);
  assert.equal(controller.getState().detail.reports.length, 2);
  assert.equal(controller.getState().detail.reports[0].status, "invalid");
  assert.equal(controller.getState().detail.aiComparison.run.id, "run-1");
});

test("ignores a failed AI health request after navigating away", async () => {
  const originalLocation = globalThis.location;
  const originalHistory = globalThis.history;
  const location = { pathname: "/admin/ai-health" };
  const history = {
    state: {},
    pushState(nextState, _title, url) {
      this.state = nextState;
      location.pathname = url;
    }
  };
  let rejectHealth;
  const health = new Promise((_resolve, reject) => { rejectHealth = reject; });
  Object.defineProperty(globalThis, "location", { configurable: true, value: location });
  Object.defineProperty(globalThis, "history", { configurable: true, value: history });
  const controller = createWorkspaceController({
    api: async (path) => {
      if (path === "/admin/api/ai-health") return health;
      if (path === "/admin/api/cases?sort=urgent&limit=1") {
        return { cases: [], counts: {}, nextCursor: null };
      }
      if (path === "/admin/api/cases?sort=urgent&limit=12") {
        return { cases: [], counts: {}, nextCursor: null };
      }
      throw new Error(`unexpected path: ${path}`);
    },
    onRender: () => {}
  });
  try {
    const activation = controller.activate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(controller.handleClick({
      dataset: { action: "workspace-route", route: WorkspaceRoute.OVERVIEW }
    }), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    rejectHealth(new Error("stale health failure"));
    await activation;
    assert.equal(controller.getState().route, WorkspaceRoute.OVERVIEW);
    assert.equal(controller.getState().error, "");
  } finally {
    if (originalLocation === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation });
    if (originalHistory === undefined) delete globalThis.history;
    else Object.defineProperty(globalThis, "history", { configurable: true, value: originalHistory });
  }
});

test("ignores a completed AI evaluation after leaving its case", async () => {
  const originalLocation = globalThis.location;
  const originalHistory = globalThis.history;
  const location = { pathname: "/admin/cases/case-1" };
  const history = {
    state: {},
    pushState(nextState, _title, url) {
      this.state = nextState;
      location.pathname = url;
    }
  };
  let resolveEvaluation;
  const evaluation = new Promise((resolve) => { resolveEvaluation = resolve; });
  Object.defineProperty(globalThis, "location", { configurable: true, value: location });
  Object.defineProperty(globalThis, "history", { configurable: true, value: history });
  const controller = createWorkspaceController({
    api: async (path) => {
      if (path === "/admin/api/cases/case-1") {
        return {
          case: {
            id: "case-1",
            aiComparison: { run: { id: "run-1" }, evaluation: null }
          }
        };
      }
      if (path === "/admin/api/cases/case-1/ai-evaluation") return evaluation;
      if (path.startsWith("/admin/api/cases?")) return { cases: [], counts: {}, nextCursor: null };
      throw new Error(`unexpected path: ${path}`);
    },
    onRender: () => {}
  });
  try {
    await controller.activate();
    assert.equal(controller.handleSubmit({
      id: "ai-evaluation-form",
      dataset: { caseId: "case-1", aiRunId: "run-1" }
    }, {
      categoryCorrect: "true",
      actionCorrect: "true"
    }), true);
    controller.handleClick({ dataset: { action: "close-case" } });
    resolveEvaluation({ evaluation: { id: "evaluation-1", aiRunID: "run-1" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(controller.getState().detail, null);
    assert.equal(controller.getState().error, "");
    assert.equal(controller.getState().notice, "");
  } finally {
    if (originalLocation === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation });
    if (originalHistory === undefined) delete globalThis.history;
    else Object.defineProperty(globalThis, "history", { configurable: true, value: originalHistory });
  }
});

test("offers only appeal settlement and independent account controls for an appealed case", () => {
  assert.deepEqual(availableCaseDecisions({
    status: "appealed",
    subjectType: "post",
    subjectOwnerID: "owner-1",
    actions: [{ type: "hide_post", status: "applied", targetType: "post" }],
    revisions: [{ status: "approved" }]
  }), ["uphold_appeal", "overturn_appeal", "restrict_user"]);
});

test("keeps the originating specialized queue when a case inspector opens and closes", async () => {
  const originalLocation = globalThis.location;
  const originalHistory = globalThis.history;
  const location = { pathname: "/admin/appeals" };
  const history = {
    state: {},
    pushState(nextState, _title, url) {
      this.state = nextState;
      location.pathname = url;
    }
  };
  Object.defineProperty(globalThis, "location", { configurable: true, value: location });
  Object.defineProperty(globalThis, "history", { configurable: true, value: history });
  const controller = createWorkspaceController({
    api: async (path) => path.includes("/case-appeal")
      ? { case: { id: "case-appeal" } }
      : { cases: [{ id: "case-appeal" }], counts: {}, nextCursor: null },
    onRender: () => {}
  });
  try {
    await controller.activate();
    controller.handleClick({ dataset: { action: "open-case", caseId: "case-appeal" } });
    assert.equal(controller.getState().caseReturnRoute, WorkspaceRoute.APPEALS);
    assert.equal(history.state.workspaceCaseReturnRoute, WorkspaceRoute.APPEALS);
    controller.handleClick({ dataset: { action: "close-case" } });
    assert.equal(location.pathname, "/admin/appeals");
  } finally {
    if (originalLocation === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation });
    if (originalHistory === undefined) delete globalThis.history;
    else Object.defineProperty(globalThis, "history", { configurable: true, value: originalHistory });
  }
});
