import { createHash } from "node:crypto";
import { pool, query, withTransaction } from "../src/db.js";
import { config } from "../src/config.js";
import { hashPassword } from "../src/auth.js";

const DEFAULT_COUNT = 100;
const MAX_COUNT = 200;
const BATCH_PREFIX = "p-batch";
const TEST_PASSWORD = "123456";

const imageNames = [
  "merch_photocards",
  "merch_badges",
  "merch_standees",
  "merch_plush",
  "merch_album",
  "merch_jewelry",
  "merch_concert",
  "merch_magazine"
];

const titleTemplates = [
  "冬兵生日团吧唧拼谷｜余量更新",
  "巡演限定小卡套组｜二开收集",
  "亚克力立牌角色位｜可混款",
  "棉花娃衣和挂件｜新款自印团",
  "黑胶专辑明信片套组｜补款提醒",
  "星心主题饰品｜现货拼团",
  "演唱会周边礼包｜开团登记",
  "杂志切页和卡册｜少量补货"
];

const categoryTags = [
  ["吧唧", "拼谷"],
  ["小卡", "预售"],
  ["立牌", "拼谷"],
  ["娃衣", "自印团"],
  ["专辑", "补款"],
  ["饰品", "现货"],
  ["周边", "预售"],
  ["杂志", "自印团"]
];

const fandomTags = [
  ["Bucky Barnes", "Steve Rogers"],
  ["欧美巡演", "收藏卡"],
  ["Marvel", "角色周边"],
  ["棉花娃", "娃衣"],
  ["黑胶", "欧美音乐"],
  ["原创饰品", "痛包"],
  ["演唱会", "应援"],
  ["杂志", "卡册"]
];

function parseArgs(argv) {
  const args = { count: DEFAULT_COUNT, prefix: BATCH_PREFIX };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--count") args.count = Number(argv[++index]);
    else if (value === "--prefix") args.prefix = String(argv[++index] || "");
    else if (value === "--help" || value === "-h") args.help = true;
    else throw new Error(`未知参数：${value}`);
  }
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > MAX_COUNT) {
    throw new Error(`--count 必须是 1-${MAX_COUNT} 的整数`);
  }
  if (!/^p-[A-Za-z0-9_-]{1,40}$/.test(args.prefix)) {
    throw new Error("--prefix 必须以 p- 开头，只能包含字母、数字、下划线和短横线");
  }
  return args;
}

function printHelp() {
  console.log(`用法：npm --prefix backend run seed:batch -- [--count 100] [--prefix p-batch]\n\n` +
    "只允许写入回环地址上的开发/测试数据库；默认使用固定 ID 幂等生成 active 帖子。\n" +
    `测试账号密码：${TEST_PASSWORD}（仅本地演示环境）`);
}

function databaseHost() {
  if (config.db.host) return config.db.host;
  if (!config.databaseUrl) return "";
  try {
    return new URL(config.databaseUrl).hostname;
  } catch {
    return "";
  }
}

function assertSafeTarget() {
  if (config.nodeEnv === "production") {
    throw new Error("拒绝在 NODE_ENV=production 环境运行批量测试数据脚本");
  }
  const host = databaseHost();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`拒绝写入非本机数据库（当前主机：${host || "未知"}）。请为本地 PostgreSQL 设置 ENV_FILE/DATABASE_URL`);
  }
}

async function assertSchemaReady() {
  const result = await query("SELECT to_regclass('public.posts') AS posts, to_regclass('public.group_collections') AS collections");
  if (!result.rows[0]?.posts || !result.rows[0]?.collections) {
    throw new Error("数据库尚未完成迁移，请先运行 npm --prefix backend run migrate");
  }
}

function userRecord(id, index, passwordHash) {
  return [
    id,
    `${id}@example.test`,
    passwordHash,
    index === 0 ? "潘潘潘（测试）" : `测试团长 ${String(index).padStart(2, "0")}`,
    "仅用于本地 Feed 刷帖演示，不代表真实团购信息。",
    index === 0 ? "潘" : String(index),
    ["amber", "rose", "violet", "blue"][index % 4],
    `batch-demo-${String(index).padStart(2, "0")}`,
    ["北京", "上海", "广州", "杭州", "成都"][index % 5]
  ];
}

function collectionRecord(id, ownerId, index, deadline) {
  return [
    id,
    ownerId,
    `测试合集 ${String(index).padStart(2, "0")}`,
    `batch-demo-${String(index).padStart(2, "0")}`,
    "638441116",
    "638441116",
    "本合集仅供本地刷帖演示",
    deadline,
    "测试数据无需联系团长"
  ];
}

function postRecord({ index, count, prefix, authorId, collectionId, now }) {
  const slot = index % titleTemplates.length;
  const serial = String(index + 1).padStart(3, "0");
  const title = `[测试 ${serial}/${String(count).padStart(3, "0")}] ${titleTemplates[slot]}`;
  const firstImage = imageNames[(index * 3) % imageNames.length];
  const secondImage = imageNames[(index * 3 + 1) % imageNames.length];
  const thirdImage = index % 3 === 0 ? imageNames[(index * 3 + 2) % imageNames.length] : null;
  const images = [...new Set([firstImage, secondImage, thirdImage].filter(Boolean))];
  const deadline = new Date(now.getTime() + (7 + (index % 21)) * 86400000);
  const createdAt = new Date(now.getTime() - index * 3 * 60000);
  const isSplitGoods = index % 2 === 0;
  const tags = categoryTags[slot];
  const fandom = fandomTags[slot];
  const price = isSplitGoods ? `¥${35 + (index % 6) * 8}/件` : `¥${49 + (index % 8) * 10}/套`;
  const deposit = index % 3 === 0 ? "全款" : `¥${10 + (index % 4) * 5} 定金`;
  const digest = createHash("sha256").update(`${prefix}:${serial}`).digest("hex");
  return {
    id: `${prefix}-${serial}`,
    authorId,
    collectionId,
    title,
    images,
    groupType: isSplitGoods ? "splitGoods" : "followGroup",
    tags,
    fandom,
    price,
    deposit,
    deadline,
    createdAt,
    digest,
    aspect: 0.78 + ((index * 13) % 61) / 100,
    description: `${title}。这是用于测试信息流、图片比例、评论和离线预加载的本地演示内容。图片、价格和余量均为虚构数据。`,
    condition: index % 2 === 0 ? "满 30 件成团，余量实时更新" : "满 50 套成团，未成团原路退定",
    groupInfo: "本地演示数据，无需联系团长",
    pingguAveragePrice: isSplitGoods ? `均价 ${price.replace("/件", "")}/件` : "",
    pingguNote: isSplitGoods ? "演示角色位仍可认领" : "",
    unsoldRoles: isSplitGoods ? [{ id: `${digest.slice(0, 8)}-role-a`, name: "Bucky Barnes", quantity: 2 + (index % 4) }] : []
  };
}

async function seedBatch({ count, prefix }) {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const now = new Date();
  const authorCount = 5;
  const authors = Array.from({ length: authorCount }, (_, index) => `u-batch-${index + 1}`);
  const collections = authors.map((authorId, index) => `col-batch-${index + 1}`);
  const deadline = new Date(now.getTime() + 30 * 86400000);

  await withTransaction(async (client) => {
    // Keep the login account available even when this script is run against a
    // fresh local database without the larger demo seed.
    const demoUser = userRecord("u-me", 0, passwordHash);
    await client.query(
      `INSERT INTO users (id, email, password_hash, nickname, bio, avatar_symbol, avatar_tint, red_book_id, region)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET password_hash=COALESCE(users.password_hash, EXCLUDED.password_hash),
         status='active', deleted_at=NULL`,
      demoUser
    );
    for (let index = 0; index < authors.length; index += 1) {
      const user = userRecord(authors[index], index + 1, passwordHash);
      await client.query(
        `INSERT INTO users (id, email, password_hash, nickname, bio, avatar_symbol, avatar_tint, red_book_id, region)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, password_hash=EXCLUDED.password_hash,
           nickname=EXCLUDED.nickname, bio=EXCLUDED.bio, avatar_symbol=EXCLUDED.avatar_symbol,
           avatar_tint=EXCLUDED.avatar_tint, red_book_id=EXCLUDED.red_book_id, region=EXCLUDED.region,
           status='active', deleted_at=NULL`,
        user
      );
      await client.query(
        `INSERT INTO group_collections (id, owner_id, name, contact_wechat, contact_qq, contact_group_number, group_info, deadline, default_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET owner_id=EXCLUDED.owner_id, name=EXCLUDED.name,
           contact_wechat=EXCLUDED.contact_wechat, contact_qq=EXCLUDED.contact_qq,
           contact_group_number=EXCLUDED.contact_group_number, group_info=EXCLUDED.group_info,
           deadline=EXCLUDED.deadline, default_note=EXCLUDED.default_note, status='active'`,
        collectionRecord(collections[index], authors[index], index + 1, deadline)
      );
    }

    // The default local demo account follows every generated author, so both
    // personalized and Following feeds are populated after logging in as u-me.
    for (const authorId of authors) {
      await client.query("INSERT INTO follows (follower_id, following_id) VALUES ('u-me',$1) ON CONFLICT DO NOTHING", [authorId]);
    }

    for (let index = 0; index < count; index += 1) {
      const post = postRecord({
        index,
        count,
        prefix,
        authorId: authors[index % authors.length],
        collectionId: collections[index % collections.length],
        now
      });
      await client.query(
        `INSERT INTO posts (
          id, author_id, collection_id, title, image_names, group_type, category_tags, fandom_tags,
          price, deposit, deadline, condition, is_formed, description, wechat, qq, group_number,
          group_info, external_link, status, image_aspect, pinggu_average_price, pinggu_note,
          unsold_roles, created_at, updated_at, submission_hash
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,'','','',$14,'','active',$15,$16,$17,$18,$19,now(),$20)
        ON CONFLICT (id) DO UPDATE SET
          author_id=EXCLUDED.author_id, collection_id=EXCLUDED.collection_id, title=EXCLUDED.title,
          image_names=EXCLUDED.image_names, group_type=EXCLUDED.group_type, category_tags=EXCLUDED.category_tags,
          fandom_tags=EXCLUDED.fandom_tags, price=EXCLUDED.price, deposit=EXCLUDED.deposit,
          deadline=EXCLUDED.deadline, condition=EXCLUDED.condition, is_formed=EXCLUDED.is_formed,
          description=EXCLUDED.description, group_info=EXCLUDED.group_info, status='active',
          image_aspect=EXCLUDED.image_aspect, pinggu_average_price=EXCLUDED.pinggu_average_price,
          pinggu_note=EXCLUDED.pinggu_note, unsold_roles=EXCLUDED.unsold_roles,
          created_at=EXCLUDED.created_at, updated_at=now(), submission_hash=EXCLUDED.submission_hash`,
        [
          post.id,
          post.authorId,
          post.collectionId,
          post.title,
          post.images,
          post.groupType,
          post.tags,
          post.fandom,
          post.price,
          post.deposit,
          post.deadline,
          post.condition,
          post.description,
          post.groupInfo,
          post.aspect,
          post.pingguAveragePrice,
          post.pingguNote,
          JSON.stringify(post.unsoldRoles),
          post.createdAt,
          post.digest
        ]
      );
      const commentId = `c-${prefix.slice(2)}-${String(index + 1).padStart(3, "0")}`;
      await client.query(
        `INSERT INTO comments (id, post_id, author_id, body, created_at)
         VALUES ($1,$2,'u-me',$3,$4)
         ON CONFLICT (id) DO UPDATE SET body=EXCLUDED.body`,
        [commentId, post.id, index % 2 === 0 ? "想看实物图，先收藏啦。" : "已看到余量更新，感谢团长整理。", post.createdAt]
      );
    }
  });
  return { count, prefix, authors, collections };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  await pool.end();
} else {
  try {
    assertSafeTarget();
    await assertSchemaReady();
    const result = await seedBatch(args);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } finally {
    await pool.end();
  }
}
