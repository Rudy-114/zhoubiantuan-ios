import { badRequest } from "../validators.js";

export function moderationDecision(value, invalidError = () => badRequest("审核处理动作无效")) {
  const name = typeof value === "string" ? value.trim() : "";
  const decision = {
    approve: { reviewStatus: "active", targetStatus: "active" },
    reject: { reviewStatus: "rejected", targetStatus: "rejected" },
    hide: { reviewStatus: "hidden", targetStatus: "hidden" },
    remove: { reviewStatus: "removed", targetStatus: "removed" },
    ignore: { reviewStatus: "ignored", targetStatus: null }
  }[name];
  if (!decision) throw invalidError();
  return { name, decision: name, ...decision };
}

export async function applyModerationDecision(client, review, decision) {
  if (decision.name === "ignore") return;
  const snapshot = review.snapshot || {};
  if (review.target_type === "post") {
    await client.query("UPDATE posts SET status = $2, updated_at = now() WHERE id = $1", [review.target_id, decision.targetStatus]);
    return;
  }
  if (review.target_type === "comment") {
    await client.query("UPDATE comments SET status = $2 WHERE id = $1", [review.target_id, decision.targetStatus]);
    return;
  }
  if (review.target_type === "collection") {
    await client.query("UPDATE group_collections SET status = $2, updated_at = now() WHERE id = $1", [review.target_id, decision.targetStatus]);
    return;
  }
  if (decision.name !== "approve") return;
  if (review.target_type === "profileText") {
    await client.query(
      `UPDATE users
       SET nickname = COALESCE($2, nickname), bio = COALESCE($3, bio),
           red_book_id = COALESCE($4, red_book_id), gender = COALESCE($5, gender),
           birthday = COALESCE($6, birthday), region = COALESCE($7, region),
           avatar_symbol = COALESCE($8, avatar_symbol), avatar_tint = COALESCE($9, avatar_tint),
           background_image_name = COALESCE($10, background_image_name), updated_at = now()
       WHERE id = $1`,
      [
        review.owner_id, snapshot.nickname, snapshot.bio, snapshot.redBookID,
        snapshot.gender, snapshot.birthday, snapshot.region, snapshot.avatarSymbol,
        snapshot.avatarTint, snapshot.backgroundImageName
      ]
    );
    return;
  }
  if (review.target_type === "avatar") {
    await client.query(
      "UPDATE users SET avatar_object_key = $2, updated_at = now() WHERE id = $1",
      [review.owner_id, snapshot.avatarObjectKey || review.image_object_keys?.[0] || null]
    );
    return;
  }
  if (review.target_type === "profileBackground") {
    await client.query(
      "UPDATE users SET background_object_key = $2, background_image_name = COALESCE($3, background_image_name), updated_at = now() WHERE id = $1",
      [review.owner_id, snapshot.backgroundObjectKey || review.image_object_keys?.[0] || null, snapshot.backgroundImageName]
    );
  }
}

export async function assertReviewCurrent(client, review, decision) {
  if (decision.decision === "ignore") return;
  const table = ({ post: "posts", comment: "comments", collection: "group_collections" })[review.target_type] || "users";
  const targetId = table === "users" ? review.owner_id : review.target_id;
  const target = (await client.query(`SELECT *, ${table === "comments" ? "false" : "updated_at > (SELECT created_at FROM moderation_reviews WHERE id=$2)"} AS stale FROM ${table} WHERE id=$1 FOR UPDATE`, table === "comments" ? [targetId] : [targetId, review.id])).rows[0];
  if (!target || target.status === "deleted" || target.deleted_at) {
    const error = badRequest("内容已删除，无法继续审核"); error.status = 409; throw error;
  }
  if (decision.decision === "approve" && target.stale) {
    const error = badRequest("内容已变更，请刷新后审核最新版本"); error.status = 409; throw error;
  }
}
