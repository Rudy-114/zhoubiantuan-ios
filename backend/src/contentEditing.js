import { assertUnrestrictedUser } from "./auth.js";
import { query, withTransaction } from './db.js';
import { badRequest } from './validators.js';
import { postToClient } from './mappers.js';
import { createModerationReview, reviewSubmission } from './moderation/index.js';
import { postModerationSnapshot, publicContentModerationText } from './moderation/text.js';
import { createSyncEventsForUsers } from './sync.js';

export function assertRevision(row, revision) {
  if (!Number.isSafeInteger(revision) || revision < 1) throw badRequest('请更新客户端并重新加载后编辑');
  if (!row || row.status === 'deleted' || row.revision !== revision) {
    const error = new Error('内容已被修改，请重新加载最新内容后再保存');
    error.status = 409;
    error.code = 'revision_conflict';
    throw error;
  }
}

export function validateRoles(roles) {
  if (!Array.isArray(roles) || roles.length > 64) throw badRequest('角色最多 64 个');
  const ids = new Set();
  return roles.map(role => {
    if (!role || typeof role.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(role.id) || ids.has(role.id)) throw badRequest('角色编号无效或重复');
    ids.add(role.id);
    if (typeof role.name !== 'string' || !role.name.trim() || [...role.name.trim()].length > 80) throw badRequest('角色名须为 1 至 80 字');
    if (!Number.isSafeInteger(role.quantity) || role.quantity < 0 || role.quantity > 999999) throw badRequest('角色数量须为 0 至 999999 的整数');
    if (typeof role.priceAdjustment !== 'number' || !Number.isFinite(role.priceAdjustment) || Math.abs(role.priceAdjustment) > 999999) throw badRequest('角色调价无效');
    return { id: role.id, name: role.name.trim(), quantity: role.quantity, priceAdjustment: role.priceAdjustment };
  });
}

export async function editPost(userId, postId, body) {
  const current = (await query("SELECT * FROM posts WHERE id=$1 AND author_id=$2 AND status <> 'deleted'", [postId, userId])).rows[0];
  if (!current) { const error = new Error('只能编辑自己的帖子'); error.status = 404; throw error; }
  assertRevision(current, body.revision);
  if (current.status !== 'active' || current.safety_status !== 'active') throw badRequest('请通过重新投稿修改未公开的帖子');
  if (!Object.hasOwn(body, 'unsoldRoles') && !Object.hasOwn(body, 'collectionID')) throw badRequest('没有可保存的修改');
  const roles = validateRoles(body.unsoldRoles ?? current.unsold_roles);
  const collectionId = Object.hasOwn(body, 'collectionID') ? body.collectionID : current.collection_id;
  if (typeof collectionId !== 'string' || !collectionId) throw badRequest('帖子必须属于一个合集');
  const collection = (await query("SELECT * FROM group_collections WHERE id=$1 AND owner_id=$2 AND status='active'", [collectionId, userId])).rows[0];
  if (!collection) throw badRequest('请选择自己已通过审核的合集');
  const names = rows => JSON.stringify(rows.map(role => [role.id, role.name]));
  const needsReview = names(roles) !== names(current.unsold_roles);
  const snapshot = postModerationSnapshot({ ...postToClient(current), unsoldRoles: roles }, collection, current.title);
  const text = publicContentModerationText(snapshot);
  // Numeric stock changes never make a hidden/rejected post public. Text edits are reviewed again.
  const moderation = needsReview ? await reviewSubmission({ targetType: 'post', targetId: postId, ownerId: userId, text }) : { status: 'active' };
  return withTransaction(async client => {
    await assertUnrestrictedUser(client, userId);
    const collections = (await client.query('SELECT * FROM group_collections WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE', [[...new Set([current.collection_id, collectionId].filter(Boolean))]])).rows;
    const latestCollection = collections.find(row => row.id === collectionId);
    assertRevision(latestCollection, collection.revision);
    if (latestCollection.owner_id !== userId || latestCollection.status !== 'active' || latestCollection.safety_status !== 'active') throw badRequest('合集当前不可用');
    const latest = (await client.query('SELECT * FROM posts WHERE id=$1 FOR UPDATE', [postId])).rows[0];
    assertRevision(latest, body.revision);
    if (latest.safety_status !== "active") throw badRequest("请通过整改流程修改受限帖子");
    const post = (await client.query(`UPDATE posts SET unsold_roles=$2::jsonb, collection_id=$3,
      deadline=$4, wechat=$5, qq=$6, group_number=$7, group_info=$8, status=$9, updated_at=now()
      WHERE id=$1 RETURNING *`, [postId, JSON.stringify(roles), collectionId, latestCollection.deadline,
      latestCollection.contact_wechat, latestCollection.contact_qq, latestCollection.contact_group_number,
      latestCollection.group_info, moderation.status])).rows[0];
    if (moderation.status !== 'active') await createModerationReview(client, {
      targetType: 'post', targetId: postId, ownerId: userId, result: moderation, textSnapshot: text,
      imageObjectKeys: [...new Set([...current.image_object_keys, ...current.preview_image_object_keys])], snapshot
    });
    const syncEvents = await createSyncEventsForUsers(client, { userIds: [userId, null], eventType: 'post.updated', entityType: 'post', entityId: postId });
    if (collectionId !== current.collection_id) {
      for (const id of [...new Set([current.collection_id, collectionId].filter(Boolean))]) {
        syncEvents.push(...await createSyncEventsForUsers(client, { userIds: [userId, null], eventType: 'collection.updated', entityType: 'collection', entityId: id }));
      }
    }
    return { post: postToClient(post), moderation, syncEvents };
  });
}
