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
