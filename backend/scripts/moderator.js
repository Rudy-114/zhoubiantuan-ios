import { pool, withTransaction } from '../src/db.js';

const [action, userId] = process.argv.slice(2);
if (!['grant', 'revoke'].includes(action) || !userId) {
  console.error('Usage: node scripts/moderator.js grant|revoke USER_ID');
  process.exitCode = 1;
} else {
  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT u.id FROM users u WHERE u.id = $1
        AND u.status = 'active' AND u.deleted_at IS NULL
        AND ($2 = 'revoke' OR EXISTS (SELECT 1 FROM auth_identities i
          WHERE i.user_id = u.id AND i.provider = 'email' AND i.email = u.email AND i.email_verified))
        FOR UPDATE`, [userId, action]);
      if (!rows.length) throw new Error('Account must exist and have a verified email before receiving a moderator role.');
      await client.query('UPDATE users SET moderation_role = $2, updated_at = now() WHERE id = $1',
        [userId, action === 'grant' ? 'moderator' : 'user']);
    });
    console.log(`Moderator role ${action === 'grant' ? 'granted' : 'revoked'} for ${userId}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
await pool.end();
