import { createHash, randomInt, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import express from "express";
import { hashPassword, requireAuth, signToken, verifyPassword } from "./auth.js";
import { loadBootstrap } from "./bootstrap.js";
import { config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { sendEmailCode } from "./email.js";
import { collectionToClient, commentToClient, moderationReviewToClient, postToClient, userToClient } from "./mappers.js";
import { loadMessageThreadForUser } from "./messages.js";
import { assertOwnedObjectKeys, createModerationReview, isModerationAdmin, reviewSubmission } from "./moderation/index.js";
import { moderationText, postModerationSnapshot, publicContentModerationText } from "./moderation/text.js";
import { createUploadTarget, signedReadUrl } from "./oss.js";
import { createRateLimiter } from "./rateLimit.js";
import { notifySyncEvents } from "./realtime.js";
import { createSyncEventsForUsers, createThreadSyncEvents, getCurrentSyncCursor, loadSyncPayload } from "./sync.js";
import { arrayOfStrings, assertEmail, assertEmailCode, assertEmailCodePurpose, assertPassword, badRequest, normalizeEmail, trimmedString } from "./validators.js";

export function createRouter() {
  const router = express.Router();
  const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: "登录尝试太频繁，请稍后再试",
    keyGenerator: (req) => `${req.ip}:${normalizeEmail(req.body?.email)}`
  });
  const emailCodeLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 3,
    message: "验证码发送太频繁，请稍后再试",
    keyGenerator: (req) => `${req.ip}:${normalizeEmail(req.body?.email)}:${req.body?.purpose || ""}`
  });

  router.get("/health", async (_req, res) => {
    await query("SELECT 1");
    res.json({ ok: true });
  });

  router.get("/assets/*", async (req, res, next) => {
    try {
      const objectKey = String(req.params[0] || "");
      if (!/^(post|avatar|background)\//.test(objectKey) || objectKey.includes("..")) {
        return res.status(404).json({ error: "图片不存在" });
      }

      const upstream = await fetch(signedReadUrl(objectKey, 60));
      if (!upstream.ok || !upstream.body) {
        return res.status(upstream.status || 404).json({ error: "图片不存在" });
      }

      res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=300");
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
        await consumeEmailCode(client, { email, purpose: "register", code });
        const user = await createEmailUser(client, { email, passwordHash, nickname: publicRegistrationNickname(nickname, nicknameModeration), emailVerified: true });
        await createRegistrationNicknameReview(client, user, nickname, nicknameModeration);
        return user;
      });
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
          await consumeEmailCode(client, { email, purpose: "login", code: assertEmailCode(code) });
          return rows[0];
        });
        return res.json(await authPayload(user));
      }

      const user = await verifyEmailPasswordLogin(email, password);
      res.json(await authPayload(user));
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/register", authLimiter, async (req, res, next) => {
    try {
      const email = assertEmail(req.body.email);
      const password = assertPassword(req.body.password);
      const nickname = trimmedString(req.body.nickname);
      if (!nickname) throw badRequest("请填写昵称");
      const nicknameModeration = await reviewRegistrationText(nickname);
      if (nicknameModeration.status === "rejected") throw badRequest(nicknameModeration.reason);

      const passwordHash = await hashPassword(password);
      const user = await withTransaction(async (client) => {
        const existing = await client.query("SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL AND status = 'active'", [email]);
        if (existing.rows[0]) throw badRequest("本邮箱已经注册过");
        const user = await createEmailUser(client, { email, passwordHash, nickname: publicRegistrationNickname(nickname, nicknameModeration), emailVerified: false });
        await createRegistrationNicknameReview(client, user, nickname, nicknameModeration);
        return user;
      });
      res.status(201).json(await authPayload(user));
    } catch (error) {
      next(error);
    }
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

  router.get("/bootstrap", requireAuth, async (req, res) => {
    const syncCursor = await getCurrentSyncCursor();
    res.json({ currentUser: userToClient(req.user), syncCursor, ...(await loadBootstrap(req.user.id)) });
  });

  router.get("/sync", requireAuth, async (req, res, next) => {
    try {
      const payload = await loadSyncPayload(req.user.id, { cursor: req.query.cursor, limit: req.query.limit });
      console.log(`sync cursor request user=${req.user.id} cursor=${String(req.query.cursor || "0")} next=${payload.nextCursor} events=${payload.events.length}`);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", requireAuth, async (req, res) => {
    res.json({ user: userToClient(req.user) });
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

  router.patch("/me", requireAuth, async (req, res, next) => {
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

      const profileSnapshot = { nickname, bio, redBookID, gender, birthday, region, avatarSymbol, avatarTint, backgroundImageName };
      const textResult = await reviewSubmission({
        targetType: "profileText",
        targetId: req.user.id,
        ownerId: req.user.id,
        text: moderationText(profileSnapshot)
      });
      const avatarResult = avatarObjectKey
        ? await reviewSubmission({ targetType: "avatar", targetId: req.user.id, ownerId: req.user.id, imageObjectKeys: [avatarObjectKey] })
        : null;
      const backgroundResult = backgroundObjectKey
        ? await reviewSubmission({ targetType: "profileBackground", targetId: req.user.id, ownerId: req.user.id, imageObjectKeys: [backgroundObjectKey] })
        : null;

      const user = await withTransaction(async (client) => {
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
        return rows[0];
      });
      res.json({ user: userToClient(user), moderation: moderationResponse([textResult, avatarResult, backgroundResult].filter(Boolean)) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/posts", async (_req, res) => {
    const { rows } = await query(`
      SELECT p.*,
        (SELECT count(*) FROM post_likes l WHERE l.post_id = p.id) AS liked_count,
        (SELECT count(*) FROM post_favorites f WHERE f.post_id = p.id) AS favorite_count,
        (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'active') AS comment_count,
        (SELECT count(*) FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id) AS report_count
      FROM posts p
      WHERE p.status = 'active'
      ORDER BY p.created_at DESC
      LIMIT 100
    `);
    res.json({ posts: rows.map((row) => postToClient(row, row)) });
  });

  router.get("/posts/:id", async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT p.*,
          (SELECT count(*) FROM post_likes l WHERE l.post_id = p.id) AS liked_count,
          (SELECT count(*) FROM post_favorites f WHERE f.post_id = p.id) AS favorite_count,
          (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'active') AS comment_count,
          (SELECT count(*) FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id) AS report_count
        FROM posts p WHERE p.id = $1 AND p.status = 'active'`,
        [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: "帖子不存在" });
      const comments = await query("SELECT * FROM comments WHERE post_id = $1 AND status = 'active' ORDER BY created_at ASC", [req.params.id]);
      res.json({ post: postToClient(rows[0], rows[0]), comments: comments.rows.map(commentToClient) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/collections", requireAuth, async (req, res, next) => {
    try {
      const collection = await createCollection(req.user.id, req.body);
      res.status(201).json({ collection });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/collections/:id", requireAuth, async (req, res, next) => {
    try {
      const { rowCount } = await query("DELETE FROM group_collections WHERE id = $1 AND owner_id = $2", [req.params.id, req.user.id]);
      if (!rowCount) return res.status(404).json({ error: "合集不存在" });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/posts", requireAuth, async (req, res, next) => {
    try {
      const title = trimmedString(req.body.title);
      if (!title) throw badRequest("请填写标题");
      const collectionId = trimmedString(req.body.collectionID);
      const collection = collectionId
        ? (await query("SELECT * FROM group_collections WHERE id = $1 AND owner_id = $2 AND status = 'active'", [collectionId, req.user.id])).rows[0]
        : null;
      const deadline = collection?.deadline || parseDate(req.body.deadline) || new Date(Date.now() + 7 * 86400 * 1000);
      const requestedId = trimmedString(req.body.id);
      const postId = requestedId.startsWith("p-") ? requestedId : `p-${randomUUID()}`;
      const imageObjectKeys = assertOwnedObjectKeys(req.user.id, arrayOfStrings(req.body.imageObjectKeys), ["post"]);
      const postSnapshot = postModerationSnapshot(req.body, collection, title);
      const moderation = await reviewSubmission({
        targetType: "post",
        targetId: postId,
        ownerId: req.user.id,
        text: publicContentModerationText(postSnapshot),
        imageObjectKeys
      });
      const { post, syncEvents } = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO posts (
          id, author_id, collection_id, title, image_names, image_object_keys, group_type,
          category_tags, fandom_tags, price, deposit, deadline, condition, is_formed, description,
          wechat, qq, group_info, external_link, status, image_aspect, pinggu_average_price, pinggu_note, unsold_roles
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, $23, $24
        ) RETURNING *`,
          [
            postId,
            req.user.id,
            collection?.id || null,
            title,
            arrayOfStrings(req.body.imageNames),
            imageObjectKeys,
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
            trimmedString(req.body.groupInfo, collection?.group_info || ""),
            trimmedString(req.body.externalLink),
            moderation.status,
            Number(req.body.imageAspect || 1.08),
            trimmedString(req.body.pingguAveragePrice),
            trimmedString(req.body.pingguNote),
            JSON.stringify(Array.isArray(req.body.unsoldRoles) ? req.body.unsoldRoles : [])
          ]
        );
        if (moderation.status !== "active") {
          await createModerationReview(client, {
            targetType: "post",
            targetId: postId,
            ownerId: req.user.id,
            result: moderation,
            textSnapshot: publicContentModerationText(postSnapshot),
            imageObjectKeys,
            snapshot: postSnapshot
          });
        }
        const audience = await syncAudienceForPublicContent(client, [req.user.id], moderation.status === "active");
        const syncEvents = await createSyncEventsForUsers(client, {
          userIds: audience,
          eventType: "post.created",
          entityType: "post",
          entityId: postId
        });
        return { post: rows[0], syncEvents };
      });
      if (syncEvents.length) {
        console.log(`post created id=${postId} status=${moderation.status} events=${syncEvents.length}`);
        notifySyncEvents(syncEvents);
      }
      res.status(201).json({ post: postToClient(post), moderation });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/posts/:id", requireAuth, async (req, res, next) => {
    try {
      const syncEvents = await withTransaction(async (client) => {
        const { rows } = await client.query(
          "UPDATE posts SET status = 'deleted', updated_at = now() WHERE id = $1 AND author_id = $2 RETURNING id",
          [req.params.id, req.user.id]
        );
        if (!rows[0]) return null;
        const audience = await activeUserIds(client);
        return createSyncEventsForUsers(client, {
          userIds: audience,
          eventType: "post.deleted",
          entityType: "post",
          entityId: req.params.id
        });
      });
      if (!syncEvents) return res.status(404).json({ error: "只能删除自己的帖子" });
      console.log(`post deleted id=${req.params.id} events=${syncEvents.length}`);
      notifySyncEvents(syncEvents);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/posts/:id/comments", requireAuth, async (req, res, next) => {
    try {
      const body = trimmedString(req.body.body);
      const replyToID = trimmedString(req.body.replyToID);
      if (!body) throw badRequest("评论不能为空");
      const post = await query("SELECT id, author_id FROM posts WHERE id = $1 AND status = 'active'", [req.params.id]);
      if (!post.rows[0]) throw badRequest("帖子不存在或不可评论");
      if (replyToID) {
        const reply = await query("SELECT id FROM comments WHERE id = $1 AND post_id = $2 AND status = 'active'", [replyToID, req.params.id]);
        if (!reply.rows[0]) throw badRequest("回复的评论不存在");
      }
      const commentId = `c-${randomUUID()}`;
      const moderation = await reviewSubmission({
        targetType: "comment",
        targetId: commentId,
        ownerId: req.user.id,
        text: body
      });
      const { comment, syncEvents } = await withTransaction(async (client) => {
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
        const audience = await syncAudienceForPublicContent(client, [req.user.id, post.rows[0].author_id], moderation.status === "active");
        const syncEvents = await createSyncEventsForUsers(client, {
          userIds: audience,
          eventType: "comment.created",
          entityType: "comment",
          entityId: commentId
        });
        return { comment: rows[0], syncEvents };
      });
      if (syncEvents.length) {
        console.log(`comment created id=${commentId} post=${req.params.id} status=${moderation.status} events=${syncEvents.length}`);
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
           RETURNING c.id, c.post_id`,
          [req.params.id, req.user.id]
        );
        if (!rows[0]) return null;
        const audience = await activeUserIds(client);
        return createSyncEventsForUsers(client, {
          userIds: audience,
          eventType: "comment.deleted",
          entityType: "comment",
          entityId: req.params.id
        });
      });
      if (!syncEvents) return res.status(404).json({ error: "只能删除自己的评论或自己帖子下的评论" });
      console.log(`comment deleted id=${req.params.id} events=${syncEvents.length}`);
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
        console.log(`post liked post=${req.params.id} user=${req.user.id} events=${syncEvents.length}`);
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
        console.log(`post unliked post=${req.params.id} user=${req.user.id} events=${syncEvents.length}`);
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
        console.log(`post favorited post=${req.params.id} user=${req.user.id} events=${syncEvents.length}`);
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
        console.log(`post unfavorited post=${req.params.id} user=${req.user.id} events=${syncEvents.length}`);
        notifySyncEvents(syncEvents);
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/users/:id/follow", requireAuth, async (req, res, next) => {
    try {
      const syncEvents = await setFollowState({ followerId: req.user.id, followingId: req.params.id, enabled: true });
      if (syncEvents.length) {
        console.log(`user followed follower=${req.user.id} following=${req.params.id} events=${syncEvents.length}`);
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
        console.log(`user unfollowed follower=${req.user.id} following=${req.params.id} events=${syncEvents.length}`);
        notifySyncEvents(syncEvents);
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/messages/threads/:id/messages", requireAuth, async (req, res, next) => {
    try {
      const threadId = trimmedString(req.params.id);
      const recipientUserID = trimmedString(req.body.recipientUserID);
      const relatedPostID = trimmedString(req.body.relatedPostID) || null;
      const body = trimmedString(req.body.body);
      const sharedPostID = trimmedString(req.body.sharedPostID) || null;
      const sharedProfileUserID = trimmedString(req.body.sharedProfileUserID) || null;
      const requestedMessageID = trimmedString(req.body.messageID);
      const messageId = requestedMessageID.startsWith("m-") ? requestedMessageID : `m-${randomUUID()}`;

      if (!threadId.startsWith("t-")) throw badRequest("会话无效");
      if (!body) throw badRequest("消息不能为空");
      if (!recipientUserID || recipientUserID === req.user.id) throw badRequest("收信人无效");

      const recipient = await query("SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL AND status = 'active'", [recipientUserID]);
      if (!recipient.rows[0]) throw badRequest("收信人不存在");

      if (relatedPostID) {
        const post = await query("SELECT id FROM posts WHERE id = $1 AND status <> 'deleted'", [relatedPostID]);
        if (!post.rows[0]) throw badRequest("关联帖子不存在");
      }

      const { thread, syncEvents } = await withTransaction(async (client) => {
        const existing = await client.query("SELECT * FROM message_threads WHERE id = $1 FOR UPDATE", [threadId]);
        if (existing.rows[0]) {
          const row = existing.rows[0];
          const currentIsParticipant = row.buyer_user_id === req.user.id || row.publisher_user_id === req.user.id;
          const recipientIsParticipant = row.buyer_user_id === recipientUserID || row.publisher_user_id === recipientUserID;
          if (!currentIsParticipant || !recipientIsParticipant) throw badRequest("不能向该会话发送消息");
        } else {
          await client.query(
            `INSERT INTO message_threads (id, buyer_user_id, publisher_user_id, related_post_id)
             VALUES ($1, $2, $3, $4)`,
            [threadId, req.user.id, recipientUserID, relatedPostID]
          );
        }

        const insertedMessage = await client.query(
          `INSERT INTO direct_messages (id, thread_id, sender_id, body, shared_post_id, shared_profile_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [messageId, threadId, req.user.id, body, sharedPostID, sharedProfileUserID]
        );
        let syncEvents = [];
        if (insertedMessage.rows[0]) {
          await client.query("UPDATE message_threads SET updated_at = now() WHERE id = $1", [threadId]);
          await client.query(
            `INSERT INTO message_thread_reads (thread_id, user_id, read_at)
             VALUES ($1, $2, now())
             ON CONFLICT (thread_id, user_id) DO UPDATE SET read_at = EXCLUDED.read_at`,
            [threadId, req.user.id]
          );
          syncEvents = await createThreadSyncEvents(client, {
            userIds: [req.user.id, recipientUserID],
            eventType: "message.created",
            entityType: "direct_message",
            entityId: messageId,
            threadId
          });
        }
        return {
          thread: await loadMessageThreadForUser(client, threadId, req.user.id),
          syncEvents
        };
      });

      if (syncEvents.length) {
        console.log(`message created thread=${threadId} message=${messageId} events=${syncEvents.length}`);
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
        const peerUserID = thread.buyer_user_id === req.user.id ? thread.publisher_user_id : thread.buyer_user_id;
        return createThreadSyncEvents(client, {
          userIds: [req.user.id, peerUserID],
          eventType: "message.read",
          entityType: "message_thread",
          entityId: threadId,
          threadId
        });
      });
      console.log(`read ack thread=${threadId} user=${req.user.id} events=${syncEvents.length}`);
      notifySyncEvents(syncEvents);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/reports", requireAuth, async (req, res, next) => {
    try {
      const targetType = req.body.targetType === "comment" ? "comment" : "post";
      const targetId = trimmedString(req.body.targetID);
      if (!targetId) throw badRequest("举报目标不能为空");
      const { rows } = await query(
        `INSERT INTO reports (id, target_type, target_id, reason, detail, reporter_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [`rp-${randomUUID()}`, targetType, targetId, trimmedString(req.body.reason, "用户举报"), trimmedString(req.body.detail), req.user.id]
      );
      res.status(201).json({ report: rows[0] });
    } catch (error) {
      next(error);
    }
  });

  router.get("/moderation/reviews", requireAuth, requireModerationAdmin, async (req, res, next) => {
    try {
      const status = trimmedString(req.query.status, "review");
      const params = [];
      let where = "";
      if (status !== "all") {
        params.push(status);
        where = "WHERE mr.status = $1";
      }
      const { rows } = await query(
        `SELECT mr.*
         FROM moderation_reviews mr
         ${where}
         ORDER BY mr.created_at DESC
         LIMIT 200`,
        params
      );
      res.json({ reviews: rows.map(moderationReviewToClient) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/moderation/reviews/:id/decision", requireAuth, requireModerationAdmin, async (req, res, next) => {
    try {
      const decision = moderationDecision(req.body.decision);
      const adminReason = trimmedString(req.body.reason);
      const review = await withTransaction(async (client) => {
        const selected = await client.query("SELECT * FROM moderation_reviews WHERE id = $1 FOR UPDATE", [req.params.id]);
        const row = selected.rows[0];
        if (!row) {
          const error = new Error("审核记录不存在");
          error.status = 404;
          throw error;
        }
        await applyModerationDecision(client, row, decision);
        const updated = await client.query(
          `UPDATE moderation_reviews
           SET status = $2, decision = $3, reason = COALESCE(NULLIF($4, ''), reason),
               handled_by = $5, handled_at = now(), updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [row.id, decision.reviewStatus, decision.decision, adminReason, req.user.id]
        );
        return updated.rows[0];
      });
      res.json({ review: moderationReviewToClient(review) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/uploads/presign", requireAuth, (req, res) => {
    const target = createUploadTarget({
      userId: req.user.id,
      kind: req.body.kind,
      filename: req.body.filename,
      contentType: req.body.contentType
    });
    res.json(target);
  });

  return router;
}

async function findActiveUserByEmail(email) {
  const { rows } = await query("SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL AND status = 'active'", [email]);
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
  const recent = await query(
    `SELECT id
     FROM email_verification_codes
     WHERE email = $1
       AND purpose = $2
       AND consumed_at IS NULL
       AND created_at > now() - ($3::text)::interval
     LIMIT 1`,
    [email, purpose, `${config.email.codeResendSeconds} seconds`]
  );
  if (recent.rows[0]) {
    throw badRequest("验证码发送太频繁，请稍后再试");
  }

  const id = `evc-${randomUUID()}`;
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const codeHash = hashEmailCode({ email, purpose, code });
  await query(
    `INSERT INTO email_verification_codes (id, email, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5::text)::interval)`,
    [id, email, purpose, codeHash, `${config.email.codeTtlMinutes} minutes`]
  );

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
       AND consumed_at IS NULL
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [email, purpose]
  );
  const record = rows[0];
  if (!record) {
    throw badRequest("验证码无效或已过期");
  }
  if (record.attempts >= 5) {
    throw badRequest("验证码错误次数过多，请重新获取");
  }
  const expectedHash = hashEmailCode({ email, purpose, code });
  if (record.code_hash !== expectedHash) {
    await client.query("UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = $1", [record.id]);
    throw badRequest("验证码无效或已过期");
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
    currentUser: userToClient(user),
    syncCursor,
    ...(await loadBootstrap(user.id))
  };
}

async function activeUserIds(client) {
  const { rows } = await client.query("SELECT id FROM users WHERE deleted_at IS NULL AND status = 'active'");
  return rows.map((row) => row.id);
}

async function syncAudienceForPublicContent(client, seedUserIds, shouldBroadcast) {
  if (shouldBroadcast) return activeUserIds(client);
  return uniqueIds(seedUserIds);
}

async function setPostReaction({ userId, postId, table, eventType, enabled }) {
  if (!["post_likes", "post_favorites"].includes(table)) {
    throw badRequest("互动类型无效");
  }
  return withTransaction(async (client) => {
    const post = await client.query("SELECT id FROM posts WHERE id = $1 AND status = 'active'", [postId]);
    if (!post.rows[0]) return [];

    const result = enabled
      ? await client.query(`INSERT INTO ${table} (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, postId])
      : await client.query(`DELETE FROM ${table} WHERE user_id = $1 AND post_id = $2`, [userId, postId]);
    if (!result.rowCount) return [];

    const audience = await activeUserIds(client);
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
    const target = await client.query("SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL AND status = 'active'", [followingId]);
    if (!target.rows[0]) return [];

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

function uniqueIds(values) {
  return [...new Set(values.filter(Boolean))];
}

async function createCollection(userId, body) {
  const name = trimmedString(body.name);
  if (!name) throw badRequest("请填写合集名称");
  const deadline = parseDate(body.deadline) || new Date(Date.now() + 7 * 86400 * 1000);
  const requestedId = trimmedString(body.id);
  const collectionId = requestedId.startsWith("col-") ? requestedId : `col-${randomUUID()}`;
  const snapshot = {
    name,
    wechat: trimmedString(body.wechat),
    qq: trimmedString(body.qq),
    groupInfo: trimmedString(body.groupInfo),
    defaultNote: trimmedString(body.defaultNote, "该合集内帖子共享联系方式、截团时间和默认说明。")
  };
  const moderation = await reviewSubmission({
    targetType: "collection",
    targetId: collectionId,
    ownerId: userId,
    text: publicContentModerationText(snapshot)
  });
  const { rows } = await query(
    `INSERT INTO group_collections (id, owner_id, name, contact_wechat, contact_qq, group_info, deadline, default_note, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      collectionId,
      userId,
      name,
      snapshot.wechat,
      snapshot.qq,
      snapshot.groupInfo,
      deadline,
      snapshot.defaultNote,
      moderation.status
    ]
  );
  if (moderation.status !== "active") {
    await createModerationReview(null, {
      targetType: "collection",
      targetId: collectionId,
      ownerId: userId,
      result: moderation,
      textSnapshot: publicContentModerationText(snapshot),
      snapshot
    });
  }
  return collectionToClient(rows[0], []);
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

function requireModerationAdmin(req, res, next) {
  if (!isModerationAdmin(req.user)) {
    return res.status(403).json({ error: "只有管理员可以访问审核后台" });
  }
  next();
}

function moderationDecision(value) {
  const decision = String(value || "").trim();
  switch (decision) {
  case "approve":
    return { decision, reviewStatus: "active", targetStatus: "active" };
  case "reject":
    return { decision, reviewStatus: "rejected", targetStatus: "rejected" };
  case "hide":
    return { decision, reviewStatus: "hidden", targetStatus: "hidden" };
  case "remove":
    return { decision, reviewStatus: "removed", targetStatus: "removed" };
  case "ignore":
    return { decision, reviewStatus: "ignored", targetStatus: null };
  default:
    throw badRequest("审核处理动作无效");
  }
}

async function applyModerationDecision(client, review, decision) {
  if (decision.decision === "ignore") return;
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
  if (decision.decision !== "approve") return;
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
        review.owner_id,
        snapshot.nickname,
        snapshot.bio,
        snapshot.redBookID,
        snapshot.gender,
        snapshot.birthday,
        snapshot.region,
        snapshot.avatarSymbol,
        snapshot.avatarTint,
        snapshot.backgroundImageName
      ]
    );
    return;
  }
  if (review.target_type === "avatar") {
    await client.query("UPDATE users SET avatar_object_key = $2, updated_at = now() WHERE id = $1", [review.owner_id, snapshot.avatarObjectKey || review.image_object_keys?.[0] || null]);
    return;
  }
  if (review.target_type === "profileBackground") {
    await client.query(
      "UPDATE users SET background_object_key = $2, background_image_name = COALESCE($3, background_image_name), updated_at = now() WHERE id = $1",
      [review.owner_id, snapshot.backgroundObjectKey || review.image_object_keys?.[0] || null, snapshot.backgroundImageName]
    );
  }
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
