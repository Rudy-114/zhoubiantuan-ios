const RISK_LABELS = Object.freeze({
  none: "无风险",
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急"
});

const STATUS_LABELS = Object.freeze({
  received: "已接收",
  triaging: "分流中",
  monitoring: "观察中",
  manual_review: "人工复核",
  awaiting_correction: "等待整改",
  rechecking: "整改复核",
  appealed: "待处理申诉",
  resolved_no_action: "无需处置",
  resolved_restored: "已恢复",
  resolved_actioned: "已处置"
});

export function formatDateTime(value, { locale = "zh-CN", timeZone } = {}) {
  const date = validDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {})
  }).format(date);
}

export function formatRelativeTime(value, { now = new Date() } = {}) {
  const date = validDate(value);
  const current = validDate(now);
  if (!date || !current) return "—";
  const deltaSeconds = Math.round((current.getTime() - date.getTime()) / 1000);
  const future = deltaSeconds < 0;
  const absolute = Math.abs(deltaSeconds);
  let amount;
  let unit;
  if (absolute < 60) {
    amount = absolute;
    unit = "秒";
  } else if (absolute < 3600) {
    amount = Math.round(absolute / 60);
    unit = "分钟";
  } else if (absolute < 86400) {
    amount = Math.round(absolute / 3600);
    unit = "小时";
  } else {
    amount = Math.round(absolute / 86400);
    unit = "天";
  }
  return future ? `${amount} ${unit}后` : `${amount} ${unit}前`;
}

export function formatCount(value, locale = "zh-CN") {
  const number = Number(value);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
    .format(Number.isFinite(number) ? number : 0);
}

export function riskLabel(value) {
  return RISK_LABELS[value] || "未知风险";
}

export function statusLabel(value) {
  return STATUS_LABELS[value] || "未知状态";
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
