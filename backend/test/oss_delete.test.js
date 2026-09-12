import assert from "node:assert/strict";
import test from "node:test";
import OSS from "ali-oss";

test("OSS deletion treats a missing object as idempotent and sanitizes provider failures", async () => {
  const originalDelete = OSS.prototype.delete;
  try {
    OSS.prototype.delete = async () => {
      const error = new Error("NoSuchKey provider request detail");
      error.status = 404;
      error.code = "NoSuchKey";
      throw error;
    };
    const { deleteObject } = await import(`../src/oss.js?delete-semantics=${Date.now()}`);
    assert.deepEqual(await deleteObject("report/u-reporter/2026-07-12/missing.jpg"), {
      deleted: false,
      alreadyMissing: true
    });

    OSS.prototype.delete = async () => {
      const error = new Error("provider secret request-id and endpoint");
      error.status = 503;
      error.code = "ServiceUnavailable";
      throw error;
    };
    await assert.rejects(
      deleteObject("report/u-reporter/2026-07-12/retry.jpg"),
      (error) => {
        assert.equal(error.code, "OSS_DELETE_FAILED");
        assert.equal(error.message, "OSS object deletion failed");
        assert.doesNotMatch(JSON.stringify(error), /report\/|request-id|endpoint|ServiceUnavailable/i);
        return true;
      }
    );
  } finally {
    OSS.prototype.delete = originalDelete;
  }
});
