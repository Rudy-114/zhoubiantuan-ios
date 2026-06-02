import { publicAssetUrl } from "./oss.js";

export function userToClient(row, counts = {}) {
  return {
    id: row.id,
    email: row.email || "",
    nickname: row.nickname,
    bio: row.bio || "",
    followingCount: Number(counts.following_count ?? row.following_count ?? 0),
    followersCount: Number(counts.followers_count ?? row.followers_count ?? 0),
    postCount: Number(counts.post_count ?? row.post_count ?? 0),
    isRestricted: Boolean(row.is_restricted),
    canShowContact: Boolean(row.can_show_contact),
    avatarSymbol: row.avatar_symbol || "新",
    avatarTint: row.avatar_tint || "rose",
    redBookID: row.red_book_id || "",
    gender: row.gender || "未设置",
    birthday: row.birthday || "选择生日",
    region: row.region || "未设置",
    backgroundImageName: row.background_image_name || "merch_magazine",
    avatarURL: publicAssetUrl(row.avatar_object_key),
    backgroundURL: publicAssetUrl(row.background_object_key),
    phoneNumber: row.phone_number || "",
    lastNicknameChangedAt: row.last_nickname_changed_at ? row.last_nickname_changed_at.toISOString() : null,
    moderationStatus: row.moderation_status || "",
    moderationReason: row.moderation_reason || "",
    reviewID: row.review_id || ""
  };
}

export function postToClient(row, counts = {}) {
  const imageKeys = row.image_object_keys || [];
  return {
    id: row.id,
    title: row.title,
    imageNames: row.image_names || [],
    remoteImageURLs: imageKeys.map((key) => publicAssetUrl(key)),
    imageObjectKeys: imageKeys,
    authorID: row.author_id,
    groupType: row.group_type,
    collectionID: row.collection_id,
    categoryTags: row.category_tags || [],
    fandomTags: row.fandom_tags || [],
    price: row.price || "",
    deposit: row.deposit || "",
    deadline: row.deadline.toISOString(),
    condition: row.condition || "",
    isFormed: Boolean(row.is_formed),
    description: row.description || "",
    wechat: row.wechat || "",
    qq: row.qq || "",
    groupNumber: row.group_number || "",
    groupInfo: row.group_info || "",
    externalLink: row.external_link || "",
    createdAt: row.created_at.toISOString(),
    likedCount: Number(counts.liked_count ?? row.liked_count ?? 0),
    favoriteCount: Number(counts.favorite_count ?? row.favorite_count ?? 0),
    commentCount: Number(counts.comment_count ?? row.comment_count ?? 0),
    reportCount: Number(counts.report_count ?? row.report_count ?? 0),
    status: row.status,
    moderationReason: row.moderation_reason || "",
    reviewID: row.review_id || "",
    imageAspect: Number(row.image_aspect || 1.08),
    pingguAveragePrice: row.pinggu_average_price || "",
    pingguNote: row.pinggu_note || "",
    unsoldRoles: row.unsold_roles || []
  };
}

export function collectionToClient(row, postIDs = []) {
  return {
    id: row.id,
    ownerID: row.owner_id,
    name: row.name,
    contactWechat: row.contact_wechat || "",
    contactQQ: row.contact_qq || "",
    contactGroupNumber: row.contact_group_number || "",
    groupInfo: row.group_info || "",
    deadline: row.deadline.toISOString(),
    defaultNote: row.default_note || "",
    postIDs,
    createdAt: row.created_at.toISOString(),
    status: row.status || "active"
  };
}

export function commentToClient(row) {
  return {
    id: row.id,
    body: row.body,
    authorID: row.author_id,
    postID: row.post_id,
    replyToID: row.reply_to_id,
    createdAt: row.created_at.toISOString(),
    status: row.status,
    moderationReason: row.moderation_reason || "",
    reviewID: row.review_id || ""
  };
}

export function directMessageToClient(row, viewerUserID = "") {
  const deletedForUserIds = Array.isArray(row.deleted_for_user_ids) ? row.deleted_for_user_ids : [];
  const isDeletedForMe = Boolean(viewerUserID && deletedForUserIds.includes(viewerUserID));
  const isRevoked = Boolean(row.revoked_at);
  return {
    id: row.id,
    senderID: row.sender_id,
    body: isRevoked ? "" : row.body || "",
    createdAt: row.created_at.toISOString(),
    imageURL: isRevoked ? "" : publicAssetUrl(row.image_object_key),
    isRevoked,
    isDeletedForMe,
    sharedPostID: row.shared_post_id || null,
    sharedProfileUserID: row.shared_profile_user_id || null
  };
}

export function messageThreadToClient(row, messages = []) {
  return {
    id: row.id,
    buyerUserID: row.buyer_user_id,
    publisherUserID: row.publisher_user_id,
    relatedPostID: row.related_post_id || null,
    messages,
    unreadCount: Number(row.unread_count || 0),
    updatedAt: row.updated_at.toISOString()
  };
}

export function reportToClient(row) {
  return {
    id: row.id,
    target: { type: row.target_type, id: row.target_id },
    reason: row.reason,
    detail: row.detail || "",
    reporterID: row.reporter_id,
    status: row.status,
    adminResult: row.admin_result,
    handledAt: row.handled_at ? row.handled_at.toISOString() : null
  };
}

export function moderationReviewToClient(row) {
  return {
    id: row.id,
    targetType: row.target_type,
    targetID: row.target_id,
    ownerID: row.owner_id || "",
    status: row.status,
    decision: row.decision || null,
    source: row.source || "systemRule",
    riskLevel: row.risk_level || "none",
    reason: row.reason || "",
    textSnapshot: row.text_snapshot || "",
    imageObjectKeys: row.image_object_keys || [],
    imageURLs: (row.image_object_keys || []).map((key) => publicAssetUrl(key)),
    snapshot: row.snapshot || {},
    rawSummary: row.raw_summary || {},
    handledBy: row.handled_by || "",
    handledAt: row.handled_at ? row.handled_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
