import { installLegacyProtocol } from "./legacyProtocol.js";
import { assetCapabilityReader } from "./assetCapability.js";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import express from "express";
import { assertUnrestrictedUser, requireUnrestrictedUser, hashPassword, optionalAuth, requireAuth, signToken, verifyPassword } from "./auth.js";
import { loadBootstrap } from "./bootstrap.js";
import { config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { sendEmailCode } from "./email.js";
import { logger } from "./logger.js";
import { requestHash, assertPostReplay } from "./idempotency.js";
import { assertRevision, editPost, validateRoles } from "./contentEditing.js";
import { createSafetyReportRouter } from "./safety/reportRoutes.js";
import { loadRetainedSafetyObjectKeys } from "./safety/objectRetention.js";
import { postsPage, postDetail, collectionsPage, commentsPage, usersPage } from "./contentPages.js";
import { asyncRoute } from "./http.js";
import { collectionToClient, commentToClient, moderationReviewToClient, postToClient, userToClient } from "./mappers.js";
import { loadMessageThreadForUser, loadThreadsPage, messageHistoryPage } from "./messages.js";
import { assertOwnedObjectKeys, createModerationReview, isModerationAdmin, reviewSubmission } from "./moderation/index.js";
import { moderationText, postModerationSnapshot, publicContentModerationText } from "./moderation/text.js";
import { objectStorage as defaultObjectStorage } from "./oss.js";
import { attachPostCounts } from "./postCounts.js";
import { createRateLimiter } from "./rateLimit.js";
import { notifySyncEvents } from "./realtime.js";
import { createSyncEventsForUsers, createThreadSyncEvents, getCurrentSyncCursor, loadSyncPayload } from "./sync.js";
import { arrayOfStrings, assertEmail, assertEmailCode, assertEmailCodePurpose, assertPassword, badRequest, normalizeEmail, trimmedString } from "./validators.js";

const ALLOWED_IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

import { assertReadyUploads, installUploadRoute, issueUploadTicket } from "./uploads.js";
import { canReadAsset } from "./assets.js";
import { validateContent } from "./contentValidation.js";
import { visiblePostSQL, visibleCommentSQL, visibleCollectionSQL, unblockedSQL } from "./visibility.js";

export function createRouter({ objectStorage = defaultObjectStorage, deleteObjects } = {}) {
  const router = express.Router();
  installLegacyProtocol(router);
  installUploadRoute(router, objectStorage);
  router.use(validateContent);
  const sharedRateLimitStore = config.nodeEnv === "production" ? "postgres" : "memory";
  const authLimiter = createRateLimiter({
    name: "auth",
    store: sharedRateLimitStore,
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: "登录尝试太频繁，请稍后再试",
    keyGenerator: (req) => `${req.ip}:${normalizeEmail(req.body?.email)}`
  });
  const emailCodeLimiter = createRateLimiter({
    name: "email_code",
    store: sharedRateLimitStore,
    windowMs: 60 * 1000,
    max: 3,
    message: "验证码发送太频繁，请稍后再试",
    keyGenerator: (req) => `${req.ip}:${normalizeEmail(req.body?.email)}:${req.body?.purpose || ""}`
  });
  const assetLimiter = createRateLimiter({
    name: "asset",
    store: sharedRateLimitStore,
    windowMs: 60 * 1000,
    max: 120,
    message: "图片请求太频繁，请稍后再试",
    keyGenerator: (req) => req.ip
  });

  router.get("/health", asyncRoute(async (_req, res) => {
    await query("SELECT 1");
    res.json({ ok: true });
  }));

  router.get("/assets/*", optionalAuth, assetLimiter, async (req, res, next) => {
    try {
      const objectKey = String(req.params[0] || "");
      if (!/^(guarded\/)?(post|avatar|background|message|report)\//.test(objectKey) || objectKey.includes("..")) {
        return res.status(404).json({ error: "图片不存在" });
      }

      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Vary", "Authorization");
      if (!(await canReadAsset(objectKey, req.user || await assetCapabilityReader(objectKey, req.query.a)))) return res.status(404).json({ error: "图片不存在" });
      const upstream = await objectStorage.readImage(objectKey);
      if (!upstream.ok || !upstream.body) {
        return res.status(upstream.status || 404).json({ error: "图片不存在" });
      }

      // Never echo an attacker-controlled Content-Type back from our own domain.
      // Only known image types pass through; anything else (e.g. uploaded HTML or
      // SVG-with-script) is forced to a non-renderable type so it cannot execute.
      res.setHeader("Content-Type", safeImageContentType(upstream.headers.get("content-type")));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "inline");

      Readable.fromWeb(upstream.body).on("error", next).pipe(res);
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/email/send-code", emailCodeLimiter, async (req, res, next) => {
    try {
      const email = assertEmail(req.body.email);
      const purpose = assertEmailCodePurpose(req.body.purpose);
      const existingUser = await findActiveUserByEmail(email);

      if (purpose === "register" && existingUser) {
        throw badRequest("该邮箱已注册");
      }

      if (purpose === "login" && !existingUser) {
        return res.json({ ok: true, message: "如果邮箱已注册，验证码会发送到邮箱" });
      }

      await issueEmailCode({ email, purpose });
      res.json({ ok: true, message: "验证码已发送" });
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/email/register", authLimiter, async (req, res, next) => {
    try {
      const email = assertEmail(req.body.email);
      const code = assertEmailCode(req.body.code);
      const password = assertPassword(req.body.password);
      const nickname = trimmedString(req.body.nickname);
      if (!nickname) throw badRequest("请填写昵称");
      const nicknameModeration = await reviewRegistrationText(nickname);
      if (nicknameModeration.status === "rejected") throw badRequest(nicknameModeration.reason);

      const passwordHash = await hashPassword(password);
      const user = await withTransaction(async (client) => {
        const existing = await client.query("SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL AND status = 'active'", [email]);
        if (existing.rows[0]) throw badRequest("本邮箱已经注册过");
        const codeError = await consumeEmailCode(client, { email, purpose: "register", code });
        if (codeError) return { codeError };
        const user = await createEmailUser(client, { email, passwordHash, nickname: publicRegistrationNickname(nickname, nicknameModeration), emailVerified: true });
        await createRegistrationNicknameReview(client, user, nickname, nicknameModeration);
        return user;
      });
      if (user.codeError) throw user.codeError;
      res.status(201).json(await authPayload(user));
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/email/login", authLimiter, async (req, res, next) => {
    try {
      const email = assertEmail(req.body.email);
      const code = String(req.body.code || "").trim();
      const password = String(req.body.password || "");

      if (code) {
        const user = await withTransaction(async (client) => {
          const { rows } = await client.query("SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL AND status = 'active'", [email]);
          if (!rows[0]) throw unauthorized("邮箱或验证码不正确");
          const codeError = await consumeEmailCode(client, { email, purpose: "login", code: assertEmailCode(code) });
          if (codeError) return { codeError };
          await client.query("UPDATE auth_identities SET email_verified = true, updated_at = now() WHERE user_id = $1 AND provider = 'email' AND email = $2", [rows[0].id, email]);
          return { ...rows[0], email_verified: true };
        });
        if (user.codeError) throw user.codeError;
        return res.json(await authPayload(user));
      }

      const user = await verifyEmailPasswordLogin(email, password);
      res.json(await authPayload(user));
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/register", (_req, res) => {
    res.status(410).json({ error: "请使用邮箱验证码注册", code: "email_verification_required" });
  });

  router.post("/auth/login", authLimiter, async (req, res, next) => {
    try {
      const email = assertEmail(req.body.email);
      const password = String(req.body.password || "");
      const user = await verifyEmailPasswordLogin(email, password);
      res.json(await authPayload(user));
    } catch (error) {
      next(error);
    }
  });

  router.get("/bootstrap", requireAuth, asyncRoute(async (req, res) => {
    const syncCursor = await getCurrentSyncCursor();
    res.json({ currentUser: userToClient(req.user, {}, req.user.id), syncCursor, ...(await loadBootstrap(req.user.id)) });
  }));

  router.get("/sync", requireAuth, async (req, res, next) => {
    try {
      const payload = await loadSyncPayload(req.user.id, { cursor: req.query.cursor, limit: req.query.limit });
      logger.info("sync.request", { userID: req.user.id, cursor: String(req.query.cursor || "0"), nextCursor: payload.nextCursor, events: payload.events.length });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", requireAuth, async (req, res) => {
    res.json({ user: userToClient(req.user, {}, req.user.id) });
  });

  // App-internal account deletion (App Store Guideline 5.1.1(v)).
  // Soft-delete + de-identify: the row is kept for integrity/audit but stripped
  // of personal data; the email is released so it can be registered again, and
  // all authored content is hidden. Existing tokens stop working immediately
  // because userForToken() filters on deleted_at IS NULL AND status = 'active'.
  router.delete("/me", requireAuth, async (req, res, next) => {
    try {
      const userId = req.user.id;
      const { objectKeys, syncEvents } = await withTransaction(async (client) => {
        // Collect this user's OSS object keys before scrubbing, for cleanup.
        const ownImages = await client.query(
          "SELECT avatar_object_key, background_object_key FROM users WHERE id = $1",
          [userId]
        );
        const postImages = await client.query(
          "SELECT image_object_keys, preview_image_object_keys FROM posts WHERE author_id = $1",
          [userId]
        );
        const messageImages = await client.query(
          "SELECT image_object_key FROM direct_messages WHERE sender_id = $1 AND image_object_key IS NOT NULL",
          [userId]
        );
        const keys = collectObjectKeys(ownImages.rows, postImages.rows, messageImages.rows);

        // De-identify the account and RELEASE the email (users.email UNIQUE
        // allows multiple NULLs, so the address becomes registerable again).
        await client.query(
          `UPDATE users
           SET status = 'deleted', deleted_at = now(),
               email = NULL, password_hash = NULL, phone_number = '',
               nickname = '已注销用户', bio = '', red_book_id = '',
               gender = '未设置', birthday = '选择生日', region = '未设置',
               avatar_object_key = NULL, background_object_key = NULL,
               updated_at = now()
           WHERE id = $1`,
          [userId]
        );
        // Remove login identities so the freed email/provider_subject is reusable.
        await client.query("DELETE FROM auth_identities WHERE user_id = $1", [userId]);

        // Hide everything the user authored.
        await client.query("UPDATE posts SET status = 'deleted', updated_at = now() WHERE author_id = $1 AND status <> 'deleted'", [userId]);
        await client.query("UPDATE comments SET status = 'deleted' WHERE author_id = $1 AND status <> 'deleted'", [userId]);
        await client.query("UPDATE group_collections SET status = 'deleted', updated_at = now() WHERE owner_id = $1 AND status <> 'deleted'", [userId]);

        // Drop social edges and interactions so other users' counts settle.
        await client.query("DELETE FROM follows WHERE follower_id = $1 OR following_id = $1", [userId]);
        await client.query("DELETE FROM post_likes WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM post_favorites WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM user_blocks WHERE blocker_id = $1 OR blocked_id = $1", [userId]);

        await client.query("UPDATE direct_messages SET body = '', image_object_key = NULL, revoked_at = COALESCE(revoked_at, now()) WHERE sender_id = $1", [userId]);
        const syncEvents = await createSyncEventsForUsers(client, { userIds: [null], eventType: "user.deleted", entityType: "user", entityId: userId });
        const retained = await loadRetainedSafetyObjectKeys(client, keys);
        return { objectKeys: keys.filter(key => !retained.has(key)), syncEvents };
      });

      // Best-effort OSS cleanup outside the transaction; never block deletion on it.
      void (async () => { if (deleteObjects) { await deleteObjects(objectKeys); return; } for (const key of objectKeys) { try { await objectStorage.removeImage(key); } catch { /* Retry through operations if needed. */ } } })();
      notifySyncEvents(syncEvents);
      logger.info("account.deleted", { userID: userId, objectKeys: objectKeys.length });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/me/identities", requireAuth, async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT provider, email, email_verified, display_name, avatar_url, created_at, updated_at
         FROM auth_identities
         WHERE user_id = $1
         ORDER BY provider`,
        [req.user.id]
      );
      res.json({
        identities: rows.map((identity) => ({
          provider: identity.provider,
          email: identity.email || "",
          emailVerified: identity.email_verified,
          displayName: identity.display_name || "",
          avatarURL: identity.avatar_url || "",
          createdAt: identity.created_at,
          updatedAt: identity.updated_at
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  const contentLimiter = createRateLimiter({ name: "content", store: sharedRateLimitStore,
    windowMs: 10 * 60 * 1000, max: 30, keyGenerator: req => req.user.id,
    message: "内容提交太频繁，请稍后再试" });

  router.patch("/me", requireAuth, requireUnrestrictedUser, contentLimiter, async (req, res, next) => {
    try {
      const nickname = trimmedString(req.body.nickname, req.user.nickname);
      const bio = trimmedString(req.body.bio, "点击这里，填写简介");
      const redBookID = trimmedString(req.body.redBookID);
      const gender = trimmedString(req.body.gender, "未设置");
      const birthday = trimmedString(req.body.birthday, "选择生日");
      const region = trimmedString(req.body.region, "未设置");
      const avatarSymbol = trimmedString(req.body.avatarSymbol, req.user.avatar_symbol).slice(0, 2);
      const avatarTint = trimmedString(req.body.avatarTint, req.user.avatar_tint);
      const backgroundImageName = trimmedString(req.body.backgroundImageName, req.user.background_image_name);
      const avatarObjectKey = trimmedString(req.body.avatarObjectKey, req.user.avatar_object_key || "");
      const backgroundObjectKey = trimmedString(req.body.backgroundObjectKey, req.user.background_object_key || "");
      if (avatarObjectKey) assertOwnedObjectKeys(req.user.id, [avatarObjectKey], ["avatar"]);
      if (backgroundObjectKey) assertOwnedObjectKeys(req.user.id, [backgroundObjectKey], ["background"]);

      const profileKeys = [avatarObjectKey, backgroundObjectKey].filter(Boolean);
      const retainedProfileKeys = [req.user.avatar_object_key, req.user.background_object_key].filter(Boolean);
      await assertReadyUploads(req.user.id, profileKeys, undefined, { retainKeys: retainedProfileKeys });
      const profileSnapshot = { nickname, bio, redBookID, gender, birthday, region, avatarSymbol, avatarTint, backgroundImageName };
      const textResult = await reviewSubmission({
        targetType: "profileText",
        targetId: req.user.id,
        ownerId: req.user.id,
        text: moderationText(profileSnapshot)
      });
      const avatarResult = avatarObjectKey && avatarObjectKey !== req.user.avatar_object_key
        ? await reviewSubmission({ targetType: "avatar", targetId: req.user.id, ownerId: req.user.id, imageObjectKeys: [avatarObjectKey] })
        : null;
      const backgroundResult = backgroundObjectKey && backgroundObjectKey !== req.user.background_object_key
        ? await reviewSubmission({ targetType: "profileBackground", targetId: req.user.id, ownerId: req.user.id, imageObjectKeys: [backgroundObjectKey] })
        : null;

      const { user, syncEvents } = await withTransaction(async (client) => {
        await assertUnrestrictedUser(client, req.user.id);
        await assertReadyUploads(req.user.id, profileKeys, client, { retainKeys: retainedProfileKeys, markReferenced: true });
        const applyText = textResult.status === "active";
        const applyAvatar = !avatarResult || avatarResult.status === "active";
        const applyBackground = !backgroundResult || backgroundResult.status === "active";
        const { rows } = await client.query(
          `UPDATE users
           SET nickname = $2, bio = $3, red_book_id = $4, gender = $5, birthday = $6, region = $7,
               avatar_symbol = $8, avatar_tint = $9, background_image_name = $10,
               avatar_object_key = $11, background_object_key = $12,
               last_nickname_changed_at = $13, updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [
            req.user.id,
            applyText ? nickname : req.user.nickname,
            applyText ? bio : req.user.bio,
            applyText ? redBookID : req.user.red_book_id,
            applyText ? gender : req.user.gender,
            applyText ? birthday : req.user.birthday,
            applyText ? region : req.user.region,
            applyText ? avatarSymbol : req.user.avatar_symbol,
            applyText ? avatarTint : req.user.avatar_tint,
            applyText ? backgroundImageName : req.user.background_image_name,
            applyAvatar && avatarObjectKey ? avatarObjectKey : req.user.avatar_object_key,
            applyBackground && backgroundObjectKey ? backgroundObjectKey : req.user.background_object_key,
            applyText && nickname !== req.user.nickname ? new Date() : req.user.last_nickname_changed_at
          ]
        );
        if (!applyText) {
          await createModerationReview(client, {
            targetType: "profileText",
            targetId: req.user.id,
            ownerId: req.user.id,
            result: textResult,
            textSnapshot: moderationText(profileSnapshot),
            snapshot: profileSnapshot
          });
        }
        if (avatarResult && avatarResult.status !== "active") {
          await createModerationReview(client, {
            targetType: "avatar",
            targetId: req.user.id,
            ownerId: req.user.id,
            result: avatarResult,
            imageObjectKeys: [avatarObjectKey],
            snapshot: { avatarObjectKey }
          });
        }
        if (backgroundResult && backgroundResult.status !== "active") {
          await createModerationReview(client, {
            targetType: "profileBackground",
            targetId: req.user.id,
            ownerId: req.user.id,
            result: backgroundResult,
            imageObjectKeys: [backgroundObjectKey],
            snapshot: { backgroundObjectKey, backgroundImageName }
          });
        }
        const syncEvents = await createSyncEventsForUsers(client, { userIds: [req.user.id, null], eventType: "user.updated", entityType: "user", entityId: req.user.id });
        return { user: rows[0], syncEvents };
      });
      notifySyncEvents(syncEvents);
      res.json({ user: userToClient(user, {}, req.user.id), moderation: moderationResponse([textResult, avatarResult, backgroundResult].filter(Boolean)) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/feed", optionalAuth, asyncRoute(async (req, res) => {
    res.json(await postsPage(req.user?.id || "", req.query));
  }));
  router.get("/collections", optionalAuth, asyncRoute(async (req, res) => {
    res.json(await collectionsPage(req.user?.id || "", req.query));
  }));
  router.get("/users", optionalAuth, asyncRoute(async (req, res) => {
    res.json(await usersPage(req.user?.id || "", req.query));
  }));
  router.get("/posts/:id/comments", optionalAuth, asyncRoute(async (req, res) => {
    res.json(await commentsPage(req.params.id, req.user?.id || "", req.query));
  }));
  router.get("/posts/:id", optionalAuth, asyncRoute(async (req, res) => {
    res.json(await postDetail(req.params.id, req.user?.id || ""));
  }));

  router.post("/collections", requireAuth, requireUnrestrictedUser, contentLimiter, async (req, res, next) => {
    try {
      const { collection, syncEvents } = await createCollection(req.user.id, req.body);
      notifySyncEvents(syncEvents);
      res.status(201).json({ collection });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/collections/:id", requireAuth, requireUnrestrictedUser, contentLimiter, async (req, res, next) => {
    try {
      const { collection, syncEvents } = await updateCollection(req.user.id, req.params.id, req.body);
      if (syncEvents.length) {
        logger.info("collection.updated", { collectionID: req.params.id, status: collection.status, events: syncEvents.length });
        notifySyncEvents(syncEvents);
      }
      res.json({ collection });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/collections/:id", requireAuth, async (req, res, next) => {
    try {
      const syncEvents = await withTransaction(async client => {
        const current = (await client.query("SELECT id FROM group_collections WHERE id=$1 AND owner_id=$2 AND status <> 'deleted' FOR UPDATE", [req.params.id, req.user.id])).rows[0];
        if (!current) return null;
        if ((await client.query("SELECT 1 FROM posts WHERE collection_id=$1 AND status <> 'deleted' LIMIT 1", [req.params.id])).rows.length) {
          const error = badRequest("请先移动或删除合集中的帖子"); error.status = 409; throw error;
        }
        await client.query("UPDATE group_collections SET status='deleted', updated_at=now() WHERE id=$1", [req.params.id]);
        return createSyncEventsForUsers(client, { userIds: [req.user.id, null], eventType: "collection.deleted", entityType: "collection", entityId: req.params.id });
      });
      if (!syncEvents) return res.status(404).json({ error: "合集不存在" });
      notifySyncEvents(syncEvents);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/posts", requireAuth, requireUnrestrictedUser, contentLimiter, async (req, res, next) => {
    try {
      const title = trimmedString(req.body.title);
      if (!title) throw badRequest("请填写标题");
      const requestedId = trimmedString(req.body.id);
      if (requestedId && !/^p-[A-Za-z0-9_-]{1,120}$/.test(requestedId)) throw badRequest("发布编号无效");
      const postId = requestedId || `p-${randomUUID()}`;
      const submissionHash = requestHash(req.body);
      const existing = (await query("SELECT * FROM posts WHERE id=$1", [postId])).rows[0];
      if (existing) {
        assertPostReplay(existing, req.user.id, submissionHash);
        return res.status(200).json({ post: postToClient(existing), moderation: { status: existing.status }, replayed: true });
      }
      const replacingPostId = trimmedString(req.body.replacingPostID);
      const collectionId = trimmedString(req.body.collectionID);
      const collection = collectionId
        ? (await query("SELECT * FROM group_collections WHERE id = $1 AND owner_id = $2 AND status = 'active' AND safety_status = 'active'", [collectionId, req.user.id])).rows[0]
        : null;
      if (!collection) throw badRequest("请选择自己已通过审核的合集");
      const roles = validateRoles(req.body.unsoldRoles ?? []);
      const deadline = collection?.deadline || parseDate(req.body.deadline) || new Date(Date.now() + 7 * 86400 * 1000);
      const imageObjectKeys = assertOwnedObjectKeys(req.user.id, arrayOfStrings(req.body.imageObjectKeys), ["post"]);
      const previewImageObjectKeys = assertOwnedObjectKeys(req.user.id, arrayOfStrings(req.body.previewImageObjectKeys), ["post"]);
      if (imageObjectKeys.length < 1 || imageObjectKeys.length > 16) throw badRequest("请选择 1 至 16 张产品图片");
      const reviewedImageKeys = [...new Set([...imageObjectKeys, ...previewImageObjectKeys])];
      await assertReadyUploads(req.user.id, reviewedImageKeys);
      const postSnapshot = postModerationSnapshot(req.body, collection, title);
      const moderation = await reviewSubmission({
        targetType: "post",
        targetId: postId,
        ownerId: req.user.id,
        text: publicContentModerationText(postSnapshot),
        imageObjectKeys: reviewedImageKeys
      });
      const { post, syncEvents, replayed } = await withTransaction(async (client) => {
        await assertUnrestrictedUser(client, req.user.id);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["post-submission:" + postId]);
        const committed = (await client.query("SELECT * FROM posts WHERE id=$1", [postId])).rows[0];
        if (committed) return { post: assertPostReplay(committed, req.user.id, submissionHash), syncEvents: [], replayed: true };
        const latestCollection = (await client.query("SELECT * FROM group_collections WHERE id=$1 FOR SHARE", [collectionId])).rows[0];
        assertRevision(latestCollection, collection.revision);
        if ((latestCollection.status !== "active" || latestCollection.safety_status !== "active") || latestCollection.owner_id !== req.user.id) throw badRequest("合集当前不可用");
        let previousPost;
        if (replacingPostId) {
          previousPost = (await client.query("SELECT * FROM posts WHERE id=$1 AND author_id=$2 FOR UPDATE", [replacingPostId, req.user.id])).rows[0];
          if (!previousPost || previousPost.status === "deleted") throw badRequest("上一版帖子不存在");
          if (previousPost.status === "active") throw badRequest("已公开的帖子不能通过重新投稿替换");
        }
        await assertReadyUploads(req.user.id, reviewedImageKeys, client, { markReferenced: true });
        const { rows } = await client.query(
          `INSERT INTO posts (
          id, author_id, collection_id, title, image_names, image_object_keys, preview_image_object_keys, group_type,
          category_tags, fandom_tags, price, deposit, deadline, condition, is_formed, description,
          wechat, qq, group_number, group_info, external_link, status, image_aspect, pinggu_average_price, pinggu_note, unsold_roles, submission_hash
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
        ) RETURNING *`,
          [
            postId,
            req.user.id,
            collection?.id || null,
            title,
            arrayOfStrings(req.body.imageNames),
            imageObjectKeys,
            previewImageObjectKeys,
            req.body.groupType === "splitGoods" || req.body.groupType === "拼谷" ? "splitGoods" : "followGroup",
            arrayOfStrings(req.body.categoryTags),
            arrayOfStrings(req.body.fandomTags),
            trimmedString(req.body.price),
            trimmedString(req.body.deposit),
            deadline,
            trimmedString(req.body.condition),
            Boolean(req.body.isFormed),
            trimmedString(req.body.description),
            trimmedString(req.body.wechat, collection?.contact_wechat || ""),
            trimmedString(req.body.qq, collection?.contact_qq || ""),
            trimmedString(req.body.groupNumber, collection?.contact_group_number || ""),
            trimmedString(req.body.groupInfo, collection?.group_info || ""),
            trimmedString(req.body.externalLink),
            moderation.status,
            Number(req.body.imageAspect || 1.08),
            trimmedString(req.body.pingguAveragePrice),
            trimmedString(req.body.pingguNote),
            JSON.stringify(roles),
            submissionHash
          ]
        );
        if (moderation.status !== "active") {
          await createModerationReview(client, {
            targetType: "post",
            targetId: postId,
            ownerId: req.user.id,
            result: moderation,
            textSnapshot: publicContentModerationText(postSnapshot),
            imageObjectKeys: reviewedImageKeys,
            snapshot: postSnapshot
          });
        }
        if (previousPost) await client.query("UPDATE posts SET status='deleted', updated_at=now() WHERE id=$1", [previousPost.id]);
        const audience = await syncAudienceForPublicContent(client, [req.user.id], moderation.status === "active");
        const syncEvents = await createSyncEventsForUsers(client, {
          userIds: audience,
          eventType: "post.created",
          entityType: "post",
          entityId: postId
        });
        if (previousPost) syncEvents.push(...await createSyncEventsForUsers(client, { userIds: [req.user.id, ...(["hidden", "removed"].includes(previousPost.status) ? [null] : [])],
          eventType: "post.deleted", entityType: "post", entityId: previousPost.id }));
        return { post: rows[0], syncEvents, replayed: false };
      });
      if (syncEvents.length) {
        logger.info("post.created", { postID: postId, status: moderation.status, events: syncEvents.length });
        notifySyncEvents(syncEvents);
      }
      res.status(replayed ? 200 : 201).json({ post: postToClient(post), moderation: replayed ? { status: post.status } : moderation, replayed });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/posts/:id", requireAuth, requireUnrestrictedUser, contentLimiter, asyncRoute(async (req, res) => {
    const { post, moderation, syncEvents } = await editPost(req.user.id, req.params.id, req.body);
    notifySyncEvents(syncEvents);
    res.json({ post, moderation });
  }));

  router.delete("/posts/:id", requireAuth, async (req, res, next) => {
    try {
      const syncEvents = await withTransaction(async (client) => {
        const existing = (await client.query("SELECT status FROM posts WHERE id=$1 AND author_id=$2 FOR UPDATE", [req.params.id, req.user.id])).rows[0];
        if (!existing) return null;
        const { rows } = await client.query(
          "UPDATE posts SET status = 'deleted', updated_at = now() WHERE id = $1 AND author_id = $2 RETURNING id, author_id",
          [req.params.id, req.user.id]
        );
        if (!rows[0]) return null;
        const audience = [...uniqueIds([req.user.id, rows[0].author_id]), ...(["active", "hidden", "removed"].includes(existing.status) ? [null] : [])];
        return createSyncEventsForUsers(client, {
          userIds: audience,
          eventType: "post.deleted",
          entityType: "post",
          entityId: req.params.id
        });
      });
      if (!syncEvents) return res.status(404).json({ error: "只能删除自己的帖子" });
      logger.info("post.deleted", { postID: req.params.id, events: syncEvents.length });
      notifySyncEvents(syncEvents);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/posts/:id/comments", requireAuth, requireUnrestrictedUser, contentLimiter, async (req, res, next) => {
    try {
      const body = trimmedString(req.body.body);
      const replyToID = trimmedString(req.body.replyToID);
      if (!body) throw badRequest("评论不能为空");
      const post = await query(`SELECT p.id, p.author_id FROM posts p WHERE p.id = $1 AND ${visiblePostSQL("p", "$2")}`, [req.params.id, req.user.id]);
      if (!post.rows[0]) throw badRequest("帖子不存在或不可评论");
      let replyAuthorId = "";
      if (replyToID) {
        const reply = await query(`SELECT cm.id, cm.author_id FROM comments cm WHERE cm.id = $1 AND cm.post_id = $2 AND ${visibleCommentSQL("cm", "$3")}`, [replyToID, req.params.id, req.user.id]);
        if (!reply.rows[0]) throw badRequest("回复的评论不存在");
        replyAuthorId = reply.rows[0].author_id;
      }
      const commentId = `c-${randomUUID()}`;
      const moderation = await reviewSubmission({
        targetType: "comment",
        targetId: commentId,
        ownerId: req.user.id,
        text: body
      });
      const { comment, syncEvents } = await withTransaction(async (client) => {
        await assertUnrestrictedUser(client, req.user.id);
        const visiblePost = await client.query(`SELECT p.id FROM posts p WHERE p.id = $1 AND ${visiblePostSQL("p", "$2")} FOR SHARE OF p`, [req.params.id, req.user.id]);
        if (!visiblePost.rows[0]) throw badRequest("帖子不存在或不可评论");
        const { rows } = await client.query(
          "INSERT INTO comments (id, post_id, author_id, body, reply_to_id, status) VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6) RETURNING *",
          [commentId, req.params.id, req.user.id, body, replyToID, moderation.status]
        );
        if (moderation.status !== "active") {
          await createModerationReview(client, {
            targetType: "comment",
            targetId: commentId,
            ownerId: req.user.id,
            result: moderation,
            textSnapshot: body,
            snapshot: { body, postID: req.params.id, replyToID }
          });
        }
        const audience = await syncAudienceForPublicContent(client, [req.user.id, post.rows[0].author_id, replyAuthorId], moderation.status === "active");
        const syncEvents = await createSyncEventsForUsers(client, {
          userIds: audience,
          eventType: "comment.created",
          entityType: "comment",
          entityId: commentId
        });
        return { comment: rows[0], syncEvents };
      });
      if (syncEvents.length) {
        logger.info("comment.created", { commentID: commentId, postID: req.params.id, status: moderation.status, events: syncEvents.length });
        notifySyncEvents(syncEvents);
      }
      res.status(201).json({ comment: commentToClient(comment), moderation });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/comments/:id", requireAuth, async (req, res, next) => {
    try {
      const syncEvents = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `UPDATE comments c
           SET status = 'deleted'
           FROM posts p
           WHERE c.id = $1
             AND c.post_id = p.id
             AND c.status = 'active'
             AND (c.author_id = $2 OR p.author_id = $2)
           RETURNING c.id, c.post_id, c.author_id, p.author_id AS post_author_id`,
          [req.params.id, req.user.id]
        );
        if (!rows[0]) return null;
        const audience = [...uniqueIds([req.user.id, rows[0].author_id, rows[0].post_author_id]), null];
        return createSyncEventsForUsers(client, {
          userIds: audience,
          eventType: "comment.deleted",
          entityType: "comment",
          entityId: req.params.id
        });
      });
      if (!syncEvents) return res.status(404).json({ error: "只能删除自己的评论或自己帖子下的评论" });
      logger.info("comment.deleted", { commentID: req.params.id, events: syncEvents.length });
      notifySyncEvents(syncEvents);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/posts/:id/like", requireAuth, async (req, res, next) => {
    try {
      const syncEvents = await setPostReaction({ userId: req.user.id, postId: req.params.id, table: "post_likes", eventType: "post.liked", enabled: true });
      if (syncEvents.length) {
        logger.info("post.liked", { postID: req.params.id, userID: req.user.id, events: syncEvents.length });
        notifySyncEvents(syncEvents);
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/posts/:id/like", requireAuth, async (req, res, next) => {
    try {
      const syncEvents = await setPostReaction({ userId: req.user.id, postId: req.params.id, table: "post_likes", eventType: "post.unliked", enabled: false });
      if (syncEvents.length) {
        logger.info("post.unliked", { postID: req.params.id, userID: req.user.id, events: syncEvents.length });
        notifySyncEvents(syncEvents);
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/posts/:id/favorite", requireAuth, async (req, res, next) => {
    try {
      const syncEvents = await setPostReaction({ userId: req.user.id, postId: req.params.id, table: "post_favorites", eventType: "post.favorited", enabled: true });
      if (syncEvents.length) {
        logger.info("post.favorited", { postID: req.params.id, userID: req.user.id, events: syncEvents.length });
        notifySyncEvents(syncEvents);
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/posts/:id/favorite", requireAuth, async (req, res, next) => {
    try {
      const syncEvents = await setPostReaction({ userId: req.user.id, postId: req.params.id, table: "post_favorites", eventType: "post.unfavorited", enabled: false });
      if (syncEvents.length) {
        logger.info("post.unfavorited", { postID: req.params.id, userID: req.user.id, events: syncEvents.length });
        notifySyncEvents(syncEvents);
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/users/:id/follow", requireAuth, requireUnrestrictedUser, async (req, res, next) => {
    try {
      const syncEvents = await setFollowState({ followerId: req.user.id, followingId: req.params.id, enabled: true });
      if (syncEvents.length) {
        logger.info("user.followed", { followerID: req.user.id, followingID: req.params.id, events: syncEvents.length });
        notifySyncEvents(syncEvents);
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/users/:id/follow", requireAuth, async (req, res, next) => {
    try {
      const syncEvents = await setFollowState({ followerId: req.user.id, followingId: req.params.id, enabled: false });
      if (syncEvents.length) {
        logger.info("user.unfollowed", { followerID: req.user.id, followingID: req.params.id, events: syncEvents.length });
        notifySyncEvents(syncEvents);
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/me/blocked-users", requireAuth, async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT u.*,
           (SELECT count(*) FROM follows f WHERE f.follower_id = u.id) AS following_count,
           (SELECT count(*) FROM follows f WHERE f.following_id = u.id) AS followers_count,
           (SELECT count(*) FROM posts p WHERE p.author_id = u.id AND p.status = 'active') AS post_count
         FROM user_blocks b
         JOIN users u ON u.id = b.blocked_id
         WHERE b.blocker_id = $1
         ORDER BY b.created_at DESC`,
        [req.user.id]
      );
      res.json({ blockedUsers: rows.map((row) => userToClient(row, row, req.user.id)) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/users/:id/block", requireAuth, async (req, res, next) => {
    try {
      const blockedId = trimmedString(req.params.id);
      if (!blockedId || blockedId === req.user.id) throw badRequest("不能拉黑自己");
      const syncEvents = await withTransaction(async (client) => {
        const target = await client.query("SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL AND status = 'active'", [blockedId]);
        if (!target.rows[0]) throw badRequest("用户不存在");
        await client.query(
          "INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT (blocker_id, blocked_id) DO NOTHING",
          [req.user.id, blockedId]
        );
        // Blocking removes both follow edges. Unblocking does not restore them;
        // either user must follow again manually after the block is cleared.
        await client.query(
          `DELETE FROM follows
           WHERE (follower_id = $1 AND following_id = $2)
              OR (follower_id = $2 AND following_id = $1)`,
          [req.user.id, blockedId]
        );
        return createRelationshipSyncEvents(client, {
          userIds: [req.user.id, blockedId],
          eventType: "user.blocked"
        });
      });
      if (syncEvents.length) {
        logger.info("user.blocked", { userID: req.user.id, blockedID: blockedId, events: syncEvents.length });
        notifySyncEvents(syncEvents);
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/users/:id/block", requireAuth, async (req, res, next) => {
    try {
      const blockedId = trimmedString(req.params.id);
      const syncEvents = await withTransaction(async (client) => {
        const result = await client.query("DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2", [req.user.id, blockedId]);
        if (!result.rowCount) return [];
        return createRelationshipSyncEvents(client, {
          userIds: [req.user.id, blockedId],
          eventType: "user.unblocked"
        });
      });
      if (syncEvents.length) {
        logger.info("user.unblocked", { userID: req.user.id, blockedID: blockedId, events: syncEvents.length });
        notifySyncEvents(syncEvents);
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/messages/threads", requireAuth, asyncRoute(async (req, res) => {
    res.json(await loadThreadsPage({ query }, req.user.id, req.query));
  }));
  router.get("/messages/threads/:threadId/messages", requireAuth, asyncRoute(async (req, res) => {
    res.json(await messageHistoryPage(req.user.id, req.params.threadId, req.query));
  }));

  router.post("/messages/threads/:id/messages", requireAuth, requireUnrestrictedUser, async (req, res, next) => {
    try {
      const threadId = trimmedString(req.params.id);
      const recipientUserID = trimmedString(req.body.recipientUserID);
      const relatedPostID = trimmedString(req.body.relatedPostID) || null;
      const imageObjectKey = assertOwnedObjectKeys(req.user.id, [trimmedString(req.body.imageObjectKey)], ["message"])[0] || "";
      if (imageObjectKey) await assertReadyUploads(req.user.id, [imageObjectKey]);
      const body = trimmedString(req.body.body, imageObjectKey ? "[图片]" : "");
      const sharedPostID = trimmedString(req.body.sharedPostID) || null;
      const sharedProfileUserID = trimmedString(req.body.sharedProfileUserID) || null;
      const requestedMessageID = trimmedString(req.body.messageID);
      const messageId = requestedMessageID.startsWith("m-") ? requestedMessageID : `m-${randomUUID()}`;

      if (!threadId.startsWith("t-")) throw badRequest("会话无效");
      if (!body && !imageObjectKey && !sharedPostID && !sharedProfileUserID) throw badRequest("消息不能为空");
      if (!recipientUserID || recipientUserID === req.user.id) throw badRequest("收信人无效");

      const recipient = await query("SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL AND status = 'active'", [recipientUserID]);
      if (!recipient.rows[0]) throw badRequest("收信人不存在");
      const blockRows = await query(
        `SELECT blocker_id FROM user_blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)`,
        [req.user.id, recipientUserID]
      );
      if (blockRows.rows.length) {
        // 双向都拉黑时「对方拉黑我」优先，客户端按 code 展示失败原因。
        const blockedByRecipient = blockRows.rows.some((row) => row.blocker_id === recipientUserID);
        throw badRequest("无法向该用户发送消息", blockedByRecipient ? "blocked_by_recipient" : "blocked_recipient");
      }

      if (relatedPostID) {
        const association = await query("SELECT 1 FROM message_threads WHERE id=$1 AND related_post_id=$2 AND $3 IN(buyer_user_id,publisher_user_id)", [threadId, relatedPostID, req.user.id]);
        if (!association.rowCount) {
          const post = await query(`SELECT p.id FROM posts p WHERE p.id=$1 AND ${visiblePostSQL("p", "$2")}`, [relatedPostID, req.user.id]);
          if (!post.rowCount) throw badRequest("关联帖子不存在或不可见");
        }
      }
      if (sharedPostID && !(await query(`SELECT 1 FROM posts p WHERE p.id=$1 AND ${visiblePostSQL("p", "$2")}`, [sharedPostID, req.user.id])).rowCount) throw badRequest("分享的帖子不存在或不可见");
      if (sharedProfileUserID && !(await query(`SELECT 1 FROM users u WHERE u.id=$1 AND u.status='active' AND u.deleted_at IS NULL AND ${unblockedSQL("u.id", "$2")}`, [sharedProfileUserID, req.user.id])).rowCount) throw badRequest("分享的用户不存在或不可见");

      const { thread, syncEvents } = await withTransaction(async (client) => {
        await assertUnrestrictedUser(client, req.user.id);
        if (imageObjectKey) await assertReadyUploads(req.user.id, [imageObjectKey], client, { markReferenced: true });
        const existingById = await client.query("SELECT * FROM message_threads WHERE id = $1 FOR UPDATE", [threadId]);
        let actualThreadId = threadId;
        if (existingById.rows[0]) {
          const row = existingById.rows[0];
          const currentIsParticipant = row.buyer_user_id === req.user.id || row.publisher_user_id === req.user.id;
          const recipientIsParticipant = row.buyer_user_id === recipientUserID || row.publisher_user_id === recipientUserID;
          if (!currentIsParticipant || !recipientIsParticipant) throw badRequest("不能向该会话发送消息");
          actualThreadId = row.id;
        } else {
          const existingByParticipants = await client.query(
            `SELECT *
             FROM message_threads
             WHERE (
               (buyer_user_id = $1 AND publisher_user_id = $2)
               OR (buyer_user_id = $2 AND publisher_user_id = $1)
             )
             ORDER BY updated_at DESC
             LIMIT 1
             FOR UPDATE`,
            [req.user.id, recipientUserID]
          );
          if (existingByParticipants.rows[0]) {
            actualThreadId = existingByParticipants.rows[0].id;
          } else {
            actualThreadId = canonicalThreadId(req.user.id, recipientUserID);
            if (actualThreadId !== threadId) {
              const requestedIdTaken = await client.query("SELECT 1 FROM message_threads WHERE id = $1", [actualThreadId]);
              if (requestedIdTaken.rows[0]) actualThreadId = threadId;
            }
          }
        }

        const existingActual = await client.query("SELECT * FROM message_threads WHERE id = $1 FOR UPDATE", [actualThreadId]);
        if (!existingActual.rows[0]) {
          await client.query(
            `INSERT INTO message_threads (id, buyer_user_id, publisher_user_id, related_post_id)
             VALUES ($1, $2, $3, $4)`,
            [actualThreadId, req.user.id, recipientUserID, relatedPostID]
          );
        } else if (!existingActual.rows[0].related_post_id && relatedPostID) {
          await client.query("UPDATE message_threads SET related_post_id = $2 WHERE id = $1", [actualThreadId, relatedPostID]);
        }

        const insertedMessage = await client.query(
          `INSERT INTO direct_messages (id, thread_id, sender_id, body, image_object_key, shared_post_id, shared_profile_user_id)
           VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [messageId, actualThreadId, req.user.id, body, imageObjectKey, sharedPostID, sharedProfileUserID]
        );
        let syncEvents = [];
        if (insertedMessage.rows[0]) {
          await client.query("UPDATE message_threads SET updated_at = now() WHERE id = $1", [actualThreadId]);
          await client.query(
            `INSERT INTO message_thread_reads (thread_id, user_id, read_at)
             VALUES ($1, $2, now())
             ON CONFLICT (thread_id, user_id) DO UPDATE SET read_at = EXCLUDED.read_at`,
            [actualThreadId, req.user.id]
          );
          syncEvents = await createThreadSyncEvents(client, {
            userIds: [req.user.id, recipientUserID],
            eventType: "message.created",
            entityType: "direct_message",
            entityId: messageId,
            threadId: actualThreadId
          });
        }
        return {
          thread: await loadMessageThreadForUser(client, actualThreadId, req.user.id, { messageIDs: [messageId] }),
          syncEvents
        };
      });

      if (syncEvents.length) {
        logger.info("message.created", { threadID: thread.id, messageID: messageId, events: syncEvents.length });
        notifySyncEvents(syncEvents);
      }
      res.status(201).json({ thread });
    } catch (error) {
      next(error);
    }
  });

  router.post("/messages/threads/:id/read", requireAuth, async (req, res, next) => {
    try {
      const threadId = trimmedString(req.params.id);
      const syncEvents = await withTransaction(async (client) => {
        const participant = await client.query(
          "SELECT * FROM message_threads WHERE id = $1 AND (buyer_user_id = $2 OR publisher_user_id = $2) FOR UPDATE",
          [threadId, req.user.id]
        );
        const thread = participant.rows[0];
        if (!thread) {
          const error = new Error("会话不存在");
          error.status = 404;
          throw error;
        }
        await client.query(
          `INSERT INTO message_thread_reads (thread_id, user_id, read_at)
           VALUES ($1, $2, now())
           ON CONFLICT (thread_id, user_id) DO UPDATE SET read_at = EXCLUDED.read_at`,
          [threadId, req.user.id]
        );
        await client.query("UPDATE message_threads SET revision=revision WHERE id=$1", [threadId]);
        const peerUserID = thread.buyer_user_id === req.user.id ? thread.publisher_user_id : thread.buyer_user_id;
        return createThreadSyncEvents(client, {
          userIds: [req.user.id, peerUserID],
          eventType: "message.read",
          entityType: "message_thread",
          entityId: threadId,
          threadId
        });
      });
      logger.info("message_thread.read", { threadID: threadId, userID: req.user.id, events: syncEvents.length });
      notifySyncEvents(syncEvents);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/messages/threads/:threadId/messages/:messageId", requireAuth, async (req, res, next) => {
    try {
      const threadId = trimmedString(req.params.threadId);
      const messageId = trimmedString(req.params.messageId);
      const { thread, syncEvents } = await withTransaction(async (client) => {
        const thread = await selectMessageThreadParticipant(client, threadId, req.user.id);
        const message = await selectThreadMessage(client, threadId, messageId);
        await client.query(
          `UPDATE direct_messages
           SET deleted_for_user_ids = CASE
             WHEN $2 = ANY(deleted_for_user_ids) THEN deleted_for_user_ids
             ELSE array_append(deleted_for_user_ids, $2)
           END
           WHERE id = $1`,
          [message.id, req.user.id]
        );
        await client.query("UPDATE message_threads SET revision=revision WHERE id=$1", [thread.id]);
        const syncEvents = await createThreadSyncEvents(client, {
          userIds: [req.user.id],
          eventType: "message.deleted",
          entityType: "direct_message",
          entityId: message.id,
          threadId: thread.id
        });
        return {
          thread: await loadMessageThreadForUser(client, thread.id, req.user.id, { messageIDs: [message.id] }),
          syncEvents
        };
      });
      logger.info("message.deleted", { threadID: thread.id, messageID: messageId, userID: req.user.id });
      notifySyncEvents(syncEvents);
      res.json({ thread });
    } catch (error) {
      next(error);
    }
  });

  router.post("/messages/threads/:threadId/messages/:messageId/revoke", requireAuth, async (req, res, next) => {
    try {
      const threadId = trimmedString(req.params.threadId);
      const messageId = trimmedString(req.params.messageId);
      const { thread, syncEvents } = await withTransaction(async (client) => {
        const thread = await selectMessageThreadParticipant(client, threadId, req.user.id);
        const message = await selectThreadMessage(client, threadId, messageId);
        if (message.sender_id !== req.user.id) throw badRequest("只能撤回自己发送的消息");
        if (Date.now() - new Date(message.created_at).getTime() > 2 * 60 * 1000) {
          throw badRequest("只能撤回 2 分钟内发送的消息");
        }
        await client.query("UPDATE direct_messages SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1", [message.id]);
        await client.query("UPDATE message_threads SET updated_at = now() WHERE id = $1", [thread.id]);
        const peerUserID = thread.buyer_user_id === req.user.id ? thread.publisher_user_id : thread.buyer_user_id;
        const syncEvents = await createThreadSyncEvents(client, {
          userIds: [req.user.id, peerUserID],
          eventType: "message.revoked",
          entityType: "direct_message",
          entityId: message.id,
          threadId: thread.id
        });
        return {
          thread: await loadMessageThreadForUser(client, thread.id, req.user.id, { messageIDs: [message.id] }),
          syncEvents
        };
      });
      logger.info("message.revoked", { threadID: thread.id, messageID: messageId, userID: req.user.id, events: syncEvents.length });
      notifySyncEvents(syncEvents);
      res.json({ thread });
    } catch (error) {
      next(error);
    }
  });

  if (config.safety.enabled) router.use(createSafetyReportRouter());
  else mountLegacyReportRoute(router);

  router.post("/uploads/presign", requireAuth, asyncRoute(async (req, res) => {
    res.json(await issueUploadTicket(req.user.id, req.body));
  }));

  return router;
}

async function findActiveUserByEmail(email) {
  const { rows } = await query(`SELECT u.*, EXISTS (SELECT 1 FROM auth_identities i
    WHERE i.user_id = u.id AND i.provider = 'email' AND i.email = u.email AND i.email_verified
  ) AS email_verified FROM users u WHERE u.email = $1 AND u.deleted_at IS NULL AND u.status = 'active'`, [email]);
  return rows[0] || null;
}

async function verifyEmailPasswordLogin(email, password) {
  const user = await findActiveUserByEmail(email);
  if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
    throw unauthorized("密码和邮箱不匹配");
  }
  return user;
}

async function createEmailUser(client, { email, passwordHash, nickname, emailVerified }) {
  const userId = `u-${randomUUID()}`;
  const avatarSymbol = Array.from(nickname)[0] || "新";
  const inserted = await client.query(
    `INSERT INTO users (id, email, password_hash, nickname, bio, avatar_symbol, red_book_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, email, passwordHash, nickname, "点击这里，填写简介", avatarSymbol, email.split("@")[0]]
  );
  await client.query(
    `INSERT INTO auth_identities (id, user_id, provider, provider_subject, email, email_verified, display_name)
     VALUES ($1, $2, 'email', $3, $3, $4, $5)
     ON CONFLICT (provider, provider_subject) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         email = EXCLUDED.email,
         email_verified = auth_identities.email_verified OR EXCLUDED.email_verified,
         display_name = EXCLUDED.display_name,
         updated_at = now()`,
    [`ident-${randomUUID()}`, userId, email, emailVerified, nickname]
  );
  await client.query(
    `INSERT INTO group_collections (id, owner_id, name, deadline, default_note)
     VALUES ($1, $2, $3, now() + interval '7 days', $4)`,
    [`col-${randomUUID()}`, userId, "我的第一个拼团合集", "该合集用于内部测试发布，可在后续版本编辑联系方式和截团时间。"]
  );
  return inserted.rows[0];
}

async function issueEmailCode({ email, purpose }) {
  const id = `evc-${randomUUID()}`;
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const codeHash = hashEmailCode({ email, purpose, code });
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`email-code:${email}:${purpose}`]);
    const recent = await client.query(
      `SELECT id FROM email_verification_codes WHERE email = $1 AND purpose = $2
       AND created_at > clock_timestamp() - ($3::int * interval '1 second') LIMIT 1`,
      [email, purpose, config.email.codeResendSeconds]
    );
    if (recent.rows.length) throw badRequest("验证码发送太频繁，请稍后再试");
    await client.query("UPDATE email_verification_codes SET consumed_at = now() WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL", [email, purpose]);
    await client.query(
      `INSERT INTO email_verification_codes (id, email, purpose, code_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4, clock_timestamp(), clock_timestamp() + ($5::int * interval '1 minute'))`,
      [id, email, purpose, codeHash, config.email.codeTtlMinutes]
    );
  });

  try {
    await sendEmailCode({ email, purpose, code });
  } catch (error) {
    await query("DELETE FROM email_verification_codes WHERE id = $1", [id]).catch(() => {});
    throw error;
  }
}

async function consumeEmailCode(client, { email, purpose, code }) {
  const { rows } = await client.query(
    `SELECT *
     FROM email_verification_codes
     WHERE email = $1
       AND purpose = $2
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [email, purpose]
  );
  const record = rows[0];
  if (!record || record.consumed_at || new Date(record.expires_at) <= new Date()) {
    return badRequest("验证码无效或已过期");
  }
  if (record.attempts >= 5) {
    return badRequest("验证码错误次数过多，请重新获取");
  }
  const expectedHash = hashEmailCode({ email, purpose, code });
  if (record.code_hash !== expectedHash) {
    await client.query("UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = $1", [record.id]);
    return badRequest("验证码无效或已过期");
  }
  await client.query("UPDATE email_verification_codes SET consumed_at = now() WHERE id = $1", [record.id]);
}

function hashEmailCode({ email, purpose, code }) {
  return createHash("sha256")
    .update(`${email}:${purpose}:${code}:${config.email.codeSecret}`)
    .digest("hex");
}

async function authPayload(user) {
  const syncCursor = await getCurrentSyncCursor();
  return {
    token: signToken(user),
    currentUser: userToClient(user, {}, user.id),
    syncCursor,
    ...(await loadBootstrap(user.id))
  };
}

async function syncAudienceForPublicContent(_client, seedUserIds, shouldBroadcast) {
  return [...uniqueIds(seedUserIds), ...(shouldBroadcast ? [null] : [])];
}

async function setPostReaction({ userId, postId, table, eventType, enabled }) {
  if (!["post_likes", "post_favorites"].includes(table)) {
    throw badRequest("互动类型无效");
  }
  return withTransaction(async (client) => {
    const post = await client.query(`SELECT p.id, p.author_id FROM posts p WHERE p.id = $1 AND ${visiblePostSQL("p", "$2")} FOR SHARE OF p`, [postId, userId]);
    if (enabled && !post.rows[0]) {
      const error = badRequest("帖子不存在或不可互动"); error.status = 404; throw error;
    }

    const result = enabled
      ? await client.query(`INSERT INTO ${table} (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, postId])
      : await client.query(`DELETE FROM ${table} WHERE user_id = $1 AND post_id = $2`, [userId, postId]);
    if (!result.rowCount) return [];

    const audience = uniqueIds([userId, post.rows[0]?.author_id]);
    return createSyncEventsForUsers(client, {
      userIds: audience,
      eventType,
      entityType: "post",
      entityId: postId
    });
  });
}

async function setFollowState({ followerId, followingId, enabled }) {
  if (followerId === followingId) return [];
  return withTransaction(async (client) => {
    if (enabled) await assertUnrestrictedUser(client, followerId);
    const target = await client.query("SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL AND status = 'active'", [followingId]);
    if (!target.rows[0]) return [];
    if (enabled) {
      const blockRows = await userBlockRowsBetween(client, followerId, followingId);
      if (blockRows.length) {
        const blockedByRecipient = blockRows.some((row) => row.blocker_id === followingId);
        throw badRequest("无法关注该用户", blockedByRecipient ? "blocked_by_recipient" : "blocked_recipient");
      }
    }

    const result = enabled
      ? await client.query("INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [followerId, followingId])
      : await client.query("DELETE FROM follows WHERE follower_id = $1 AND following_id = $2", [followerId, followingId]);
    if (!result.rowCount) return [];

    const audience = uniqueIds([followerId, followingId]);
    const entityIds = uniqueIds([followerId, followingId]);
    const syncEvents = [];
    for (const entityId of entityIds) {
      syncEvents.push(...(await createSyncEventsForUsers(client, {
        userIds: audience,
        eventType: enabled ? "user.followed" : "user.unfollowed",
        entityType: "user",
        entityId
      })));
    }
    return syncEvents;
  });
}

async function createRelationshipSyncEvents(client, { userIds, eventType }) {
  const audience = uniqueIds(userIds);
  const syncEvents = [];
  for (const entityId of audience) {
    syncEvents.push(...(await createSyncEventsForUsers(client, {
      userIds: audience,
      eventType,
      entityType: "user",
      entityId
    })));
  }
  return syncEvents;
}

function canonicalThreadId(userA, userB) {
  return `t-dm-${[userA, userB].sort().join("-")}`;
}

async function selectMessageThreadParticipant(client, threadId, userId) {
  const { rows } = await client.query(
    "SELECT * FROM message_threads WHERE id = $1 AND (buyer_user_id = $2 OR publisher_user_id = $2) FOR UPDATE",
    [threadId, userId]
  );
  if (!rows[0]) {
    const error = new Error("会话不存在");
    error.status = 404;
    throw error;
  }
  return rows[0];
}

async function selectThreadMessage(client, threadId, messageId) {
  const { rows } = await client.query("SELECT * FROM direct_messages WHERE id = $1 AND thread_id = $2 FOR UPDATE", [messageId, threadId]);
  if (!rows[0]) {
    const error = new Error("消息不存在");
    error.status = 404;
    throw error;
  }
  return rows[0];
}

function collectObjectKeys(userRows = [], postRows = [], messageRows = []) {
  const keys = new Set();
  for (const row of userRows) {
    if (row.avatar_object_key) keys.add(row.avatar_object_key);
    if (row.background_object_key) keys.add(row.background_object_key);
  }
  for (const row of postRows) {
    for (const key of row.image_object_keys || []) keys.add(key);
    for (const key of row.preview_image_object_keys || []) keys.add(key);
  }
  for (const row of messageRows) {
    if (row.image_object_key) keys.add(row.image_object_key);
  }
  return [...keys];
}

async function blockExistsBetween(executor, userA, userB) {
  return (await userBlockRowsBetween(executor, userA, userB)).length > 0;
}

async function userBlockRowsBetween(executor, userA, userB) {
  if (!userA || !userB) return [];
  const { rows } = await executor.query(
    `SELECT blocker_id FROM user_blocks
     WHERE (blocker_id = $1 AND blocked_id = $2)
        OR (blocker_id = $2 AND blocked_id = $1)
     LIMIT 2`,
    [userA, userB]
  );
  return rows;
}

function uniqueIds(values) {
  return [...new Set(values.filter(Boolean))];
}

function boundedFeedLimit(value) {
  const parsed = Number.parseInt(String(value || "40"), 10);
  if (!Number.isFinite(parsed)) return 40;
  return Math.min(Math.max(parsed, 1), 60);
}

function safeImageContentType(rawContentType) {
  const normalized = String(rawContentType || "").split(";")[0].trim().toLowerCase();
  return ALLOWED_IMAGE_CONTENT_TYPES.has(normalized) ? normalized : "application/octet-stream";
}


async function createCollection(userId, body) {
  const name = trimmedString(body.name);
  if (!name) throw badRequest("请填写合集名称");
  const collectionId = trimmedString(body.id) || `col-${randomUUID()}`;
  if (!/^col-[A-Za-z0-9_-]{1,120}$/.test(collectionId)) throw badRequest("合集编号无效");
  const submissionHash = requestHash(body);
  const assertReplay = row => {
    if (row.owner_id !== userId || row.submission_hash !== submissionHash || row.status === 'deleted') {
      const error = badRequest('提交编号已使用，请重新加载合集'); error.status = 409; throw error;
    }
    return { collection: collectionToClient(row, []), syncEvents: [] };
  };
  const existing = (await query('SELECT * FROM group_collections WHERE id=$1', [collectionId])).rows[0];
  if (existing) return assertReplay(existing);
  await assertCollectionNameAvailable({ ownerId: userId, name });
  const deadline = parseDate(body.deadline) || new Date(Date.now() + 7 * 86400 * 1000);
  const snapshot = collectionSnapshot(body, { name });
  const moderation = await reviewSubmission({
    targetType: "collection",
    targetId: collectionId,
    ownerId: userId,
    text: publicContentModerationText(snapshot)
  });
  return withTransaction(async client => {
  await assertUnrestrictedUser(client, userId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["collection-names:" + userId]);
  const committed = (await client.query('SELECT * FROM group_collections WHERE id=$1', [collectionId])).rows[0];
  if (committed) return assertReplay(committed);
  await assertCollectionNameAvailable({ ownerId: userId, name, executor: client });
  const { rows } = await client.query(
    `INSERT INTO group_collections (id, owner_id, name, contact_wechat, contact_qq, contact_group_number, group_info, deadline, default_note, status, submission_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      collectionId,
      userId,
      name,
      snapshot.wechat,
      snapshot.qq,
      snapshot.groupNumber,
      snapshot.groupInfo,
      deadline,
      snapshot.defaultNote,
      moderation.status,
      submissionHash
    ]
  );
  if (moderation.status !== "active") {
    await createModerationReview(client, {
      targetType: "collection",
      targetId: collectionId,
      ownerId: userId,
      result: moderation,
      textSnapshot: publicContentModerationText(snapshot),
      snapshot
    });
  }
  const syncEvents = await createSyncEventsForUsers(client, { userIds: [userId, ...(moderation.status === "active" ? [null] : [])], eventType: "collection.created", entityType: "collection", entityId: collectionId });
  return { collection: collectionToClient(rows[0], []), syncEvents };
  });
}

async function updateCollection(userId, collectionId, body) {
  const current = (await query("SELECT * FROM group_collections WHERE id = $1 AND owner_id = $2", [collectionId, userId])).rows[0];
  if (!current) {
    const error = new Error("合集不存在");
    error.status = 404;
    throw error;
  }
  assertRevision(current, body.revision);
  const name = trimmedString(body.name, current.name);
  if (!name) throw badRequest("请填写合集名称");
  await assertCollectionNameAvailable({ ownerId: userId, name, excludingId: collectionId });
  const deadline = parseDate(body.deadline) || current.deadline || new Date(Date.now() + 7 * 86400 * 1000);
  const snapshot = collectionSnapshot(body, {
    name,
    wechat: current.contact_wechat,
    qq: current.contact_qq,
    groupNumber: current.contact_group_number,
    groupInfo: current.group_info,
    defaultNote: current.default_note
  });
  const moderation = await reviewSubmission({
    targetType: "collection",
    targetId: collectionId,
    ownerId: userId,
    text: publicContentModerationText(snapshot)
  });
  return withTransaction(async (client) => {
    await assertUnrestrictedUser(client, userId);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["collection-names:" + userId]);
    const latest = (await client.query("SELECT * FROM group_collections WHERE id=$1 AND owner_id=$2 FOR UPDATE", [collectionId, userId])).rows[0];
    assertRevision(latest, body.revision);
    if (latest.safety_status !== "active" || latest.contact_visibility !== "active") throw badRequest("请通过整改流程修改受限合集");
    await assertCollectionNameAvailable({ ownerId: userId, name, excludingId: collectionId, executor: client });
    const { rows } = await client.query(
      `UPDATE group_collections
       SET name = $3,
           contact_wechat = $4,
           contact_qq = $5,
           contact_group_number = $6,
           group_info = $7,
           deadline = $8,
           default_note = $9,
           status = $10,
           updated_at = now()
       WHERE id = $1 AND owner_id = $2
       RETURNING *`,
      [
        collectionId,
        userId,
        name,
        snapshot.wechat,
        snapshot.qq,
        snapshot.groupNumber,
        snapshot.groupInfo,
        deadline,
        snapshot.defaultNote,
        moderation.status
      ]
    );
    if (moderation.status !== "active") {
      await createModerationReview(client, {
        targetType: "collection",
        targetId: collectionId,
        ownerId: userId,
        result: moderation,
        textSnapshot: publicContentModerationText(snapshot),
        snapshot
      });
    }
    const postIds = await collectionPostIds(client, collectionId, userId);
    const syncEvents = await createSyncEventsForUsers(client, {
      userIds: [userId, null],
      eventType: "collection.updated",
      entityType: "collection",
      entityId: collectionId
    });
    return { collection: collectionToClient(rows[0], postIds), syncEvents };
  });
}

async function assertCollectionNameAvailable({ ownerId, name, excludingId = "", executor = { query } }) {
  const params = [ownerId, name];
  let idClause = "";
  if (excludingId) {
    params.push(excludingId);
    idClause = "AND id <> $3";
  }
  const { rows } = await executor.query(
    `SELECT id
     FROM group_collections
     WHERE owner_id = $1
       AND lower(name) = lower($2)
       AND status <> 'deleted'
       ${idClause}
     LIMIT 1`,
    params
  );
  if (rows[0]) throw badRequest("已有同名合集");
}

function collectionSnapshot(body, fallback = {}) {
  const field = (key, fallbackValue = "") =>
    Object.prototype.hasOwnProperty.call(body, key) ? trimmedString(body[key]) : trimmedString(fallbackValue);
  const snapshot = {
    name: field("name", fallback.name || ""),
    wechat: field("wechat", fallback.wechat || ""),
    qq: field("qq", fallback.qq || ""),
    groupNumber: field("groupNumber", fallback.groupNumber || ""),
    groupInfo: field("groupInfo", fallback.groupInfo || ""),
    defaultNote: field("defaultNote", fallback.defaultNote || "该合集内帖子共享联系方式、截团时间和默认说明。")
  };
  if (!snapshot.wechat && !snapshot.qq && !snapshot.groupNumber) {
    throw badRequest("微信、QQ、QQ群号至少填写一个");
  }
  if (!snapshot.defaultNote) {
    snapshot.defaultNote = "该合集内帖子共享联系方式、截团时间和默认说明。";
  }
  return snapshot;
}

async function collectionPostIds(client, collectionId, userId) {
  const { rows } = await client.query(
    `SELECT COALESCE(array_agg(id ORDER BY created_at DESC), ARRAY[]::text[]) AS post_ids
     FROM posts
     WHERE collection_id = $1
       AND (
         status = 'active'
         OR (author_id = $2 AND status IN ('pending', 'review', 'rejected', 'hidden', 'removed'))
       )`,
    [collectionId, userId]
  );
  return rows[0]?.post_ids || [];
}

async function reviewRegistrationText(nickname) {
  return reviewSubmission({
    targetType: "profileText",
    targetId: "registration",
    ownerId: "",
    text: nickname
  });
}

function publicRegistrationNickname(nickname, moderation) {
  return moderation?.status === "active" ? nickname : "待审核用户";
}

async function createRegistrationNicknameReview(client, user, nickname, moderation) {
  if (!user?.id || moderation?.status === "active") return null;
  return createModerationReview(client, {
    targetType: "profileText",
    targetId: user.id,
    ownerId: user.id,
    result: moderation,
    textSnapshot: nickname,
    snapshot: {
      nickname,
      bio: user.bio || "点击这里，填写简介",
      redBookID: user.red_book_id || "",
      gender: user.gender || "未设置",
      birthday: user.birthday || "选择生日",
      region: user.region || "未设置",
      avatarSymbol: Array.from(nickname)[0] || "新",
      avatarTint: user.avatar_tint || "rose",
      backgroundImageName: user.background_image_name || "merch_magazine"
    }
  });
}

function moderationResponse(results) {
  const blocked = results.find((result) => result.status === "rejected");
  if (blocked) return blocked;
  const review = results.find((result) => result.status === "review" || result.status === "pending");
  if (review) return review;
  return results[0] || { outcome: "pass", status: "active", reason: "审核通过" };
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function unauthorized(message) {
  const error = new Error(message);
  error.status = 401;
  return error;
}

function mountLegacyReportRoute(router) {
  router.post("/reports", requireAuth, async (req, res, next) => {
    try {
      const targetType = req.body.targetType === "comment" ? "comment" : "post";
      const targetId = trimmedString(req.body.targetID);
      if (!targetId) throw badRequest("举报目标不能为空");
      await assertReportTargetExists(targetType, targetId);
      const report = await withTransaction(async (client) => {
        await closeLegacyTerminalPendingReports(client, req.user.id, targetType, targetId);
        const safetyCase = await findOrCreateLegacyOpenCase(client, targetType, targetId);
        const { rows } = await client.query(
          `INSERT INTO reports (
             id, target_type, target_id, reason, detail, reporter_id, status,
             client_request_id, case_id, source_type, source_id, subject_type, subject_id, reason_code, reported_field
           ) VALUES (
             $1, $2, $3, $4, $5, $6, 'pending',
             $7, $8, $2, $3, $2, $3, 'other', 'content'
           )
           ON CONFLICT DO NOTHING
           RETURNING *`,
          [
            `rp-${randomUUID()}`,
            targetType,
            targetId,
            trimmedString(req.body.reason, "用户举报"),
            trimmedString(req.body.detail),
            req.user.id,
            `legacy-${randomUUID()}`,
            safetyCase.id
          ]
        );
        return rows[0] || null;
      });
      if (!report) return res.status(200).json({ ok: true, message: "你已举报过该内容，我们会尽快处理" });
      res.status(201).json({ report });
    } catch (error) {
      next(error);
    }
  });
}

async function assertReportTargetExists(targetType, targetId) {
  const target =
    targetType === "comment"
      ? await query("SELECT id FROM comments WHERE id = $1 AND status <> 'deleted'", [targetId])
      : await query("SELECT id FROM posts WHERE id = $1 AND status <> 'deleted'", [targetId]);
  if (!target.rows[0]) {
    throw badRequest(targetType === "comment" ? "举报的评论不存在" : "举报的帖子不存在");
  }
}


async function closeLegacyTerminalPendingReports(client, reporterID, targetType, targetID) {
  await client.query(
    `UPDATE reports r
     SET status = 'closed', updated_at = now()
     FROM safety_cases sc
     WHERE r.case_id = sc.id
       AND r.reporter_id = $1
       AND r.target_type = $2
       AND r.target_id = $3
       AND r.reason_code = 'other'
       AND r.status = 'pending'
       AND sc.category = 'other'
       AND sc.status IN ('resolved_no_action', 'resolved_restored', 'resolved_actioned')`,
    [reporterID, targetType, targetID]
  );
}

async function findOrCreateLegacyOpenCase(client, targetType, targetID) {
  const existing = await findLegacyOpenCase(client, targetType, targetID);
  if (existing) return existing;

  const { rows } = await client.query(
    `INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope)
     VALUES ($1, $2, $3, 'other', $2)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [`sc-${randomUUID()}`, targetType, targetID]
  );
  if (rows[0]) return rows[0];

  const raced = await findLegacyOpenCase(client, targetType, targetID);
  if (raced) return raced;
  throw new Error("Unable to create legacy safety case");
}

async function findLegacyOpenCase(client, targetType, targetID) {
  const { rows } = await client.query(
    `SELECT *
     FROM safety_cases
     WHERE subject_type = $1
       AND subject_id = $2
       AND category = 'other'
       AND status NOT IN ('resolved_no_action', 'resolved_restored', 'resolved_actioned')
     LIMIT 1
     FOR UPDATE`,
    [targetType, targetID]
  );
  return rows[0] || null;
}
