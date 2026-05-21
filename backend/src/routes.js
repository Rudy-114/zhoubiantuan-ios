import { createHash, randomInt, randomUUID } from "node:crypto";
import express from "express";
import { hashPassword, requireAuth, signToken, verifyPassword } from "./auth.js";
import { loadBootstrap } from "./bootstrap.js";
import { config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { sendEmailCode } from "./email.js";
import { collectionToClient, commentToClient, postToClient, userToClient } from "./mappers.js";
import { createUploadTarget } from "./oss.js";
import { createRateLimiter } from "./rateLimit.js";
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

      const passwordHash = await hashPassword(password);
      const user = await withTransaction(async (client) => {
        const existing = await client.query("SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL AND status = 'active'", [email]);
        if (existing.rows[0]) throw badRequest("本邮箱已经注册过");
        await consumeEmailCode(client, { email, purpose: "register", code });
        return createEmailUser(client, { email, passwordHash, nickname, emailVerified: true });
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

      const passwordHash = await hashPassword(password);
      const user = await withTransaction(async (client) => {
        const existing = await client.query("SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL AND status = 'active'", [email]);
        if (existing.rows[0]) throw badRequest("本邮箱已经注册过");
        return createEmailUser(client, { email, passwordHash, nickname, emailVerified: false });
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
    res.json({ currentUser: userToClient(req.user), ...(await loadBootstrap(req.user.id)) });
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
      const { rows } = await query(
        `UPDATE users
         SET nickname = $2, bio = $3, red_book_id = $4, gender = $5, birthday = $6, region = $7,
             avatar_symbol = $8, avatar_tint = $9, background_image_name = $10,
             avatar_object_key = NULLIF($11, ''), background_object_key = NULLIF($12, ''), updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [req.user.id, nickname, bio, redBookID, gender, birthday, region, avatarSymbol, avatarTint, backgroundImageName, avatarObjectKey, backgroundObjectKey]
      );
      res.json({ user: userToClient(rows[0]) });
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
        FROM posts p WHERE p.id = $1 AND p.status <> 'deleted'`,
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
        ? (await query("SELECT * FROM group_collections WHERE id = $1 AND owner_id = $2", [collectionId, req.user.id])).rows[0]
        : null;
      const deadline = collection?.deadline || parseDate(req.body.deadline) || new Date(Date.now() + 7 * 86400 * 1000);
      const requestedId = trimmedString(req.body.id);
      const postId = requestedId.startsWith("p-") ? requestedId : `p-${randomUUID()}`;
      const { rows } = await query(
        `INSERT INTO posts (
          id, author_id, collection_id, title, image_names, image_object_keys, group_type,
          category_tags, fandom_tags, price, deposit, deadline, condition, is_formed, description,
          wechat, qq, group_info, external_link, image_aspect, pinggu_average_price, pinggu_note, unsold_roles
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, $23
        ) RETURNING *`,
        [
          postId,
          req.user.id,
          collection?.id || null,
          title,
          arrayOfStrings(req.body.imageNames),
          arrayOfStrings(req.body.imageObjectKeys),
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
          Number(req.body.imageAspect || 1.08),
          trimmedString(req.body.pingguAveragePrice),
          trimmedString(req.body.pingguNote),
          JSON.stringify(Array.isArray(req.body.unsoldRoles) ? req.body.unsoldRoles : [])
        ]
      );
      res.status(201).json({ post: postToClient(rows[0]) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/posts/:id", requireAuth, async (req, res) => {
    const { rows } = await query("UPDATE posts SET status = 'deleted', updated_at = now() WHERE id = $1 AND author_id = $2 RETURNING id", [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: "只能删除自己的帖子" });
    res.status(204).end();
  });

  router.post("/posts/:id/comments", requireAuth, async (req, res, next) => {
    try {
      const body = trimmedString(req.body.body);
      const replyToID = trimmedString(req.body.replyToID);
      if (!body) throw badRequest("评论不能为空");
      if (replyToID) {
        const reply = await query("SELECT id FROM comments WHERE id = $1 AND post_id = $2 AND status = 'active'", [replyToID, req.params.id]);
        if (!reply.rows[0]) throw badRequest("回复的评论不存在");
      }
      const { rows } = await query(
        "INSERT INTO comments (id, post_id, author_id, body, reply_to_id) VALUES ($1, $2, $3, $4, NULLIF($5, '')) RETURNING *",
        [`c-${randomUUID()}`, req.params.id, req.user.id, body, replyToID]
      );
      res.status(201).json({ comment: commentToClient(rows[0]) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/comments/:id", requireAuth, async (req, res) => {
    const { rows } = await query(
      `UPDATE comments c
       SET status = 'deleted'
       FROM posts p
       WHERE c.id = $1
         AND c.post_id = p.id
         AND c.status = 'active'
         AND (c.author_id = $2 OR p.author_id = $2)
       RETURNING c.id`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "只能删除自己的评论或自己帖子下的评论" });
    res.status(204).end();
  });

  router.post("/posts/:id/like", requireAuth, async (req, res) => {
    await query("INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.user.id, req.params.id]);
    res.status(204).end();
  });

  router.delete("/posts/:id/like", requireAuth, async (req, res) => {
    await query("DELETE FROM post_likes WHERE user_id = $1 AND post_id = $2", [req.user.id, req.params.id]);
    res.status(204).end();
  });

  router.post("/posts/:id/favorite", requireAuth, async (req, res) => {
    await query("INSERT INTO post_favorites (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.user.id, req.params.id]);
    res.status(204).end();
  });

  router.delete("/posts/:id/favorite", requireAuth, async (req, res) => {
    await query("DELETE FROM post_favorites WHERE user_id = $1 AND post_id = $2", [req.user.id, req.params.id]);
    res.status(204).end();
  });

  router.post("/users/:id/follow", requireAuth, async (req, res) => {
    await query("INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.user.id, req.params.id]);
    res.status(204).end();
  });

  router.delete("/users/:id/follow", requireAuth, async (req, res) => {
    await query("DELETE FROM follows WHERE follower_id = $1 AND following_id = $2", [req.user.id, req.params.id]);
    res.status(204).end();
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
  return {
    token: signToken(user),
    currentUser: userToClient(user),
    ...(await loadBootstrap(user.id))
  };
}

async function createCollection(userId, body) {
  const name = trimmedString(body.name);
  if (!name) throw badRequest("请填写合集名称");
  const deadline = parseDate(body.deadline) || new Date(Date.now() + 7 * 86400 * 1000);
  const requestedId = trimmedString(body.id);
  const collectionId = requestedId.startsWith("col-") ? requestedId : `col-${randomUUID()}`;
  const { rows } = await query(
    `INSERT INTO group_collections (id, owner_id, name, contact_wechat, contact_qq, group_info, deadline, default_note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      collectionId,
      userId,
      name,
      trimmedString(body.wechat),
      trimmedString(body.qq),
      trimmedString(body.groupInfo),
      deadline,
      trimmedString(body.defaultNote, "该合集内帖子共享联系方式、截团时间和默认说明。")
    ]
  );
  return collectionToClient(rows[0], []);
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
