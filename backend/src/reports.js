import { createHash, randomUUID } from 'node:crypto';
import { query, withTransaction } from './db.js';
import { badRequest } from './validators.js';
import { isModerationAdmin } from './moderation/index.js';
import { visiblePostSQL, visibleCommentSQL, unblockedSQL } from './visibility.js';
import { reportToClient, reportEvidenceToClient } from './mappers.js';
import { createSyncEventsForUsers, createThreadSyncEvents } from './sync.js';
import { readCursor, pageSize, pageResult } from './pagination.js';

const targetTables = { post: 'posts', comment: 'comments', user: 'users', message: 'direct_messages' };
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

async function targetSnapshot(executor, type, id, viewer = null, lock = false) {
  const table = Object.hasOwn(targetTables, type) ? targetTables[type] : null;
  if (!table) throw badRequest('举报类型无效');
  let visibility = 'true', params = [id];
  if (viewer !== null) {
    params.push(viewer);
    if (type === 'post') visibility = visiblePostSQL('t', '$2', true);
    if (type === 'comment') visibility = visibleCommentSQL('t', '$2', true);
    if (type === 'user') visibility = `t.status='active' AND t.deleted_at IS NULL AND ${unblockedSQL('t.id', '$2')}`;
    if (type === 'message') visibility = `t.revoked_at IS NULL AND NOT ($2=ANY(t.deleted_for_user_ids)) AND EXISTS
      (SELECT 1 FROM message_threads mt WHERE mt.id=t.thread_id AND $2 IN (mt.buyer_user_id, mt.publisher_user_id))`;
  }
  // Text preserves PostgreSQL's full timestamp precision for a review-to-decision check.
  const version = type === 'comment' ? "md5(t.body || ':' || t.status)" : type === 'post' ? 't.revision::text' : type === 'message' ? "coalesce(t.revoked_at::text, '') || ':' || t.created_at::text" : 't.updated_at::text';
  const row = (await executor.query(`SELECT t.*, ${version} AS target_version FROM ${table} t WHERE t.id=$1 AND ${visibility} ${lock ? 'FOR UPDATE' : ''}`, params)).rows[0];
  if (!row) return null;
  return snapshotFromRow(type, id, row);
}

function snapshotFromRow(type, id, row) {
  const version = row.target_version || (type === 'comment' ? md5CommentVersion(row) : type === 'post' ? String(row.revision) : type === 'message' ? `${row.revoked_at ? row.revoked_at.toISOString() : ''}:${row.created_at.toISOString()}` : row.updated_at.toISOString());
  const gone = type === 'message' ? Boolean(row.revoked_at) : row.status === 'deleted' || Boolean(row.deleted_at);
  const imageKeys = gone ? [] : type === 'post' ? [...new Set([...row.image_object_keys, ...row.preview_image_object_keys])]
    : type === 'user' ? [row.avatar_object_key, row.background_object_key].filter(Boolean)
    : type === 'message' && row.image_object_key ? [row.image_object_key] : [];
  const body = gone ? '内容已不可用' : type === 'post' ? [row.title, row.description, ...(row.unsold_roles || []).map(r => r.name)].join('\n')
    : type === 'user' ? [row.nickname, row.bio].join('\n') : row.body || '';
  return { row, snapshot: { type, id, ownerID: row.author_id || row.sender_id || row.id, text: body,
    status: gone ? 'deleted' : row.status || 'active', version, imageKeys } };
}

function md5CommentVersion(row) { return createHash('md5').update(`${row.body}:${row.status}`).digest('hex'); }

async function loadCurrentSnapshots(reports) {
  const grouped = new Map();
  for (const report of reports) {
    if (!grouped.has(report.target.type)) grouped.set(report.target.type, []);
    grouped.get(report.target.type).push(report.target.id);
  }
  const result = new Map();
  await Promise.all([...grouped.entries()].map(async ([type, ids]) => {
    const table = targetTables[type];
    if (!table) return;
    // Keep the batch path's evidence version byte-for-byte identical to the
    // locked targetSnapshot path used when a moderator decides a report.
    // PostgreSQL text formatting preserves full timestamp precision and avoids
    // a JS Date round-trip producing a different version.
    const version = type === 'comment' ? "md5(t.body || ':' || t.status)" : type === 'post' ? 't.revision::text'
      : type === 'message' ? "coalesce(t.revoked_at::text, '') || ':' || t.created_at::text" : 't.updated_at::text';
    const rows = (await query(`SELECT t.*, ${version} AS target_version FROM ${table} t WHERE t.id=ANY($1::text[])`, [[...new Set(ids)]])).rows;
    for (const row of rows) result.set(`${type}:${row.id}`, snapshotFromRow(type, row.id, row));
  }));
  return result;
}

export async function submitReport(user, body) {
  const type = body.targetType, id = body.targetID;
  if (typeof type !== 'string' || !Object.hasOwn(targetTables, type) || typeof id !== 'string' || !id || id.length > 200) throw badRequest('举报目标无效');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const detail = typeof body.detail === 'string' ? body.detail.trim() : '';
  if (!reason || reason.length > 100 || detail.length > 2000) throw badRequest('请选择举报原因，说明最多 2000 字');
  return withTransaction(async client => {
    const target = await targetSnapshot(client, type, id, user.id);
    if (!target) throw httpError(404, '举报的内容不存在或无权查看');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`report:${user.id}:${type}:${id}`]);
    const latest = (await client.query('SELECT * FROM reports WHERE reporter_id=$1 AND target_type=$2 AND target_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1', [user.id, type, id])).rows[0];
    if (latest && (latest.status === 'pending' || latest.target_snapshot?.version === target.snapshot.version)) {
      return { report: reportToClient(latest), syncEvents: [], created: false };
    }
    const row = (await client.query(`INSERT INTO reports(id,target_type,target_id,reason,detail,reporter_id,target_snapshot,image_object_keys)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT(reporter_id,target_type,target_id) WHERE status='pending' DO NOTHING RETURNING *`,
      [`rp-${randomUUID()}`, type, id, reason, detail, user.id, JSON.stringify(target.snapshot), target.snapshot.imageKeys])).rows[0];
    const report = row || (await client.query("SELECT * FROM reports WHERE reporter_id=$1 AND target_type=$2 AND target_id=$3 AND status='pending'", [user.id, type, id])).rows[0];
    const syncEvents = row ? await createSyncEventsForUsers(client, { userIds: [user.id], eventType: 'report.updated', entityType: 'report', entityId: report.id }) : [];
    return { report: reportToClient(report), syncEvents, created: Boolean(row) };
  });
}

export async function listReports(user, input, admin = false) {
  if (admin && !isModerationAdmin(user)) throw httpError(403, '需要管理员权限');
  const limit = pageSize(input.limit), cursor = readCursor(input.cursor), params = [];
  const clauses = [];
  if (!admin) { params.push(user.id); clauses.push(`reporter_id=$${params.length}`); }
  if (input.status && input.status !== 'all') {
    if (!['pending','ignored','hidden','removed','warned','suspended'].includes(input.status)) throw badRequest('举报状态无效');
    params.push(input.status); clauses.push(`status=$${params.length}`);
  }
  if (cursor) { params.push(cursor.time, cursor.id); clauses.push(`(created_at,id)<($${params.length-1}::timestamptz,$${params.length})`); }
  params.push(limit + 1);
  const rows = (await query(`SELECT *,created_at::text AS page_time FROM reports ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
    ORDER BY created_at DESC,id DESC LIMIT $${params.length}`, params)).rows;
  const page = pageResult(rows, limit, row => reportToClient(row, admin));
  if (admin) {
    const snapshots = await loadCurrentSnapshots(page.items);
    for (const report of page.items) {
      const current = snapshots.get(`${report.target.type}:${report.target.id}`)?.snapshot;
      report.currentSnapshot = current ? reportEvidenceToClient(current) : null;
    }
  }
  return { reports: page.items, hasMore: page.hasMore, nextCursor: page.nextCursor };
}

export async function decideReport(admin, reportId, body) {
  if (!isModerationAdmin(admin)) throw httpError(403, '需要管理员权限');
  const action = body.action, reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!['ignore','remove','suspend'].includes(action) || !reason || reason.length > 1000) throw badRequest('请选择处理方式并填写理由');
  return withTransaction(async client => {
    const report = (await client.query('SELECT * FROM reports WHERE id=$1 FOR UPDATE', [reportId])).rows[0];
    if (!report) throw httpError(404, '举报不存在');
    if (report.status !== 'pending') throw httpError(409, '该举报已处理，请刷新');
    if ((action === 'suspend' && report.target_type !== 'user') || (action === 'remove' && report.target_type === 'user')) throw badRequest('处理方式不适用于该目标');
    let target, status = 'ignored';
    if (action !== 'ignore') {
      target = await targetSnapshot(client, report.target_type, report.target_id, null, true);
      if (!target) throw httpError(409, '内容已不存在，请刷新后结案');
      if (body.targetVersion !== target.snapshot.version) throw httpError(409, '内容已变化，请刷新并重新核对后处理');
      const row = target.row;
      if (action === 'suspend') {
        if (row.id === admin.id || ['admin','moderator'].includes(row.moderation_role)) throw badRequest('不能通过举报队列停用管理员');
        await client.query("UPDATE users SET status='suspended', is_restricted=true, updated_at=now() WHERE id=$1 AND deleted_at IS NULL", [row.id]);
        status = 'suspended';
      } else if (report.target_type === 'message') {
        await client.query("UPDATE direct_messages SET revoked_at=coalesce(revoked_at,now()), body='', image_object_key=NULL WHERE id=$1", [row.id]);
        await client.query('UPDATE message_threads SET updated_at=now() WHERE id=$1', [row.thread_id]);
        status = 'removed';
      } else {
        await client.query(`UPDATE ${targetTables[report.target_type]} SET status='removed'${report.target_type === 'post' ? ',updated_at=now()' : ''} WHERE id=$1 AND status<>'deleted'`, [row.id]);
        status = 'removed';
      }
    }
    const updated = (await client.query('UPDATE reports SET status=$2,admin_result=$3,handled_by=$4,handled_at=now() WHERE id=$1 RETURNING *', [report.id, status, reason, admin.id])).rows[0];
    const syncEvents = [];
    // Finish every business write before allocating any sync cursor.
    if (target) {
      if (report.target_type === 'message') {
        const thread = (await client.query('SELECT * FROM message_threads WHERE id=$1', [target.row.thread_id])).rows[0];
        syncEvents.push(...await createThreadSyncEvents(client, { userIds: [thread.buyer_user_id, thread.publisher_user_id], eventType: 'message.revoked', entityType: 'direct_message', entityId: target.row.id, threadId: thread.id }));
      } else {
        syncEvents.push(...await createSyncEventsForUsers(client, { userIds: [null, target.snapshot.ownerID], eventType: `${report.target_type}.updated`, entityType: report.target_type, entityId: report.target_id }));
      }
    }
    syncEvents.push(...await createSyncEventsForUsers(client, { userIds: [report.reporter_id, admin.id], eventType: 'report.updated', entityType: 'report', entityId: report.id }));
    return { report: reportToClient(updated, true), syncEvents };
  });
}
