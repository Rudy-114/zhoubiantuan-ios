import { directMessageToClient, messageThreadToClient } from './mappers.js';
import { pageSize, readCursor, pageResult } from './pagination.js';
import { usersForIDs, postBundle } from './contentPages.js';
import { visiblePostSQL } from './visibility.js';
import { query } from './db.js';

function unreadSQL(user) {
  return `(SELECT count(*) FROM direct_messages dm WHERE dm.thread_id=mt.id AND dm.revoked_at IS NULL AND dm.safety_status='active'
    AND NOT (${user}=ANY(dm.deleted_for_user_ids)) AND dm.sender_id<>${user}
    AND dm.created_at>coalesce((SELECT r.read_at FROM message_thread_reads r WHERE r.thread_id=mt.id AND r.user_id=${user}),'-infinity'::timestamptz))`;
}

export async function loadMessageThreadForUser(client, threadId, userId, { messageIDs, cursor, limit, legacyComplete = false } = {}) {
  const row = (await client.query(`SELECT mt.*, ${unreadSQL('$2')} AS unread_count FROM message_threads mt
    WHERE mt.id=$1 AND $2 IN(mt.buyer_user_id,mt.publisher_user_id)`, [threadId,userId])).rows[0];
  if (!row) { const error = new Error('会话不存在'); error.status = 404; throw error; }
  let messages, page;
  if (messageIDs !== undefined) {
    const ids = [...new Set(messageIDs)].slice(0, 200);
    messages = ids.length ? (await client.query('SELECT * FROM direct_messages WHERE thread_id=$1 AND id=ANY($2::text[]) ORDER BY created_at,id', [threadId,ids])).rows : [];
  } else {
    const size = legacyComplete ? 2000 : pageSize(limit, 100), boundary = readCursor(cursor), params = [threadId];
    let where = 'thread_id=$1';
    if (boundary) { params.push(boundary.time,boundary.id); where += ' AND (created_at,id)<($2::timestamptz,$3)'; }
    params.push(size+1);
    const rows = (await client.query(`SELECT *,created_at::text AS page_time FROM direct_messages WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $${params.length}`,params)).rows;
    page = pageResult(rows,size); messages = page.items.reverse();
  }
  await redactSharedReferences(client, [row], messages, userId);
  return { ...messageThreadToClient(row,messages.map(message=>directMessageToClient(message,userId))),
    messagesArePartial: !legacyComplete, ...(page ? {nextCursor:page.nextCursor,hasMore:page.hasMore} : {}) };
}

export async function loadMessageThreadsForUser(client, threadIds, userId, messageIdsByThread = {}) {
  const uniqueThreadIds = [...new Set(threadIds.filter(Boolean))];
  // A read event sends metadata only. Changed message IDs include explicit tombstones.
  const threads = await Promise.all(uniqueThreadIds.map(id=>loadMessageThreadForUser(client,id,userId,{messageIDs:messageIdsByThread[id] || []})));
  return threads.sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
}

export async function loadThreadsPage(client, userId, input = {}) {
  const limit=pageSize(input.limit),cursor=readCursor(input.cursor),params=[userId];
  let where = '$1 IN(mt.buyer_user_id,mt.publisher_user_id)';
  if(cursor) {params.push(cursor.time,cursor.id);where+=' AND (mt.updated_at,mt.id)<($2::timestamptz,$3)';}
  params.push(limit+1);
  const rows=(await client.query(`SELECT mt.*,mt.updated_at::text AS page_time,${unreadSQL('$1')} AS unread_count
    FROM message_threads mt WHERE ${where} ORDER BY mt.updated_at DESC,mt.id DESC LIMIT $${params.length}`,params)).rows;
  const page=pageResult(rows,limit);
  const previews=page.items.length ? (await client.query(`SELECT dm.* FROM unnest($1::text[]) AS requested(thread_id)
    CROSS JOIN LATERAL (SELECT * FROM direct_messages d WHERE d.thread_id=requested.thread_id AND d.revoked_at IS NULL AND d.safety_status='active'
      AND NOT ($2=ANY(d.deleted_for_user_ids)) ORDER BY d.created_at DESC,d.id DESC LIMIT 1) dm`, [page.items.map(row=>row.id),userId])).rows : [];
  await redactSharedReferences(client, page.items, previews, userId);
  const byThread=new Map(previews.map(row=>[row.thread_id,row]));
  const threads=page.items.map(row=>({...messageThreadToClient(row,byThread.has(row.id)?[directMessageToClient(byThread.get(row.id),userId)]:[]),messagesArePartial:true}));
  return {messageThreads:threads,users:await usersForIDs(threads.flatMap(t=>[t.buyerUserID,t.publisherUserID]),userId),
    hasMore:page.hasMore,nextCursor:page.nextCursor,...await loadUnreadSnapshot(userId)};
}

export async function messageHistoryPage(userId,threadId,input={}) {
  const thread=await loadMessageThreadForUser({query},threadId,userId,input);
  const userIDs=[thread.buyerUserID,thread.publisherUserID,...thread.messages.map(m=>m.senderID)];
  const sharedPostIDs=[...new Set([thread.relatedPostID,...thread.messages.map(m=>m.sharedPostID)].filter(Boolean))];
  const shared=sharedPostIDs.length?(await query(`SELECT p.* FROM posts p WHERE p.id=ANY($1::text[]) AND ${visiblePostSQL('p','$2',true)}`,[sharedPostIDs,userId])).rows:[];
  const bundle=await postBundle(shared,userId),users=await usersForIDs([...userIDs,...thread.messages.map(m=>m.sharedProfileUserID).filter(Boolean)],userId);
  return {...bundle,thread,messageThreads:[thread],users:[...new Map([...users,...bundle.users].map(u=>[u.id,u])).values()],
    nextCursor:thread.nextCursor,hasMore:thread.hasMore};
}

export async function loadUnreadSnapshot(userId) {
  const row = (await query(`SELECT s.cursor::text AS unread_cursor,
    (SELECT count(*) FROM direct_messages dm JOIN message_threads mt ON mt.id=dm.thread_id
      WHERE $1 IN(mt.buyer_user_id,mt.publisher_user_id) AND dm.sender_id<>$1 AND dm.revoked_at IS NULL AND dm.safety_status='active'
      AND NOT ($1=ANY(dm.deleted_for_user_ids)) AND dm.created_at>coalesce(
        (SELECT r.read_at FROM message_thread_reads r WHERE r.thread_id=mt.id AND r.user_id=$1),'-infinity'::timestamptz)) AS unread_count
    FROM sync_state s WHERE s.singleton`, [userId])).rows[0];
  return { unreadMessageCount: Number(row.unread_count), unreadCursor: row.unread_cursor };
}

async function redactSharedReferences(client, threads, messages, userId) {
  const ids=[...new Set([...threads.map(t=>t.related_post_id),...messages.map(m=>m.shared_post_id)].filter(Boolean))];
  if(!ids.length)return;
  const visible=new Set((await client.query(`SELECT p.id FROM posts p WHERE p.id=ANY($1::text[]) AND ${visiblePostSQL('p','$2')}`,[ids,userId])).rows.map(p=>p.id));
  for(const row of threads)if(row.related_post_id && !visible.has(row.related_post_id))row.related_post_id=null;
  for(const row of messages)if(row.shared_post_id && !visible.has(row.shared_post_id))row.shared_post_id=null;
}
