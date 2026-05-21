import test from "node:test";
import assert from "node:assert/strict";
import { arrayOfStrings, assertEmail, assertEmailCode, assertEmailCodePurpose, normalizeEmail, trimmedString } from "../src/validators.js";

test("normalizes and validates emails", () => {
  assert.equal(normalizeEmail("  Test@Example.COM "), "test@example.com");
  assert.equal(assertEmail("user@example.com"), "user@example.com");
  assert.throws(() => assertEmail("not-email"), /有效邮箱/);
});

test("trims fallback values", () => {
  assert.equal(trimmedString("  hello  "), "hello");
  assert.equal(trimmedString("   ", "fallback"), "fallback");
});

test("validates email verification codes", () => {
  assert.equal(assertEmailCode(" 123456 "), "123456");
  assert.throws(() => assertEmailCode("12345"), /6 位验证码/);
  assert.equal(assertEmailCodePurpose("register"), "register");
  assert.equal(assertEmailCodePurpose("login"), "login");
  assert.throws(() => assertEmailCodePurpose("reset"), /验证码用途不正确/);
});

test("filters string arrays", () => {
  assert.deepEqual(arrayOfStrings([" a ", "", null, "b"]), ["a", "b"]);
  assert.deepEqual(arrayOfStrings("nope"), []);
});
