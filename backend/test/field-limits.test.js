import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDeadlineInRange, assertExternalLink, assertPostTextFields, boundedString, boundedTags, clampImageAspect,
  MESSAGE_ID_PATTERN, THREAD_ID_PATTERN } from '../src/validators.js';

const text = (n, ch = '字') => ch.repeat(n);

test('boundedString counts characters, not UTF-16 units, and returns the fallback for empty input', () => {
  assert.equal(boundedString(text(20), { max: 20, field: '昵称' }), text(20));
  assert.throws(() => boundedString(text(21), { max: 20, field: '昵称' }), /昵称最多 20 字/);
  assert.equal(boundedString('😀'.repeat(20), { max: 20, field: '昵称' }).length, 40); // 20 emoji are allowed
  assert.throws(() => boundedString('😀'.repeat(21), { max: 20, field: '昵称' }));
  assert.equal(boundedString('   ', { max: 20, field: '昵称', fallback: 'old nickname that is longer than twenty' }),
    'old nickname that is longer than twenty');
});

test('each table limit accepts the boundary and rejects one more', () => {
  const limits = { title: 60, description: 3000, price: 40, deposit: 40, condition: 40, pingguAveragePrice: 40,
    pingguNote: 100, wechat: 40, qq: 40, groupNumber: 40, groupInfo: 500 };
  for (const [key, max] of Object.entries(limits)) {
    assert.equal(assertPostTextFields({ [key]: text(max) })[key], text(max), key);
    assert.throws(() => assertPostTextFields({ [key]: text(max + 1) }), new RegExp(`最多 ${max} 字`), key);
  }
});

test('tags: 20 characters each, 10 per category', () => {
  assert.equal(boundedTags(Array(10).fill(text(20)), { field: '标签' }).length, 10);
  assert.throws(() => boundedTags(Array(11).fill('a'), { field: '标签' }), /最多 10 个/);
  assert.throws(() => boundedTags([text(21)], { field: '标签' }), /最多 20 字/);
  assert.throws(() => assertPostTextFields({ fandomTags: Array(11).fill('x') }));
});

test('external links must be https and at most 500 characters', () => {
  assert.equal(assertExternalLink(''), '');
  const ok = 'https://example.com/' + 'a'.repeat(480);
  assert.equal(assertExternalLink(ok), ok);
  assert.throws(() => assertExternalLink(ok + 'a'), /500/);
  for (const bad of ['http://example.com', 'javascript:alert(1)', 'example.com', 'https://']) {
    assert.throws(() => assertExternalLink(bad), /https/, bad);
  }
});

test('imageAspect is clamped to [0.3, 3] and non-numbers fall back to 1.08', () => {
  assert.equal(clampImageAspect(0.1), 0.3);
  assert.equal(clampImageAspect(9), 3);
  assert.equal(clampImageAspect(1.5), 1.5);
  for (const bad of [undefined, null, '', 'abc', NaN, Infinity, -2, 0]) assert.equal(clampImageAspect(bad), 1.08, String(bad));
});

test('deadline must be within one day ago and two years ahead', () => {
  const now = new Date('2026-11-12T00:00:00Z');
  const day = 86400000;
  assert.ok(assertDeadlineInRange(new Date(now - day + 1000), now));
  assert.throws(() => assertDeadlineInRange(new Date(now - day - 1000), now), /截团时间/);
  assert.ok(assertDeadlineInRange(new Date(+now + 730 * day - 1000), now));
  assert.throws(() => assertDeadlineInRange(new Date(+now + 731 * day), now));
  assert.equal(assertDeadlineInRange(null, now), null);
});

test('message and thread id formats', () => {
  assert.ok(MESSAGE_ID_PATTERN.test('m-' + 'a'.repeat(120)));
  assert.ok(!MESSAGE_ID_PATTERN.test('m-' + 'a'.repeat(121)));
  assert.ok(!MESSAGE_ID_PATTERN.test('m-<script>'));
  assert.ok(THREAD_ID_PATTERN.test('t-dm-u-1-u-2'));
  assert.ok(!THREAD_ID_PATTERN.test('t-' + 'a'.repeat(201)));
  assert.ok(!THREAD_ID_PATTERN.test('t-a/b'));
});
