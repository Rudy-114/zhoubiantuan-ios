import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReportInput } from "../../src/safety/reportValidation.js";

const base = {
  clientRequestID: "req-1",
  sourceType: "post",
  sourceID: "p-1",
  reasonCode: "suspected_scam",
  reportedField: "content",
  detail: "detail"
};

const allowedReasonsBySource = {
  post: [
    "suspected_scam",
    "false_or_expired_group_buy",
    "invalid_contact",
    "copyright_or_stolen_media",
    "harassment_or_abuse",
    "sexual_or_illegal",
    "spam_or_advertising",
    "other"
  ],
  comment: [
    "suspected_scam",
    "harassment_or_abuse",
    "sexual_or_illegal",
    "spam_or_advertising",
    "other"
  ],
  user: [
    "suspected_scam",
    "copyright_or_stolen_media",
    "harassment_or_abuse",
    "sexual_or_illegal",
    "spam_or_advertising",
    "other"
  ],
  direct_message: [
    "suspected_scam",
    "harassment_or_abuse",
    "sexual_or_illegal",
    "spam_or_advertising",
    "direct_message_risk",
    "other"
  ],
  collection: [
    "suspected_scam",
    "false_or_expired_group_buy",
    "invalid_contact",
    "copyright_or_stolen_media",
    "sexual_or_illegal",
    "spam_or_advertising",
    "other"
  ]
};

const allReasons = [
  "suspected_scam",
  "false_or_expired_group_buy",
  "invalid_contact",
  "copyright_or_stolen_media",
  "harassment_or_abuse",
  "sexual_or_illegal",
  "spam_or_advertising",
  "direct_message_risk",
  "other"
];

test("rejects a null top-level report body with a controlled bad request", () => {
  assert.throws(
    () => normalizeReportInput(null),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /请求体必须是对象/);
      return true;
    }
  );
});

test("rejects an array top-level report body with a controlled bad request", () => {
  assert.throws(
    () => normalizeReportInput([]),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /请求体必须是对象/);
      return true;
    }
  );
});

test("rejects primitive top-level report bodies with a controlled bad request", () => {
  for (const body of [true, 42, "report"]) {
    assert.throws(
      () => normalizeReportInput(body),
      (error) => {
        assert.equal(error.status, 400);
        assert.match(error.message, /请求体必须是对象/);
        return true;
      }
    );
  }
});

test("keeps plain objects and the default body on normal validation paths", () => {
  assert.equal(normalizeReportInput(base).sourceId, "p-1");
  assert.throws(
    () => normalizeReportInput(),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /请求 ID不能为空/);
      return true;
    }
  );
});

test("normalizes a collection-scoped post contact report", () => {
  assert.deepEqual(normalizeReportInput({
    clientRequestID: " req-1 ",
    sourceType: " post ",
    sourceID: " p-1 ",
    reasonCode: " invalid_contact ",
    reportedField: " contact_wechat ",
    detail: " 无法搜索该微信号 "
  }), {
    clientRequestId: "req-1",
    sourceType: "post",
    sourceId: "p-1",
    reasonCode: "invalid_contact",
    reportedField: "contact_wechat",
    detail: "无法搜索该微信号",
    objectKeys: []
  });
});

test("accepts the approved source and reason matrix", () => {
  for (const [sourceType, allowedReasons] of Object.entries(allowedReasonsBySource)) {
    for (const reasonCode of allReasons) {
      const allowed = allowedReasons.includes(reasonCode);
      const input = matrixInput(sourceType, reasonCode, allowed);
      if (allowed) {
        assert.doesNotThrow(() => normalizeReportInput(input), `${sourceType}:${reasonCode} should be allowed`);
      } else {
        assert.throws(
          () => normalizeReportInput(input),
          /举报原因与举报对象不匹配/,
          `${sourceType}:${reasonCode} should be rejected`
        );
      }
    }
  }
});

test("accepts every collection-shared field for post and collection sources", () => {
  for (const sourceType of ["post", "collection"]) {
    for (const reportedField of [
      "contact_wechat",
      "contact_qq",
      "contact_group_number",
      "collection_deadline",
      "collection_description",
      "collection_default_note"
    ]) {
      const reasonCode = reportedField.startsWith("contact_") ? "invalid_contact" : "false_or_expired_group_buy";
      const result = normalizeReportInput({
        ...base,
        sourceType,
        reasonCode,
        reportedField,
        detail: reportedField.startsWith("contact_") ? "无法联系" : "detail"
      });
      assert.equal(result.reportedField, reportedField);
    }
  }
});

test("accepts the approved collection-wide reasons for shared fields", () => {
  const validCombinations = [
    ["suspected_scam", "collection_description"],
    ["false_or_expired_group_buy", "collection_deadline"],
    ["invalid_contact", "contact_qq"],
    ["copyright_or_stolen_media", "collection_description"],
    ["sexual_or_illegal", "collection_default_note"],
    ["spam_or_advertising", "collection_description"],
    ["other", "collection_default_note"]
  ];

  for (const sourceType of ["post", "collection"]) {
    for (const [reasonCode, reportedField] of validCombinations) {
      assert.doesNotThrow(() => normalizeReportInput({
        ...base,
        sourceType,
        reasonCode,
        reportedField,
        detail: reasonCode === "invalid_contact" ? "QQ 无法联系" : "detail"
      }));
    }
  }
});

test("rejects collection-shared fields for non-collection sources", () => {
  for (const sourceType of ["comment", "user", "direct_message"]) {
    assert.throws(
      () => normalizeReportInput({ ...base, sourceType, reportedField: "collection_description" }),
      /举报字段/
    );
  }
});

test("rejects client-selected collection scope through a content abuse reason", () => {
  assert.throws(
    () => normalizeReportInput({
      ...base,
      sourceType: "post",
      reasonCode: "harassment_or_abuse",
      reportedField: "collection_description"
    }),
    /举报字段与举报原因不匹配/
  );
  for (const [sourceType, reasonCode] of [
    ["post", "direct_message_risk"],
    ["collection", "harassment_or_abuse"],
    ["collection", "direct_message_risk"]
  ]) {
    assert.throws(
      () => normalizeReportInput({
        ...base,
        sourceType,
        reasonCode,
        reportedField: "collection_description"
      }),
      /举报原因与举报对象不匹配/
    );
  }
});

test("requires detail for other and invalid contact reports", () => {
  assert.throws(
    () => normalizeReportInput({ ...base, reasonCode: "other", detail: " " }),
    /详细说明/
  );
  assert.throws(
    () => normalizeReportInput({ ...base, reasonCode: "invalid_contact", reportedField: "content" }),
    /具体联系方式/
  );
});

test("requires invalid contact reports to select a concrete shared contact field", () => {
  for (const reportedField of ["collection_deadline", "collection_description", "content"]) {
    assert.throws(
      () => normalizeReportInput({ ...base, reasonCode: "invalid_contact", reportedField, detail: "坏了" }),
      /具体联系方式/
    );
  }
});

test("rejects unsupported enums, missing IDs, and overlong IDs with Unicode code point counting", () => {
  assert.throws(() => normalizeReportInput({ ...base, sourceType: "story" }), /举报对象/);
  assert.throws(() => normalizeReportInput({ ...base, reasonCode: "unknown" }), /举报原因/);
  assert.throws(() => normalizeReportInput({ ...base, reportedField: "phone" }), /举报字段/);
  assert.throws(() => normalizeReportInput({ ...base, sourceID: " " }), /目标 ID/);

  const boundaryId = "😀".repeat(128);
  assert.equal(normalizeReportInput({ ...base, clientRequestID: boundaryId }).clientRequestId, boundaryId);
  assert.throws(() => normalizeReportInput({ ...base, clientRequestID: "😀".repeat(129) }), /请求 ID/);
});

test("rejects non-string scalar fields instead of coercing them", () => {
  const cases = [
    ["clientRequestID", 123, /请求 ID.*字符串/],
    ["sourceType", ["post"], /举报对象.*字符串/],
    ["sourceID", { id: "p-1" }, /目标 ID.*字符串/],
    ["reasonCode", 42, /举报原因.*字符串/],
    ["reportedField", { field: "content" }, /举报字段.*字符串/],
    ["detail", 7, /详细说明.*字符串/]
  ];

  for (const [key, value, pattern] of cases) {
    assert.throws(() => normalizeReportInput({ ...base, [key]: value }), pattern);
  }
});

test("rejects overlong detail and malformed evidence keys", () => {
  const detailBoundary = "😀".repeat(1000);
  assert.equal(normalizeReportInput({ ...base, detail: detailBoundary }).detail, detailBoundary);
  assert.throws(() => normalizeReportInput({ ...base, detail: "😀".repeat(1001) }), /详细说明.*1000/);
  assert.throws(() => normalizeReportInput({ ...base, objectKeys: "not-an-array" }), /证据/);
  assert.throws(() => normalizeReportInput({ ...base, objectKeys: ["ok", " "] }), /证据/);
  assert.throws(() => normalizeReportInput({ ...base, objectKeys: [42] }), /证据/);
  assert.throws(() => normalizeReportInput({ ...base, objectKeys: Array.from({ length: 7 }, (_, i) => `key-${i}`) }), /证据/);
});

test("trims, deduplicates, and defaults detail and evidence", () => {
  const { detail, ...withoutDetail } = base;
  assert.deepEqual(normalizeReportInput({
    ...withoutDetail,
    objectKeys: [" dup ", "dup", " key-2 ", "dup", "key-2"]
  }), {
    clientRequestId: "req-1",
    sourceType: "post",
    sourceId: "p-1",
    reasonCode: "suspected_scam",
    reportedField: "content",
    detail: "",
    objectKeys: ["dup", "key-2"]
  });
});

function matrixInput(sourceType, reasonCode, allowed) {
  if (!allowed) {
    return {
      ...base,
      sourceType,
      reasonCode,
      reportedField: "content",
      detail: "detail"
    };
  }

  if (reasonCode === "invalid_contact") {
    return {
      ...base,
      sourceType,
      reasonCode,
      reportedField: "contact_qq",
      detail: "QQ 无法联系"
    };
  }

  if (sourceType === "collection" && reasonCode === "false_or_expired_group_buy") {
    return {
      ...base,
      sourceType,
      reasonCode,
      reportedField: "collection_deadline",
      detail: "detail"
    };
  }

  return {
    ...base,
    sourceType,
    reasonCode,
    reportedField: "content",
    detail: reasonCode === "other" ? "detail" : "detail"
  };
}
