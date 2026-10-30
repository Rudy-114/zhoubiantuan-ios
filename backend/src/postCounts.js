import { query } from "./db.js";

export async function attachPostCounts(postRows, client = { query }) {
  const ids = uniquePostIds(postRows);
  if (!ids.length) return postRows;

  const [likes, favorites, comments, reports] = await Promise.all([
    countByPost(client, "post_likes", "post_id = ANY($1::text[])", "post_id", ids),
    countByPost(client, "post_favorites", "post_id = ANY($1::text[])", "post_id", ids),
    countByPost(client, "comments", "post_id = ANY($1::text[]) AND status = 'active'", "post_id", ids),
    // Report badges represent actionable moderation pressure; handled/ignored
    // reports should not keep a post looking actively reported forever.
    countByPost(client, "reports", "target_type = 'post' AND status = 'pending' AND target_id = ANY($1::text[])", "target_id", ids)
  ]);

  return postRows.map((row) => ({
    ...row,
    liked_count: likes.get(row.id) || 0,
    favorite_count: favorites.get(row.id) || 0,
    comment_count: comments.get(row.id) || 0,
    report_count: reports.get(row.id) || 0
  }));
}

async function countByPost(client, table, where, column, ids) {
  const { rows } = await client.query(
    `SELECT ${column} AS post_id, count(*)::int AS count
     FROM ${table}
     WHERE ${where}
     GROUP BY ${column}`,
    [ids]
  );
  return new Map(rows.map((row) => [row.post_id, Number(row.count || 0)]));
}

function uniquePostIds(rows) {
  return [...new Set(rows.map((row) => row.id).filter(Boolean))];
}
