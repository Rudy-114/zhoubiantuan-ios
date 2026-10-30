import test from "node:test";
import assert from "node:assert/strict";
import { pageResult, readCursor } from "../src/pagination.js";

test("personalized page cursors carry score while chronological cursors remain unchanged", () => {
  const ranked = pageResult([
    { id: "p-2", page_time: "2026-10-06T00:00:02.000Z", feed_score: 8.25 },
    { id: "p-1", page_time: "2026-10-06T00:00:01.000Z", feed_score: 7.5 }
  ], 1);
  const rankedCursor = readCursor(ranked.nextCursor);
  assert.equal(rankedCursor.id, "p-2");
  assert.equal(rankedCursor.score, 8.25);

  const recent = pageResult([
    { id: "p-1", page_time: "2026-10-06T00:00:01.000Z" },
    { id: "p-0", page_time: "2026-10-06T00:00:00.000Z" }
  ], 1);
  const recentCursor = readCursor(recent.nextCursor);
  assert.equal(recentCursor.id, "p-1");
  assert.equal(recentCursor.score, undefined);
});

test("invalid personalized score cursors are rejected", () => {
  const encoded = Buffer.from(JSON.stringify({ time: "2026-10-06T00:00:00.000Z", id: "p-1", score: "not-a-number" })).toString("base64url");
  assert.throws(() => readCursor(encoded), /分页游标无效/);
});
