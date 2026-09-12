import { createHash } from "node:crypto";
import { config } from "../config.js";
import { query, withTransaction } from "../db.js";
import { logger } from "../logger.js";

// Cache only exact provider inputs in the same billing day. Signed URLs and diagnostic
// data IDs vary on retry but the immutable object key and account remain in the hash.
export function moderationCallHash(action, params) {
  const service = JSON.parse(params.ServiceParameters || "{}");
  delete service.dataId;
  if (service.ossObjectName) delete service.imageUrl;
  const stable = value => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    : Array.isArray(value) ? value.map(stable) : value;
  return createHash("sha256").update(JSON.stringify(stable({ version: 1, endpoint: config.moderation.endpoint,
    action, ...params, ServiceParameters: service }))).digest("hex");
}

export async function budgetedModerationCall(hash, perform, { limit = config.moderation.dailyCallLimit } = {}) {
  const claim = await withTransaction(async client => {
    const { rows: [clock] } = await client.query("SELECT (now() AT TIME ZONE 'Asia/Shanghai')::date::text AS day");
    const args = [clock.day, hash];
    const inserted = await client.query(`INSERT INTO moderation_call_receipts(billing_day,request_hash,status)
      VALUES($1,$2,'reserved') ON CONFLICT DO NOTHING RETURNING request_hash`, args);
    if (!inserted.rows.length) {
      const { rows: [receipt] } = await client.query('SELECT status,result FROM moderation_call_receipts WHERE billing_day=$1 AND request_hash=$2', args);
      return { ...receipt, day: clock.day, owner: false };
    }
    const reservation = await client.query(`INSERT INTO moderation_daily_usage(billing_day,reserved_calls)
      SELECT $1::date,1 WHERE $2::integer > 0
      ON CONFLICT(billing_day) DO UPDATE SET reserved_calls=moderation_daily_usage.reserved_calls+1
      WHERE moderation_daily_usage.reserved_calls < $2 RETURNING reserved_calls`, [clock.day, limit]);
    if (!reservation.rows.length) {
      // Roll back the receipt too: raising a reviewed budget later can resume this exact request.
      const error = new Error('今日自动审核额度已用完，内容转人工复核');
      error.code = 'MODERATION_DAILY_BUDGET_EXHAUSTED';
      throw error;
    }
    return { day: clock.day, owner: true };
  });
  if (!claim.owner) {
    if (claim.status === 'completed' && claim.result) return claim.result;
    throw new Error('相同内容审核处理中或结果待核实，暂转人工复核');
  }
  try {
    // Reserve before the external request. An uncertain timeout still consumes a slot;
    // retrying cannot launch another potentially billable call for this input today.
    const result = await perform();
    await query(`UPDATE moderation_call_receipts SET status='completed',result=$3::jsonb
      WHERE billing_day=$1 AND request_hash=$2`, [claim.day, hash, JSON.stringify(result)]);
    return result;
  } catch (error) {
    await query(`UPDATE moderation_call_receipts SET status='uncertain' WHERE billing_day=$1 AND request_hash=$2`, [claim.day, hash])
      .catch(() => {});
    logger.warn('moderation.call_uncertain', { code: error.code });
    throw error;
  }
}

export async function pruneModerationReceipts() {
  await query("DELETE FROM moderation_call_receipts WHERE billing_day < (now() AT TIME ZONE 'Asia/Shanghai')::date - 7");
  await query("DELETE FROM moderation_daily_usage WHERE billing_day < (now() AT TIME ZONE 'Asia/Shanghai')::date - 30");
}
