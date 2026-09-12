import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCount,
  formatDateTime,
  formatRelativeTime,
  riskLabel,
  statusLabel
} from "../../admin-web/formatters.js";

test("formats stable admin dates, relative ages, and counts", () => {
  const value = "2026-07-14T02:00:00.000Z";
  assert.equal(formatDateTime(value, { locale: "zh-CN", timeZone: "UTC" }), "2026/07/14 02:00");
  assert.equal(formatDateTime("invalid"), "—");
  assert.equal(formatRelativeTime(value, { now: new Date("2026-07-14T02:00:45.000Z") }), "45 秒前");
  assert.equal(formatRelativeTime(value, { now: new Date("2026-07-14T04:00:00.000Z") }), "2 小时前");
  assert.equal(formatRelativeTime("invalid"), "—");
  assert.equal(formatCount(12345, "zh-CN"), "12,345");
  assert.equal(formatCount(Number.NaN), "0");
});

test("maps risk and case state to explicit Chinese labels", () => {
  assert.equal(riskLabel("urgent"), "紧急");
  assert.equal(riskLabel("none"), "无风险");
  assert.equal(riskLabel("unexpected"), "未知风险");
  assert.equal(statusLabel("manual_review"), "人工复核");
  assert.equal(statusLabel("awaiting_correction"), "等待整改");
  assert.equal(statusLabel("unexpected"), "未知状态");
});
