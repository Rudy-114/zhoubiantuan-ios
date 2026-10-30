import { badRequest } from './validators.js';

export function pageSize(value, maximum = 50) {
  if (value === undefined) return Math.min(30, maximum);
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 1 || size > maximum) throw badRequest('分页数量无效');
  return size;
}
export function readCursor(value) {
  if (!value) return null;
  try {
    if (typeof value !== 'string' || value.length > 1000) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof cursor.time !== 'string' || cursor.time.length > 80 || !Number.isFinite(Date.parse(cursor.time)) || typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 200) throw new Error();
    // Personalized feeds sort by a stable score before the timestamp/id tie-breaker.
    // Keep this field optional so cursors from the existing chronological endpoints
    // remain valid and backwards compatible.
    if (cursor.score !== undefined && (cursor.score === '' || (typeof cursor.score !== 'number' && typeof cursor.score !== 'string') || !Number.isFinite(Number(cursor.score)) || String(cursor.score).length > 64)) throw new Error();
    return cursor;
  } catch { throw badRequest('分页游标无效，请刷新列表'); }
}
export function pageResult(rows, limit, map = row => row) {
  const items = rows.slice(0, limit), last = items.at(-1);
  const cursor = last ? { time: last.page_time, id: last.id } : null;
  if (cursor && last.feed_score !== undefined && last.feed_score !== null) cursor.score = Number(last.feed_score);
  return { items: items.map(map), hasMore: rows.length > limit,
    nextCursor: rows.length > limit ? Buffer.from(JSON.stringify(cursor)).toString('base64url') : null };
}
