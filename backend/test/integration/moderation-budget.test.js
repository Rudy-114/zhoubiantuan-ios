import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, query, id } from './helpers.js';
import { budgetedModerationCall, moderationCallHash } from '../../src/moderation/budget.js';

test('paid-call reservations enforce a global concurrent budget and uncertain retries do not pay twice', async () => {
  const app = await startTestApp();
  try {
    const { rows: [baseline] } = await query("SELECT COALESCE((SELECT reserved_calls FROM moderation_daily_usage WHERE billing_day=(now() AT TIME ZONE 'Asia/Shanghai')::date),0) AS used");
    const limit = baseline.used + 3;
    let calls = 0;
    const perform = async () => { calls += 1; return { outcome: 'pass' }; };
    const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => budgetedModerationCall(id(), perform, { limit })));
    assert.equal(calls, 3);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 3);
    const higherLimit = limit + 20;
    const key = id();
    await budgetedModerationCall(key, perform, { limit: higherLimit });
    await budgetedModerationCall(key, perform, { limit: higherLimit });
    assert.equal(calls, 4);
    const uncertain = id();
    await assert.rejects(budgetedModerationCall(uncertain, async () => { calls++; throw new Error('network timeout'); }, { limit: higherLimit }));
    await assert.rejects(budgetedModerationCall(uncertain, perform, { limit: higherLimit }));
    assert.equal(calls, 5);
    const same = id();
    await Promise.allSettled(Array.from({ length: 5 }, () => budgetedModerationCall(same, perform, { limit: higherLimit })));
    assert.equal(calls, 6);
    await assert.rejects(budgetedModerationCall(id(), perform, { limit: 0 }));
    assert.equal(calls, 6);
    const image = (url, owner='u-1') => ({ Service: 'safety', ServiceParameters: JSON.stringify({ imageUrl: url, ossObjectName: 'guarded/post/u-1/image.jpg', accountId: owner }) });
    assert.equal(moderationCallHash('ImageModeration', image('signed-one')), moderationCallHash('ImageModeration', image('signed-two')));
    assert.notEqual(moderationCallHash('ImageModeration', image('signed-one')), moderationCallHash('ImageModeration', image('signed-one', 'u-2')));
  } finally { await app.close(); }
});
