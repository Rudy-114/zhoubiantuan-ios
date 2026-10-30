import { createHash } from 'node:crypto';

export const FEED_ALGORITHM_VERSION = 'rules-v2';
export const FEED_SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
export const FEED_EVENT_RETENTION_DAYS = 90;

export function experimentForUser(userID) {
  // Stable assignment makes offline replay and later controlled experiments
  // comparable; both cohorts currently use the same production rule weights.
  const bucket = createHash('sha256').update(userID).digest()[0] % 100;
  return { name: 'feed-rules-v2', cohort: bucket < 10 ? 'holdout' : 'treatment', bucket };
}

export function rankFeedCandidates(candidates, signals, { now = new Date(), mode = 'forYou', refreshSeed = '' } = {}) {
  const at = Number(now), followed = new Set(signals.followedAuthorIDs || []);
  const preferences = new Map(Object.entries(signals.tagWeights || {}));
  const seen = new Set(signals.seenPostIDs || []);
  const scored = candidates.map(post => {
    const ageDays = Math.max(0, (at - Number(new Date(post.created_at))) / 86400000);
    const freshness = 6 * Math.exp(-ageDays / 5);
    const follow = followed.has(post.author_id) ? 5 : 0;
    const tags = [...new Set([...(post.category_tags || []), ...(post.fandom_tags || [])].map(tag => tag.toLowerCase()))];
    const affinity = Math.min(5, tags.reduce((total, tag) => total + Math.log1p(preferences.get(tag) || 0), 0));
    const engagement = Math.min(4, Math.log1p(Number(post.liked_count || 0) + 2 * Number(post.favorite_count || 0) + .75 * Number(post.comment_count || 0)));
    const ended = Number(new Date(post.effective_deadline || post.deadline)) <= at;
    const available = post.group_type === 'splitGoods' && (post.unsold_roles || []).some(role => Number(role.quantity) > 0);
    const seenPenalty = seen.has(post.id) ? 7 : 0;
    // A pull-to-refresh gets a fresh exploration seed. Keep this small enough
    // that strong personalization still wins, while allowing the next page to
    // surface a different set of equally relevant posts instead of replaying
    // the exact same first screen forever.
    const exploration = mode === 'forYou' && refreshSeed
      ? (createHash('sha256').update(`${refreshSeed}:${post.id}`).digest()[0] / 255) * 1.8
      : 0;
    const score = mode === 'following' ? freshness - (ended ? 4 : 0)
      : freshness + follow + affinity + engagement + (available ? .5 : 0) - (ended ? 6 : 0) - seenPenalty + exploration;
    const reasons = [follow && 'followed_author', affinity > 0 && 'related_tags', ageDays < 2 && 'fresh', engagement > 1 && 'community_interest', available && 'in_stock', ended && 'ended', seenPenalty && 'seen_recently'].filter(Boolean);
    return { ...post, feed_score: score, rank_reason: reasons.join(','), feed_tags: tags };
  }).sort((a,b) => b.feed_score - a.feed_score || Number(new Date(b.created_at)) - Number(new Date(a.created_at)) || b.id.localeCompare(a.id));
  if (mode === 'following') return scored;
  // Reorder rather than discard a prolific author's posts. A rolling author/tag
  // penalty spreads similar content while guaranteeing all candidates stay reachable.
  const ordered = [], remaining = [...scored];
  while (remaining.length) {
    const recent = ordered.slice(-5);
    let selected = 0, best = -Infinity;
    for (let i = 0; i < Math.min(50, remaining.length); i++) {
      const item = remaining[i];
      const authorPenalty = recent.filter(post => post.author_id === item.author_id).length * 4;
      const tagPenalty = recent.length && item.feed_tags.some(tag => recent.at(-1).feed_tags.includes(tag)) ? 1 : 0;
      const diversityScore = item.feed_score - authorPenalty - tagPenalty;
      if (diversityScore > best) { selected = i; best = diversityScore; }
    }
    ordered.push(remaining.splice(selected, 1)[0]);
  }
  return ordered;
}
