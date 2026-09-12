import test from 'node:test';
import assert from 'node:assert/strict';
import { AliyunModerationProvider, mapAliyunResponse, splitModerationText } from '../src/moderation/aliyunProvider.js';
import { publicContentModerationText } from '../src/moderation/text.js';
import { config } from '../src/config.js';

test('malformed or failed provider responses never auto-publish', () => {
  for (const response of [undefined, null, {}, { Code: 200 }, { Code: 200, Data: {} }, { Code: 500, Data: { RiskLevel: 'none' } }, { Data: { RiskLevel: 'none' } }]) {
    assert.equal(mapAliyunResponse(response, 'textAgent', 'ok').outcome, 'review');
  }
  assert.equal(mapAliyunResponse({ Code: '200', Data: { RiskLevel: 'none' } }, 'textAgent', 'ok').outcome, 'pass');
  assert.equal(mapAliyunResponse({ Code: 200, Data: { RiskLevel: 'high' } }, 'textAgent', 'ok').outcome, 'block');
});

test('all displayed text including the suffix after 6000 characters is reviewed', async () => {
  const text = publicContentModerationText({ description: '正常'.repeat(3200), groupInfo: 'tail-bad' });
  assert.match(text, /tail-bad$/);
  const provider = Object.create(AliyunModerationProvider.prototype);
  const requests = [];
  provider.budget = async (_hash, perform) => perform();
  provider.client = {};
  provider.client.request = async (_action, params) => {
    const content = JSON.parse(params.ServiceParameters).content;
    requests.push(content);
    return { Code: 200, Data: { RiskLevel: content.includes('tail-bad') ? 'high' : 'none' } };
  };
  for (const appId of ['', 'test-agent']) {
    config.moderation.textAgentAppId = appId;
    assert.equal((await provider.reviewText({ text })).outcome, 'block');
  }
  assert.ok(requests.some(text => text.includes('tail-bad')));
});

test('chunk boundaries overlap without splitting Unicode characters', () => {
  const chunks = splitModerationText('😀'.repeat(599) + 'sensitive-phrase' + '🧡'.repeat(600), 600);
  assert.ok(chunks.some(chunk => chunk.includes('sensitive-phrase')));
  assert.ok(chunks.every(chunk => Array.from(chunk).length <= 600 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(chunk)));
});
