import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { query } from './db.js';
const signature = value => createHmac('sha256', config.jwtSecret).update('asset-capability-v1\0' + value).digest('base64url');
export function assetCapability(key, userId) {
  const claim = Math.floor(Date.now()/1000 + 300) + '.' + Buffer.from(userId).toString('base64url');
  return claim + '.' + signature(key + '\0' + claim);
}
export async function assetCapabilityReader(key, value) {
  if (typeof value !== 'string' || value.length > 400) return null;
  const parts=value.split('.');
  if(parts.length!==3 || !/^\d{10}$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  const expiry=Number(parts[0]),now=Date.now()/1000;
  if(expiry<now || expiry>now+301) return null;
  const expected=Buffer.from(signature(key+'\0'+parts.slice(0,2).join('.'))),actual=Buffer.from(parts[2]);
  if(expected.length!==actual.length || !timingSafeEqual(expected,actual)) return null;
  const id=Buffer.from(parts[1],'base64url').toString();
  return (await query("SELECT * FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL",[id])).rows[0] || null;
}
