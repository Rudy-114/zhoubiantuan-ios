import { randomUUID } from 'node:crypto';
import { query, withTransaction } from './db.js';
import { badRequest } from './validators.js';
import { visiblePostSQL } from './visibility.js';
import { attachPostCounts } from './postCounts.js';
import { rankFeedCandidates, experimentForUser, FEED_ALGORITHM_VERSION, FEED_SNAPSHOT_TTL_MS } from './feedRanking.js';
import { logger } from './logger.js';

const CANDIDATE_LIMIT = 1500;
export function feedQueryKey(mode, groupType = '', refreshSeed = '') {
  // A refresh starts a new ranking snapshot. Keep the seed in the query key so
  // pagination remains pinned to the same ordering while a later pull can ask
  // for a fresh, slightly exploratory ordering. Preserve the old key shape for
  // callers that do not send a seed so cursors issued before this rollout keep
  // working during the transition.
  return refreshSeed ? JSON.stringify({ mode, groupType, refreshSeed }) : JSON.stringify({ mode, groupType });
}
export function readFeedCursor(value) {
  if (!value) return null;
  try {
    if (typeof value !== 'string' || value.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (parsed.kind !== 'feed' || typeof parsed.snapshot !== 'string' || !/^fs-[a-f0-9-]{36}$/.test(parsed.snapshot)
      || !Number.isSafeInteger(parsed.position) || parsed.position < 0 || parsed.position >= CANDIDATE_LIMIT
      || !Number.isFinite(Number(parsed.score)) || typeof parsed.time !== 'string' || !Number.isFinite(Date.parse(parsed.time))
      || typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 200
      || parsed.version !== FEED_ALGORITHM_VERSION || typeof parsed.query !== 'string' || parsed.query.length > 200) throw new Error();
    return parsed;
  } catch { throw badRequest('信息流游标无效，请刷新列表'); }
}
function negativeFeedbackSQL() {
  return `NOT EXISTS (SELECT 1 FROM feed_events e WHERE e.user_id=$1 AND e.event_type='notInterested' AND e.post_id=p.id AND e.created_at > now()-interval '90 days')
    AND NOT EXISTS (SELECT 1 FROM feed_events e JOIN posts hidden ON hidden.id=e.post_id WHERE e.user_id=$1 AND e.event_type='hideAuthor' AND hidden.author_id=p.author_id AND e.created_at > now()-interval '90 days')`;
}
async function signalsFor(viewer) {
  const [follows, interactions, events] = await Promise.all([
    query('SELECT following_id FROM follows WHERE follower_id=$1', [viewer]),
    query(`SELECT p.category_tags,p.fandom_tags, x.weight FROM (
      SELECT post_id,2 AS weight FROM post_likes WHERE user_id=$1
      UNION ALL SELECT post_id,4 AS weight FROM post_favorites WHERE user_id=$1
      ) x JOIN posts p ON p.id=x.post_id WHERE ${visiblePostSQL('p','$1')} ORDER BY p.created_at DESC LIMIT 500`, [viewer]),
    query(`SELECT e.post_id,e.event_type,e.dwell_ms,p.category_tags,p.fandom_tags FROM feed_events e
      JOIN posts p ON p.id=e.post_id WHERE e.user_id=$1 AND e.created_at>now()-interval '14 days'
      AND ${visiblePostSQL('p','$1')} ORDER BY e.created_at DESC LIMIT 2000`, [viewer])
  ]);
  const tagWeights = {}, seenPostIDs = new Set();
  const accumulate = (row, weight) => { for (const tag of new Set([...(row.category_tags || []), ...(row.fandom_tags || [])])) {
    const key = tag.toLowerCase(); tagWeights[key] = Math.min(100, (tagWeights[key] || 0) + weight);
  }};
  for (const row of interactions.rows) accumulate(row, Number(row.weight));
  for (const row of events.rows) {
    if (['impression','open','complete'].includes(row.event_type)) seenPostIDs.add(row.post_id);
    const weight = { open:.15, complete:1, share:2, comment:2, follow:3 }[row.event_type]
      ?? (row.event_type === 'dwell' ? Math.min(2, Number(row.dwell_ms || 0)/30000) : 0);
    if (weight) accumulate(row, weight);
  }
  return { followedAuthorIDs:follows.rows.map(row=>row.following_id), tagWeights, seenPostIDs:[...seenPostIDs] };
}

export async function personalizedFeed(viewer, input, limit, mode) {
  const started = performance.now();
  const groupType = input.groupType || '';
  if (groupType && !['followGroup','splitGoods'].includes(groupType)) throw badRequest('筛选条件无效');
  const refreshSeed = input.refreshSeed === undefined ? '' : String(input.refreshSeed);
  if (refreshSeed.length > 80 || !/^[A-Za-z0-9_-]*$/.test(refreshSeed)) throw badRequest('刷新参数无效');
  const queryKey = feedQueryKey(mode, groupType, refreshSeed), cursor = readFeedCursor(input.cursor);
  if (cursor && cursor.query !== queryKey) throw badRequest('信息流筛选已变化，请刷新列表');
  let snapshot;
  if (cursor) {
    snapshot = (await query(`SELECT * FROM feed_snapshots WHERE id=$1 AND viewer_id=$2 AND query_key=$3 AND algorithm_version=$4 AND expires_at>now()`,
      [cursor.snapshot,viewer,queryKey,FEED_ALGORITHM_VERSION])).rows[0];
    if (!snapshot) { const error = badRequest('信息流已更新，请下拉刷新'); error.status=409; error.apiCode='feed_snapshot_expired'; throw error; }
  } else {
    const signals = await signalsFor(viewer);
    const tags = Object.entries(signals.tagWeights).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([tag])=>tag);
    // Four bounded recall sources: new content, followed authors, related tags,
    // and engagement. UNION deduplicates IDs before the one batched count read.
    const visibility = `${visiblePostSQL('p','$1')} AND ${negativeFeedbackSQL()} AND ($2='' OR p.group_type=$2)
      AND ($3<>'following' OR p.author_id=ANY($4::text[]))`;
    const candidates = (await query(`WITH eligible AS MATERIALIZED (
      SELECT p.id,p.author_id,p.created_at,p.category_tags,p.fandom_tags FROM posts p WHERE ${visibility}
      ), recall AS (
        (SELECT id FROM eligible ORDER BY created_at DESC,id DESC LIMIT 700)
        UNION (SELECT id FROM eligible WHERE author_id=ANY($4::text[]) ORDER BY created_at DESC,id DESC LIMIT 300)
        UNION (SELECT id FROM eligible WHERE category_tags && $5::text[] OR fandom_tags && $5::text[] ORDER BY created_at DESC,id DESC LIMIT 300)
        UNION (SELECT e.id FROM eligible e LEFT JOIN post_favorites f ON f.post_id=e.id GROUP BY e.id,e.created_at ORDER BY count(f.post_id) DESC,e.created_at DESC,e.id DESC LIMIT 200)
      ) SELECT p.*,COALESCE(c.deadline,p.deadline) AS effective_deadline FROM recall r JOIN posts p ON p.id=r.id LEFT JOIN group_collections c ON c.id=p.collection_id`,
      [viewer,groupType,mode,signals.followedAuthorIDs,tags])).rows;
    const counted = await attachPostCounts(candidates);
    const ranked = rankFeedCandidates(counted, signals, { now:new Date(), mode, refreshSeed }).slice(0,CANDIDATE_LIMIT);
    const snapshotID = `fs-${randomUUID()}`;
    snapshot = await withTransaction(async client => {
      const row = (await client.query(`INSERT INTO feed_snapshots(id,viewer_id,feed_mode,query_key,algorithm_version,expires_at)
        VALUES($1,$2,$3,$4,$5,now()+($6::int*interval '1 millisecond')) RETURNING *`, [snapshotID,viewer,mode,queryKey,FEED_ALGORITHM_VERSION,FEED_SNAPSHOT_TTL_MS])).rows[0];
      if (ranked.length) await client.query(`INSERT INTO feed_snapshot_items(snapshot_id,position,post_id,score,post_created_at,rank_reason)
        SELECT $1,x.position,x.post_id,x.score,x.post_created_at,x.rank_reason FROM jsonb_to_recordset($2::jsonb)
        AS x(position integer,post_id text,score double precision,post_created_at timestamptz,rank_reason text)`,
        [snapshotID,JSON.stringify(ranked.map((post,position)=>({position,post_id:post.id,score:post.feed_score,post_created_at:post.created_at,rank_reason:post.rank_reason})))]);
      return row;
    });
    logger.info('feed.snapshot_created', { viewerID:viewer, snapshotID, candidates:candidates.length, algorithmVersion:FEED_ALGORITHM_VERSION, durationMs:Math.round(performance.now()-started) });
  }
  // Visibility/negative feedback are rechecked on every page; a saved ranking is
  // never permission to reveal content removed after the first request.
  if (cursor) {
    const boundary = (await query(`SELECT i.score,i.post_created_at,p.id FROM feed_snapshot_items i JOIN posts p ON p.id=i.post_id WHERE i.snapshot_id=$1 AND i.position=$2`, [snapshot.id,cursor.position])).rows[0];
    if (!boundary || Number(boundary.score) !== Number(cursor.score) || boundary.id !== cursor.id || new Date(boundary.post_created_at).toISOString() !== new Date(cursor.time).toISOString()) {
      const error = badRequest('信息流游标已失效，请刷新列表'); error.status=409; error.apiCode='feed_cursor_stale'; throw error;
    }
  }
  const rows = (await query(`SELECT p.*,COALESCE(c.deadline,p.deadline) AS effective_deadline,i.position,i.score AS feed_score,i.rank_reason,i.post_created_at
    FROM feed_snapshot_items i JOIN posts p ON p.id=i.post_id LEFT JOIN group_collections c ON c.id=p.collection_id
    WHERE i.snapshot_id=$2 AND i.position>$3 AND ${visiblePostSQL('p','$1')} AND ${negativeFeedbackSQL()}
    ORDER BY i.position LIMIT $4`, [viewer,snapshot.id,cursor?.position ?? -1,limit+1])).rows;
  const items=rows.slice(0,limit), hasMore=rows.length>limit, last=items.at(-1);
  const nextCursor=hasMore ? Buffer.from(JSON.stringify({kind:'feed',snapshot:snapshot.id,position:last.position,score:Number(last.feed_score),time:new Date(last.post_created_at).toISOString(),id:last.id,query:queryKey,version:FEED_ALGORITHM_VERSION})).toString('base64url') : null;
  logger.info('feed.page', { snapshotID:snapshot.id, returned:items.length, hasMore, durationMs:Math.round(performance.now()-started) });
  return { items, hasMore, nextCursor, feed:{mode,algorithmVersion:FEED_ALGORITHM_VERSION,personalized:true,requestID:snapshot.id,snapshotExpiresAt:snapshot.expires_at,experiment:experimentForUser(viewer)} };
}

export async function pruneFeedData() {
  const snapshots=await query('DELETE FROM feed_snapshots WHERE expires_at<=now()');
  const events=await query("DELETE FROM feed_events WHERE created_at<now()-interval '90 days'");
  return { snapshots:snapshots.rowCount, events:events.rowCount };
}

export function startFeedDataPruner({ intervalMs = 60 * 60 * 1000 } = {}) {
  const run = () => pruneFeedData().catch(error => logger.error('feed.prune_failed', { error }));
  run();
  return setInterval(run, intervalMs);
}
