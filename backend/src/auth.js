import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { query } from "./db.js";

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn
  });
}

export async function userForToken(token) {
  if (!token) return null;
  const payload = jwt.verify(token, config.jwtSecret);
  const { rows } = await query("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL AND status = 'active'", [payload.sub]);
  return rows[0] || null;
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [, token] = header.match(/^Bearer\s+(.+)$/i) || [];
    if (!token) {
      return res.status(401).json({ error: "需要登录" });
    }
    const user = await userForToken(token);
    if (!user) {
      return res.status(401).json({ error: "登录已失效" });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "登录已失效" });
  }
}

export function requireUnrestrictedUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "需要登录" });
  if (req.user.is_restricted) {
    return res.status(403).json({ error: "账号当前无法执行此操作", code: "user_restricted" });
  }
  return next();
}

export async function assertUnrestrictedUser(client, userId) {
  const { rows } = await client.query(
    `SELECT id, is_restricted
     FROM users
     WHERE id = $1 AND deleted_at IS NULL AND status = 'active'
     FOR UPDATE`,
    [userId]
  );
  if (!rows[0]) throw authError(401, "登录已失效");
  if (rows[0].is_restricted) {
    throw authError(403, "账号当前无法执行此操作", "user_restricted");
  }
  return rows[0];
}

function authError(status, message, apiCode) {
  const error = new Error(message);
  error.status = status;
  if (apiCode) error.apiCode = apiCode;
  return error;
}
