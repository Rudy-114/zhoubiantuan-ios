// SQL fragments take only internal aliases / parameter placeholders, never request input.
export function unblockedSQL(author, viewer) {
  return `NOT EXISTS (SELECT 1 FROM user_blocks vb WHERE
    (vb.blocker_id = ${viewer} AND vb.blocked_id = ${author}) OR
    (vb.blocked_id = ${viewer} AND vb.blocker_id = ${author}))`;
}

export function visiblePostSQL(alias = "p", viewer = "$1", includeOwn = false) {
  return `(${alias}.status = 'active' ${includeOwn ? `OR (${alias}.author_id = ${viewer} AND ${alias}.status IN ('pending','review','rejected','hidden','removed'))` : ""})
    AND EXISTS (SELECT 1 FROM users vu WHERE vu.id = ${alias}.author_id AND vu.status = 'active' AND vu.deleted_at IS NULL)
    AND (${alias}.collection_id IS NULL OR EXISTS (SELECT 1 FROM group_collections vc
      WHERE vc.id = ${alias}.collection_id AND (vc.status = 'active' ${includeOwn ? `OR vc.owner_id = ${viewer}` : ""})))
    AND ${unblockedSQL(`${alias}.author_id`, viewer)}`;
}

export function visibleCollectionSQL(alias = "c", viewer = "$1", includeOwn = false) {
  return `(${alias}.status = 'active' ${includeOwn ? `OR (${alias}.owner_id = ${viewer} AND ${alias}.status IN ('pending','review','rejected','hidden','removed'))` : ""})
    AND EXISTS (SELECT 1 FROM users vu WHERE vu.id = ${alias}.owner_id AND vu.status = 'active' AND vu.deleted_at IS NULL)
    AND ${unblockedSQL(`${alias}.owner_id`, viewer)}`;
}

export function visibleCommentSQL(alias = "cm", viewer = "$1", includeOwn = false) {
  return `(${alias}.status = 'active' ${includeOwn ? `OR (${alias}.author_id = ${viewer} AND ${alias}.status IN ('pending','review','rejected'))` : ""})
    AND EXISTS (SELECT 1 FROM users vu WHERE vu.id = ${alias}.author_id AND vu.status = 'active' AND vu.deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM posts vp WHERE vp.id = ${alias}.post_id AND ${visiblePostSQL("vp", viewer, includeOwn)})
    AND ${unblockedSQL(`${alias}.author_id`, viewer)}`;
}
