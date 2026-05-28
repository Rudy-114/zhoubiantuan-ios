import { directMessageToClient, messageThreadToClient } from "./mappers.js";

export async function loadMessageThreadForUser(client, threadId, userId) {
  const thread = await client.query(
    `SELECT mt.*,
      (SELECT count(*)
       FROM direct_messages dm
       WHERE dm.thread_id = mt.id
         AND dm.sender_id <> $2
         AND dm.created_at > COALESCE(
           (SELECT r.read_at FROM message_thread_reads r WHERE r.thread_id = mt.id AND r.user_id = $2),
           '-infinity'::timestamptz
         )) AS unread_count
     FROM message_threads mt
     WHERE mt.id = $1
       AND (mt.buyer_user_id = $2 OR mt.publisher_user_id = $2)`,
    [threadId, userId]
  );
  const row = thread.rows[0];
  if (!row) {
    const error = new Error("会话不存在");
    error.status = 404;
    throw error;
  }
  const messages = await client.query("SELECT * FROM direct_messages WHERE thread_id = $1 ORDER BY created_at ASC", [threadId]);
  return messageThreadToClient(row, messages.rows.map(directMessageToClient));
}

export async function loadMessageThreadsForUser(client, threadIds, userId) {
  const uniqueThreadIds = [...new Set(threadIds.filter(Boolean))];
  if (!uniqueThreadIds.length) return [];

  const threads = await Promise.all(uniqueThreadIds.map((threadId) => loadMessageThreadForUser(client, threadId, userId)));
  return threads.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
