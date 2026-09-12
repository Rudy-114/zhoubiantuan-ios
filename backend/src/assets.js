import { query } from "./db.js";
import { isModerationAdmin } from "./moderation/index.js";
import { visiblePostSQL, unblockedSQL } from "./visibility.js";

export async function canReadAsset(key, user) {
  if (!/^(guarded\/)?(post|avatar|background|message)\//.test(key) || key.includes("..")) return false;
  const viewer = user?.id || "";
  const { rows } = await query(`SELECT (
    EXISTS (SELECT 1 FROM posts p WHERE ($1 = ANY(p.image_object_keys) OR $1 = ANY(p.preview_image_object_keys))
      AND ${visiblePostSQL("p", "$2", true)})
    OR EXISTS (SELECT 1 FROM users u WHERE ($1 = u.avatar_object_key OR $1 = u.background_object_key)
      AND u.status = 'active' AND u.deleted_at IS NULL AND ${unblockedSQL("u.id", "$2")})
    OR EXISTS (SELECT 1 FROM direct_messages dm JOIN message_threads mt ON mt.id = dm.thread_id
      WHERE dm.image_object_key = $1 AND $2 IN (mt.buyer_user_id, mt.publisher_user_id)
        AND dm.revoked_at IS NULL AND NOT ($2 = ANY(dm.deleted_for_user_ids)))
    OR EXISTS (SELECT 1 FROM moderation_reviews mr WHERE $1 = ANY(mr.image_object_keys)
      AND ($3 OR mr.owner_id = NULLIF($2, '')) AND mr.status IN ('pending','review','rejected')
      AND (mr.target_type <> 'post' OR EXISTS (SELECT 1 FROM posts rp WHERE rp.id = mr.target_id AND rp.status <> 'deleted')))
    OR EXISTS (SELECT 1 FROM upload_tickets ut WHERE ut.object_key = $1 AND ut.user_id = NULLIF($2, '')
      AND ut.status = 'ready' AND ut.referenced_at IS NULL)
  ) AS allowed`, [key, viewer, isModerationAdmin(user)]);
  return Boolean(rows[0]?.allowed);
}
