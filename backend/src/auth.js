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
  const { rows } = await query(`SELECT u.*, EXISTS (
    SELECT 1 FROM auth_identities i WHERE i.user_id = u.id AND i.provider = 'email'
      AND i.email = u.email AND i.email_verified
  ) AS email_verified FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL AND u.status = 'active'`, [payload.sub]);
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
  } catch (error) {
    if (["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(error.name)) {
      return res.status(401).json({ error: "登录已失效" });
    }
    next(error);
  }
}
