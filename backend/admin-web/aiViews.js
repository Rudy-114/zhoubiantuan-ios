import { formatCount, formatDateTime, riskLabel } from "./formatters.js";

const MODE_LABELS = Object.freeze({ off: "关闭", shadow: "影子", enforce: "执行" });
const PROVIDER_LABELS = Object.freeze({
  disabled: "已关闭",
  budget_blocked: "预算为零",
  not_configured: "配置不完整",
  ready: "可用"
});
const DECISION_LABELS = Object.freeze({
  no_action: "无需处置",
  temporary_hide: "暂时隐藏",
  request_correction: "要求整改",
  permanent_remove: "永久移除",
  approve_revision: "发布整改版本",
  restore: "恢复内容",
  uphold_appeal: "维持原处理",
  overturn_appeal: "撤销原处理"
});

export function renderAIHealthWorkspace({ health = null, loading = false, busy = false } = {}) {
  const section = element("section", "ai-health-panel");
  section.append(contentHeader(
    "AI 健康",
    "查看影子分析、预算与人工对比进度；此页面没有执行模式开关。",
    "refresh-ai-health",
    busy
  ));
  if (loading && !health) {
    section.append(emptyState("正在加载 AI 健康状态…"));
    return section;
  }
  if (!health) {
    section.append(emptyState("AI 健康状态暂时不可用。"));
    return section;
  }

  section.append(healthSummary(health));
  const heading = element("h2", "section-heading");
  heading.textContent = "影子评估进度";
  section.append(heading, progressTable(health));
  const note = element("p", "policy-note");
  note.textContent = "原始模型响应和供应商密钥不在此页展示；任一检查未通过时，执行闸门都保持关闭。";
  section.append(note);
  return section;
}

export function renderCaseAIComparison(detail = {}, busy = false) {
  const comparison = safeObject(detail.aiComparison);
  const run = comparison.run;
  const evaluation = comparison.evaluation;
  const humanDecision = comparison.humanDecision || latestHumanDecision(detail.events);
  if (!run) return emptyState("该案件暂无 AI 分析。");

  const container = element("div", "ai-comparison");
  const columns = element("div", "ai-comparison-columns");
  columns.append(
    comparisonColumn("AI 分析", summaryList(aiSummaryRows(run))),
    comparisonColumn("最终人工决定", humanDecision
      ? summaryList([
          ["决定", decisionLabel(humanDecision.decision)],
          ["理由", humanDecision.reason || "未记录理由"],
          ["时间", formatDateTime(humanDecision.createdAt)]
        ])
      : emptyState("尚未提交最终人工决定。"))
  );
  container.append(columns);

  if (evaluation) {
    const result = element("div", "ai-evaluation-result");
    const heading = element("h4");
    heading.textContent = "人工对比已记录";
    result.append(heading, summaryList([
      ["分类", evaluation.categoryCorrect ? "正确" : "不正确"],
      ["动作", evaluation.actionCorrect ? "正确" : "不正确"],
      ["范围扩张", evaluation.scopeExpansionError ? "存在错误" : "无错误"],
      ["备注", evaluation.notes || "无"],
      ["记录时间", formatDateTime(evaluation.createdAt)]
    ]));
    container.append(result);
  } else if (run.status === "completed" && humanDecision) {
    container.append(evaluationForm(detail.id, run.id, busy));
  } else {
    const note = element("p", "muted ai-evaluation-note");
    note.textContent = run.status === "completed"
      ? "提交最终人工决定后可记录对比。"
      : "本次 AI 分析尚未完成，不能记录对比。";
    container.append(note);
  }
  return container;
}

function healthSummary(health) {
  const summary = element("dl", "ai-health-summary");
  const versions = safeObject(health.versions);
  const budget = safeObject(health.budget);
  const gate = safeObject(health.gate);
  for (const [label, value] of [
    ["运行模式", MODE_LABELS[health.mode] || health.mode || "未知"],
    ["供应商", PROVIDER_LABELS[health.providerState] || health.providerState || "未知"],
    ["执行闸门", gate.passed === true ? "已通过" : "关闭"],
    ["预算月份", budget.month || "—"],
    ["实际 / 预算", `${formatMoney(budget.actualCny)} / ${formatMoney(budget.budgetCny)}`],
    ["预留金额", formatMoney(budget.reservedCny)],
    ["模型", versions.model || "—"],
    ["提示词", versions.prompt || "—"],
    ["策略", versions.policy || "—"]
  ]) {
    const row = element("div");
    const term = element("dt");
    term.textContent = label;
    const description = element("dd", "tabular");
    description.textContent = value;
    row.append(term, description);
    summary.append(row);
  }
  return summary;
}

function progressTable(health) {
  const jobs = safeObject(health.jobs);
  const metrics = safeObject(health.metrics);
  const checks = safeObject(safeObject(health.gate).checks);
  const rows = [
    ["待处理分析任务", formatCount(jobs.pending), "观察"],
    ["运行中分析任务", formatCount(jobs.running), "观察"],
    ["失败分析任务", formatCount(jobs.failed), Number(jobs.failed) === 0 ? "通过" : "需处理"],
    ["版本化夹具", `${formatCount(metrics.fixtureCount)} / 100`, gateCheckLabel(checks.fixtureCount, "通过", "未通过")],
    ["夹具结构失败", formatCount(metrics.fixtureSchemaFailures), gateCheckLabel(checks.fixtureSchemaValid, "通过", "未通过")],
    ["自动隐藏精度", formatPercent(metrics.autoHidePrecision), gateCheckLabel(checks.autoHidePrecision, "通过", "未通过")],
    ["真实人工对比", `${formatCount(metrics.realEvaluations)} / 30`, gateCheckLabel(checks.realComparisons, "达到门槛", "收集中")],
    ["分类判断正确", formatCount(metrics.categoryCorrect), "观察"],
    ["动作判断正确", formatCount(metrics.actionCorrect), "观察"],
    ["范围扩张错误", formatCount(metrics.scopeExpansionErrors), gateCheckLabel(checks.noScopeErrors, "通过", "闸门关闭")],
    ["自动账号动作", formatCount(metrics.automaticAccountActions), gateCheckLabel(checks.noAutomaticAccountActions, "通过", "闸门关闭")],
    ["运行版本一致", metrics.versionsMatch === true ? "是" : "否", gateCheckLabel(checks.versionsMatch, "通过", "闸门关闭")],
    ["夹具版本一致", metrics.fixtureVersionCurrent === true ? "是" : "否", gateCheckLabel(checks.fixtureVersionCurrent, "通过", "闸门关闭")]
  ];
  const wrapper = element("div", "table-scroll");
  const table = element("table", "ai-progress-table");
  const caption = element("caption", "visually-hidden");
  caption.textContent = "AI 影子评估进度";
  const head = element("thead");
  const headRow = element("tr");
  for (const label of ["检查项", "当前值", "状态"]) {
    const cell = element("th");
    cell.scope = "col";
    cell.textContent = label;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = element("tbody");
  for (const [label, value, state] of rows) {
    const row = element("tr");
    row.append(
      tableCell("检查项", label),
      tableCell("当前值", value, "tabular"),
      tableCell("状态", state, state.includes("关闭") || state.includes("未通过") || state.includes("处理")
        ? "health-state health-state-attention"
        : "health-state")
    );
    body.append(row);
  }
  table.append(caption, head, body);
  wrapper.append(table);
  return wrapper;
}

function gateCheckLabel(value, passed, failed) {
  return value === true ? passed : failed;
}

function aiSummaryRows(run) {
  const result = safeObject(run.result);
  const versions = safeObject(run.versions);
  const proposals = Array.isArray(run.proposedActions) ? run.proposedActions : [];
  return [
    ["状态", `${run.mode || "—"} · ${run.status || "—"}`],
    ["分类", result.category || "—"],
    ["风险", result.riskLevel ? `${riskLabel(result.riskLevel)} · ${formatPercent(result.confidence)}` : "—"],
    ["建议", result.recommendedAction || "—"],
    ["策略动作", proposals.length ? proposals.map((item) => item.actionType).join("、") : "无"],
    ["需人工", result.requiresHuman === false ? "否" : "是"],
    ["错误", run.errorCode || "无"],
    ["版本", `${versions.model || "—"} · ${versions.prompt || "—"} · ${versions.policy || "—"}`]
  ];
}

function evaluationForm(caseID, runID, busy) {
  const form = element("form", "ai-evaluation-form");
  form.id = "ai-evaluation-form";
  form.dataset.caseId = caseID;
  form.dataset.aiRunId = runID;
  const heading = element("h4");
  heading.textContent = "记录人工对比";
  const intro = element("p", "muted");
  intro.textContent = "只评价 AI 与最终人工决定的差异，不会改变案件处理结果。";
  form.append(
    heading,
    intro,
    booleanChoice("ai-category-correct", "categoryCorrect", "AI 分类是否正确？"),
    booleanChoice("ai-action-correct", "actionCorrect", "AI 动作建议是否正确？")
  );
  const scope = element("label", "ai-scope-check");
  const checkbox = element("input");
  checkbox.type = "checkbox";
  checkbox.name = "scopeExpansionError";
  const scopeCopy = element("span");
  scopeCopy.textContent = "AI 扩大了案件影响范围";
  scope.append(checkbox, scopeCopy);
  const notes = element("label", "field ai-notes-field");
  const notesLabel = element("span");
  notesLabel.textContent = "对比备注（可选）";
  const textarea = element("textarea");
  textarea.name = "notes";
  textarea.maxLength = 1000;
  textarea.rows = 3;
  notes.append(notesLabel, textarea);
  const submit = element("button", "secondary-button");
  submit.type = "submit";
  submit.disabled = busy;
  submit.textContent = "保存人工对比";
  form.append(scope, notes, submit);
  return form;
}

function booleanChoice(id, name, legendText) {
  const fieldset = element("fieldset", "ai-boolean-field");
  const legend = element("legend");
  legend.textContent = legendText;
  fieldset.append(legend);
  for (const [value, label] of [["true", "正确"], ["false", "不正确"]]) {
    const option = element("label");
    const input = element("input");
    input.id = `${id}-${value}`;
    input.type = "radio";
    input.name = name;
    input.value = value;
    input.required = true;
    const copy = element("span");
    copy.textContent = label;
    option.append(input, copy);
    fieldset.append(option);
  }
  return fieldset;
}

function comparisonColumn(title, content) {
  const section = element("section", "ai-comparison-column");
  const heading = element("h4");
  heading.textContent = title;
  section.append(heading, content);
  return section;
}

function summaryList(rows) {
  const list = element("dl", "ai-summary-list");
  for (const [label, value] of rows) {
    const row = element("div");
    const term = element("dt");
    term.textContent = label;
    const description = element("dd");
    description.textContent = value;
    row.append(term, description);
    list.append(row);
  }
  return list;
}

function latestHumanDecision(events = []) {
  const event = [...(Array.isArray(events) ? events : [])]
    .reverse()
    .find((item) => item?.type === "admin_decision_applied");
  if (!event) return null;
  return {
    decision: event.data?.decision || "",
    reason: event.data?.reason || "",
    createdAt: event.createdAt
  };
}

function decisionLabel(value) {
  return DECISION_LABELS[value] || value || "未记录";
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

function formatMoney(value) {
  const amount = Number(value || 0);
  return `¥${Number.isFinite(amount) ? amount.toFixed(4) : "0.0000"}`;
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  }).format(number);
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

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function element(tag, className = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
