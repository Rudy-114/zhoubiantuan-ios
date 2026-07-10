export const SAFETY_TARGET_TYPES = Object.freeze([
  "post",
  "comment",
  "user",
  "direct_message",
  "collection"
]);

export const SAFETY_REASON_CODES = Object.freeze([
  "suspected_scam",
  "false_or_expired_group_buy",
  "invalid_contact",
  "copyright_or_stolen_media",
  "harassment_or_abuse",
  "sexual_or_illegal",
  "spam_or_advertising",
  "direct_message_risk",
  "other"
]);

export const SAFETY_REPORTED_FIELDS = Object.freeze([
  "content",
  "contact_wechat",
  "contact_qq",
  "contact_group_number",
  "collection_deadline",
  "collection_description",
  "collection_default_note"
]);

export const COLLECTION_SHARED_FIELDS = new Set(
  SAFETY_REPORTED_FIELDS.filter((field) => field !== "content")
);

export const ALLOWED_REASONS_BY_SOURCE = Object.freeze({
  post: Object.freeze([
    "suspected_scam",
    "false_or_expired_group_buy",
    "invalid_contact",
    "copyright_or_stolen_media",
    "harassment_or_abuse",
    "sexual_or_illegal",
    "spam_or_advertising",
    "other"
  ]),
  comment: Object.freeze([
    "suspected_scam",
    "harassment_or_abuse",
    "sexual_or_illegal",
    "spam_or_advertising",
    "other"
  ]),
  user: Object.freeze([
    "suspected_scam",
    "copyright_or_stolen_media",
    "harassment_or_abuse",
    "sexual_or_illegal",
    "spam_or_advertising",
    "other"
  ]),
  direct_message: Object.freeze([
    "suspected_scam",
    "harassment_or_abuse",
    "sexual_or_illegal",
    "spam_or_advertising",
    "direct_message_risk",
    "other"
  ]),
  collection: Object.freeze([
    "suspected_scam",
    "false_or_expired_group_buy",
    "invalid_contact",
    "copyright_or_stolen_media",
    "sexual_or_illegal",
    "spam_or_advertising",
    "other"
  ])
});
