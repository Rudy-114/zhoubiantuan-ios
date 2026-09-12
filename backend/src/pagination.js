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
    return cursor;
  } catch { throw badRequest('分页游标无效，请刷新列表'); }
}
export function pageResult(rows, limit, map = row => row) {
  const items = rows.slice(0, limit), last = items.at(-1);
  return { items: items.map(map), hasMore: rows.length > limit,
    nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ time: last.page_time, id: last.id })).toString('base64url') : null };
}
