import assert from "node:assert/strict";
import test from "node:test";
import {
  caseMatchesSearch,
  dueLabel,
  isLatestRequest,
  parseWorkspaceRoute,
  revealedEvidence,
  serializeCaseFilters
} from "../../admin-web/workspace.js";
import { riskLabel, statusLabel } from "../../admin-web/formatters.js";

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
