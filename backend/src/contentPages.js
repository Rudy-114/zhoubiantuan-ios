import { query } from './db.js';
import { badRequest } from './validators.js';
import { pageSize, readCursor, pageResult } from './pagination.js';
import { visiblePostSQL, visibleCommentSQL, visibleCollectionSQL, unblockedSQL } from './visibility.js';
import { postToClient, userToClient, collectionToClient, commentToClient } from './mappers.js';
import { attachPostCounts } from './postCounts.js';

function keyword(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 120) throw badRequest('搜索词最多 120 字');
  return value.trim();
}
function addCursor(where, params, cursor, alias) {
  if (!cursor) return;
  params.push(cursor.time, cursor.id);
  where.push(`(${alias}.created_at,${alias}.id)<($${params.length-1}::timestamptz,$${params.length})`);
}
function missing() { const error = new Error('内容不存在或不可见'); error.status = 404; return error; }

export async function usersForIDs(ids, viewer = '') {
  if (!ids.length) return [];
  return (await query(`SELECT u.*,
    (SELECT count(*) FROM follows f WHERE f.follower_id=u.id) AS following_count,
    (SELECT count(*) FROM follows f WHERE f.following_id=u.id) AS followers_count,
    (SELECT count(*) FROM posts p WHERE p.author_id=u.id AND ${visiblePostSQL('p','$2',true)}) AS post_count
    FROM users u WHERE u.id=ANY($1::text[]) AND u.status='active' AND u.deleted_at IS NULL AND ${unblockedSQL('u.id','$2')}`,
    [[...new Set(ids)],viewer])).rows.map(row=>userToClient(row,row,viewer));
}

export async function postBundle(rows, viewer = '') {
  const posts = await attachPostCounts(rows), collectionIDs=[...new Set(posts.map(p=>p.collection_id).filter(Boolean))];
  const [users, collections] = await Promise.all([
    usersForIDs(posts.map(p=>p.author_id),viewer),
    collectionIDs.length ? query(`SELECT c.*, ARRAY(SELECT p.id FROM posts p WHERE p.collection_id=c.id AND ${visiblePostSQL('p','$2',true)} ORDER BY p.created_at DESC,p.id DESC LIMIT 50) AS post_ids,
      (SELECT count(*) FROM posts p WHERE p.collection_id=c.id AND ${visiblePostSQL('p','$2',true)}) AS post_count
      FROM group_collections c WHERE c.id=ANY($1::text[]) AND ${visibleCollectionSQL('c','$2',true)}`, [collectionIDs,viewer]).then(r=>r.rows.map(row=>collectionToClient(row,row.post_ids))) : []
  ]);
  return { posts: posts.map(row=>postToClient(row,row)), users, collections };
}

export async function postsPage(viewer = '', input = {}) {
  const limit = pageSize(input.limit, 100), cursor = readCursor(input.cursor), q = keyword(input.q), params = [viewer];
  const own = Boolean(viewer && input.authorID === viewer);
  const where = [visiblePostSQL('p', '$1', own)];
  for (const [key, column] of [['authorID','author_id'], ['collectionID','collection_id'], ['groupType','group_type']]) {
    if (input[key]) {
      if (typeof input[key] !== 'string' || input[key].length > 200) throw badRequest('筛选条件无效');
      params.push(input[key]); where.push(`p.${column}=$${params.length}`);
    }
  }
  for (const [key, table, column] of [['favorites','post_favorites','post_id'], ['likes','post_likes','post_id'], ['following','follows','following_id']]) {
    if (input[key] === 'true') {
      if (!viewer) { const error = badRequest('请先登录'); error.status = 401; throw error; }
      where.push(`EXISTS(SELECT 1 FROM ${table} r WHERE r.${key === 'following' ? 'follower_id' : 'user_id'}=$1 AND r.${column}=p.${key === 'following' ? 'author_id' : 'id'})`);
    }
  }
  const roles = "jsonb_array_elements(CASE WHEN jsonb_typeof(p.unsold_roles)='array' THEN p.unsold_roles ELSE '[]'::jsonb END)";
  const hasStock = "CASE WHEN role->>'quantity' ~ '^[0-9]{1,9}$' THEN (role->>'quantity')::numeric>0 ELSE false END";
  if (q) {
    params.push(q);
    if (input.roles === 'true') where.push(`p.group_type='splitGoods' AND EXISTS(SELECT 1 FROM ${roles} role WHERE ${hasStock} AND strpos(lower(role->>'name'),lower($${params.length}))>0)`);
    else where.push(`strpos(lower(concat_ws(' ',p.title,p.description,p.category_tags::text,p.fandom_tags::text,p.unsold_roles::text,p.pinggu_note)),lower($${params.length}))>0`);
  }
  if (input.inStock === 'true') where.push(`p.group_type='splitGoods' AND EXISTS(SELECT 1 FROM ${roles} role WHERE ${hasStock})`);
  addCursor(where, params, cursor, 'p'); params.push(limit + 1);
  const rows = (await query(`SELECT p.*,p.created_at::text AS page_time FROM posts p WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC,p.id DESC LIMIT $${params.length}`, params)).rows;
  const page = pageResult(rows, limit);
  return { ...await postBundle(page.items, viewer), hasMore: page.hasMore, nextCursor: page.nextCursor };
}

export async function collectionsPage(viewer='',input={}) {
  const limit=pageSize(input.limit),cursor=readCursor(input.cursor),params=[viewer],where=[visibleCollectionSQL('c','$1',true)];
  if(input.ownerID) {params.push(input.ownerID);where.push(`c.owner_id=$${params.length}`);}
  addCursor(where,params,cursor,'c');params.push(limit+1);
  const rows=(await query(`SELECT c.*,c.created_at::text AS page_time,
    ARRAY(SELECT p.id FROM posts p WHERE p.collection_id=c.id AND ${visiblePostSQL('p','$1',true)} ORDER BY p.created_at DESC,p.id DESC LIMIT 50) AS post_ids,
    (SELECT count(*) FROM posts p WHERE p.collection_id=c.id AND ${visiblePostSQL('p','$1',true)}) AS post_count
    FROM group_collections c WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC,c.id DESC LIMIT $${params.length}`,params)).rows;
  const page=pageResult(rows,limit,row=>({...collectionToClient(row,row.post_ids),postCount:Number(row.post_count)}));
  return {collections:page.items,users:await usersForIDs(page.items.map(c=>c.ownerID),viewer),hasMore:page.hasMore,nextCursor:page.nextCursor};
}

export async function commentsPage(postID,viewer='',input={}) {
  if(!(await query(`SELECT 1 FROM posts p WHERE p.id=$1 AND ${visiblePostSQL('p','$2',true)}`,[postID,viewer])).rowCount) throw missing();
  const limit=pageSize(input.limit),cursor=readCursor(input.cursor),params=[viewer,postID],where=['cm.post_id=$2',visibleCommentSQL('cm','$1',true)];
  addCursor(where,params,cursor,'cm');params.push(limit+1);
  const rows=(await query(`SELECT cm.*,cm.created_at::text AS page_time FROM comments cm WHERE ${where.join(' AND ')} ORDER BY cm.created_at DESC,cm.id DESC LIMIT $${params.length}`,params)).rows;
  const page=pageResult(rows,limit,commentToClient);
  return {comments:page.items,users:await usersForIDs(page.items.map(c=>c.authorID),viewer),hasMore:page.hasMore,nextCursor:page.nextCursor};
}

export async function postDetail(postID,viewer='') {
  const rows=(await query(`SELECT p.* FROM posts p WHERE p.id=$1 AND ${visiblePostSQL('p','$2',true)}`,[postID,viewer])).rows;
  if(!rows.length) throw missing();
  const bundle=await postBundle(rows,viewer);
  const comments=await commentsPage(postID,viewer);
  const users=[...new Map([...bundle.users,...comments.users].map(u=>[u.id,u])).values()];
  return {...bundle,users,post:bundle.posts[0],comments:comments.comments,commentsNextCursor:comments.nextCursor,commentsHasMore:comments.hasMore};
}

export async function usersPage(viewer='',input={}) {
  const limit=pageSize(input.limit),cursor=readCursor(input.cursor),params=[viewer],q=keyword(input.q);
  const where=["u.status='active'","u.deleted_at IS NULL",unblockedSQL('u.id','$1')];
  if(input.id) {params.push(input.id);where.push(`u.id=$${params.length}`);}
  if(q) {params.push(q);where.push(`strpos(lower(concat_ws(' ',u.nickname,u.red_book_id,u.bio)),lower($${params.length}))>0`);}
  addCursor(where,params,cursor,'u');params.push(limit+1);
  const rows=(await query(`SELECT u.id,u.created_at::text AS page_time FROM users u WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC,u.id DESC LIMIT $${params.length}`,params)).rows;
  const page=pageResult(rows,limit);
  const users=await usersForIDs(page.items.map(u=>u.id),viewer),map=new Map(users.map(u=>[u.id,u]));
  return {users:page.items.map(r=>map.get(r.id)).filter(Boolean),hasMore:page.hasMore,nextCursor:page.nextCursor};
}
