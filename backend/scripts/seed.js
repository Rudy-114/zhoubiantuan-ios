import { isIP } from "node:net";
if (process.env.NODE_ENV === "production") throw new Error("Refusing demo seed in production");
const { pool, query, withTransaction } = await import("../src/db.js");
const { hashPassword } = await import("../src/auth.js");
const { captureSourceEvidence } = await import("../src/safety/evidenceService.js");

const now = new Date();
const date = (days, hour) => {
  const value = new Date(now);
  value.setDate(value.getDate() + days);
  value.setHours(hour, 0, 0, 0);
  return value;
};

const users = [
  ["u-me", "panpan@example.com", "潘潘潘", "点击这里，填写简介", "潘", "amber", "63844111650", "北京", "merch_magazine", "+861391237122"],
  ["u-black", "blackbagel@example.com", "黑贝果", "原创设计小众饰品，开团前都会补细节说明。", "黑", "rose", "BlackBagel2026", "上海", "merch_jewelry", ""],
  ["u-moon", "moonpin@example.com", "月光补货站", "演唱会周边、立牌、吧唧团购整理。", "月", "violet", "MoonPin0909", "广州", "merch_badges", ""],
  ["u-berry", "berrydoll@example.com", "莓果小铺", "娃娃衣和棉花娃配件长期团。", "莓", "amber", "BerryDollClub", "杭州", "merch_plush", ""],
  ["u-echo", "echogb@example.com", "Echo周边记录", "专辑、杂志、明信片成团信息搬运。", "E", "blue", "EchoGB2026", "成都", "merch_album", ""]
];

const collections = [
  ["col-my-winter", "u-me", "2026冬兵生日团", "PanPanGroup", "638441116", "638441116", "备注：冬兵生日团", date(4, 22), "同一拼谷团内的宣传、进度、角色余量更新共用联系方式和截团时间。"],
  ["col-winter-bucky", "u-moon", "2026冬兵生日团", "MoonPin0909", "190443821", "", "微信群复制微信后拉群，备注：冬兵生日团", date(3, 23), "同一生日团内宣传、进度和余量更新共用联系方式与截团时间。"],
  ["col-tour-cards", "u-echo", "巡演补款小卡团", "EchoGB2026", "82190477", "743219008", "答案：小卡", date(1, 22), "巡演相关制品统一在原群登记，补款、余量和到货更新都会归入这个合集。"],
  ["col-berry-doll", "u-berry", "棉花娃衣配件团", "BerryDollClub", "448102930", "518221974", "备注娃娃尺寸", date(6, 20), "棉花娃娃衣、痛包配件和收纳周边统一更新余量与截团时间。"],
  ["col-black-jewelry", "u-black", "星心饰品拼谷团", "BlackBagel2026", "60092118", "", "微信群，复制微信备注：星心", date(4, 22), "小众饰品和孤品拼谷信息统一放在这里，余量按帖子更新。"],
  ["col-moon-magazine", "u-moon", "杂志切页自印团", "MoonPin0909", "190443821", "204118776", "备注：切页自印", date(2, 18), "杂志切页、卡册和相关自印内容统一登记，进度与补款后续在合集内更新。"]
];

const posts = [
  {
    id: "p-card",
    title: "巡演限定小卡套组二开，余量 30 份",
    imageNames: ["merch_photocards", "merch_magazine"],
    authorID: "u-echo",
    collectionID: "col-tour-cards",
    categoryTags: ["小卡", "预售", "自印团"],
    fandomTags: ["欧美巡演", "收藏卡"],
    price: "¥42/套",
    deposit: "¥15 定金",
    deadline: date(1, 22),
    condition: "满 60 套开团，未成团原路退定",
    isFormed: true,
    description: "这次是巡演风格小卡套组二开，含 6 张卡 + 硬质保护套。图片为打样效果，实物会有轻微色差。适合自留和交换，不拆卖。",
    wechat: "EchoGB2026",
    qq: "82190477",
    groupNumber: "743219008",
    groupInfo: "答案：小卡",
    externalLink: "https://forms.example/cards",
    createdAt: new Date(now.getTime() - 7200 * 1000),
    imageAspect: 1.12
  },
  {
    id: "p-badge",
    title: "2026冬兵生日团吧唧拼谷，今晚截团",
    imageNames: ["merch_badges", "merch_jewelry"],
    authorID: "u-moon",
    groupType: "splitGoods",
    collectionID: "col-winter-bucky",
    categoryTags: ["吧唧", "现货", "拼谷"],
    fandomTags: ["Steve Rogers", "Bucky Barnes"],
    price: "¥35/吧唧",
    deposit: "全款",
    deadline: date(0, 23),
    condition: "主角团角色位优先成团，余量实时更新",
    isFormed: true,
    description: "星芒主题金属吧唧，黑粉双色电镀，适合痛包和陈列。库存不多，截团后不追加。",
    wechat: "MoonPin0909",
    qq: "190443821",
    groupNumber: "",
    groupInfo: "微信群复制微信后拉群",
    createdAt: new Date(now.getTime() - 18000 * 1000),
    imageAspect: 0.86,
    pingguAveragePrice: "均价35元/吧唧",
    pingguNote: "目前还缺主角团角色位",
    unsoldRoles: [{ id: "role-steve", name: "Steve Rogers", quantity: 2 }, { id: "role-bucky", name: "Bucky Barnes", quantity: 3 }, { id: "role-tony", name: "Tony Stark", quantity: 5 }]
  },
  {
    id: "p-stand",
    title: "2026冬兵生日团亚克力立牌角色位",
    imageNames: ["merch_standees", "merch_album"],
    authorID: "u-moon",
    groupType: "splitGoods",
    collectionID: "col-winter-bucky",
    categoryTags: ["立牌", "预售", "拼谷"],
    fandomTags: ["Bucky Barnes", "Sam Wilson"],
    price: "¥68/立牌",
    deposit: "¥20 定金",
    deadline: date(3, 20),
    condition: "满 120 套开模，角色位未满可继续认领",
    isFormed: true,
    description: "亚克力立牌含底座，舞台灯光主题。已完成第一次打样，边缘透粉光，适合桌面陈列。",
    wechat: "MoonPin0909",
    qq: "190443821",
    groupNumber: "",
    groupInfo: "微信群复制微信后拉群",
    externalLink: "https://forms.example/standee",
    createdAt: new Date(now.getTime() - 72000 * 1000),
    imageAspect: 1.24,
    pingguAveragePrice: "均价68元/立牌",
    pingguNote: "Bucky 和 Sam 位还可拼",
    unsoldRoles: [{ id: "role-bucky-stand", name: "Bucky Barnes", quantity: 2 }, { id: "role-sam", name: "Sam Wilson", quantity: 1 }, { id: "role-natasha", name: "Natasha Romanoff", quantity: 2 }]
  },
  {
    id: "p-plush",
    title: "棉花娃睡衣和小配件自印团，粉色猫耳款",
    imageNames: ["merch_plush", "merch_concert"],
    authorID: "u-berry",
    collectionID: "col-berry-doll",
    categoryTags: ["娃娃", "饰品", "自印团"],
    fandomTags: ["棉花娃", "娃衣"],
    price: "¥35 起",
    deposit: "¥10 定金",
    deadline: date(5, 21),
    condition: "满 50 件成团，可混款",
    description: "包含猫耳睡衣、迷你挂件、拍照小垫子。10cm/15cm 娃可选，备注尺寸。",
    wechat: "BerryDollClub",
    qq: "448102930",
    groupNumber: "518221974",
    groupInfo: "备注娃娃尺寸",
    createdAt: new Date(now.getTime() - 28800 * 1000),
    imageAspect: 1.06
  },
  {
    id: "p-album",
    title: "巡演黑胶专辑 + 明信片补款提醒，明晚截止",
    imageNames: ["merch_album", "merch_photocards"],
    authorID: "u-echo",
    collectionID: "col-tour-cards",
    categoryTags: ["专辑", "明信片", "补款"],
    fandomTags: ["黑胶", "欧美音乐"],
    price: "¥118/套",
    deposit: "已收 ¥30",
    deadline: date(1, 20),
    condition: "已成团，补款后统一打包",
    isFormed: true,
    description: "黑胶专辑加 8 张明信片，当前进入补款阶段。请收藏过本团的宝子留意截团提醒。",
    wechat: "EchoGB2026",
    qq: "82190477",
    groupNumber: "743219008",
    groupInfo: "原补款群内公告",
    externalLink: "https://forms.example/album",
    createdAt: new Date(now.getTime() - 108000 * 1000),
    imageAspect: 0.98
  },
  {
    id: "p-my-pinggu",
    title: "2026冬兵生日团角色余量更新",
    imageNames: ["merch_badges", "merch_standees"],
    authorID: "u-me",
    groupType: "splitGoods",
    collectionID: "col-my-winter",
    categoryTags: ["吧唧", "立牌", "拼谷"],
    fandomTags: ["Steve Rogers", "Bucky Barnes", "Tony Stark"],
    price: "¥35-68",
    deposit: "全款/定金",
    deadline: date(4, 22),
    condition: "角色位有余量即可认领，售罄后从列表隐藏",
    isFormed: true,
    description: "这里是团长本人可维护的拼谷演示帖，可以在详情页实时编辑未售角色和数量。",
    wechat: "PanPanGroup",
    qq: "638441116",
    groupNumber: "638441116",
    groupInfo: "备注：冬兵生日团",
    createdAt: new Date(now.getTime() - 1800 * 1000),
    imageAspect: 1.04,
    pingguAveragePrice: "均价35元/吧唧",
    pingguNote: "目前还缺主角团角色位",
    unsoldRoles: [{ id: "role-my-steve", name: "Steve Rogers", quantity: 2 }, { id: "role-my-bucky", name: "Bucky Barnes", quantity: 3 }, { id: "role-my-tony", name: "Tony Stark", quantity: 5 }]
  }
];

const demoReport = {
  id: "rp-1",
  caseID: "sc-demo-invalid-contact",
  evidenceID: "se-demo-rp-1",
  clientRequestID: "seed-demo-rp-1",
  reporterID: "u-me",
  sourceType: "post",
  sourceID: "p-badge",
  subjectType: "collection",
  subjectID: "col-winter-bucky",
  impactScope: "collection",
  reasonCode: "invalid_contact",
  reportedField: "contact_wechat",
  reason: "无效联系方式",
  detail: "用户反馈微信搜索不到，需团长确认。"
};

try {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() === "production") {
    throw new Error("Refusing to seed a production database");
  }
  if (String(process.env.ALLOW_DEMO_SEED || "").trim().toLowerCase() !== "true") {
    throw new Error("Refusing to seed without ALLOW_DEMO_SEED=true");
  }
  assertConfiguredLocalDatabase();
  await assertConnectedLocalDatabase();
  const passwordHash = await hashPassword("123456");
  await withTransaction(async (client) => {
    for (const user of users) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, nickname, bio, avatar_symbol, avatar_tint, red_book_id, region, background_image_name, phone_number)
         VALUES ($1, $2, $11, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash),
           nickname = EXCLUDED.nickname,
           bio = EXCLUDED.bio,
           avatar_symbol = EXCLUDED.avatar_symbol,
           avatar_tint = EXCLUDED.avatar_tint,
           red_book_id = EXCLUDED.red_book_id,
           region = EXCLUDED.region,
           background_image_name = EXCLUDED.background_image_name,
           phone_number = EXCLUDED.phone_number`,
        [...user, passwordHash]
      );
    }

    for (const collection of collections) {
      await client.query(
        `INSERT INTO group_collections (id, owner_id, name, contact_wechat, contact_qq, contact_group_number, group_info, deadline, default_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           contact_wechat = EXCLUDED.contact_wechat,
           contact_qq = EXCLUDED.contact_qq,
           contact_group_number = EXCLUDED.contact_group_number,
           group_info = EXCLUDED.group_info,
           deadline = EXCLUDED.deadline,
           default_note = EXCLUDED.default_note`,
        collection
      );
    }

    for (const post of posts) {
      await client.query(
        `INSERT INTO posts (
          id, author_id, collection_id, title, image_names, group_type, category_tags, fandom_tags,
          price, deposit, deadline, condition, is_formed, description, wechat, qq, group_number, group_info,
          external_link, created_at, image_aspect, pinggu_average_price, pinggu_note, unsold_roles
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          image_names = EXCLUDED.image_names,
          group_type = EXCLUDED.group_type,
          category_tags = EXCLUDED.category_tags,
          fandom_tags = EXCLUDED.fandom_tags,
          price = EXCLUDED.price,
          deposit = EXCLUDED.deposit,
          deadline = EXCLUDED.deadline,
          condition = EXCLUDED.condition,
          is_formed = EXCLUDED.is_formed,
          description = EXCLUDED.description,
          wechat = EXCLUDED.wechat,
          qq = EXCLUDED.qq,
          group_number = EXCLUDED.group_number,
          group_info = EXCLUDED.group_info,
          external_link = EXCLUDED.external_link,
          image_aspect = EXCLUDED.image_aspect,
          pinggu_average_price = EXCLUDED.pinggu_average_price,
          pinggu_note = EXCLUDED.pinggu_note,
          unsold_roles = EXCLUDED.unsold_roles`,
        [
          post.id,
          post.authorID,
          post.collectionID,
          post.title,
          post.imageNames,
          post.groupType || "followGroup",
          post.categoryTags || [],
          post.fandomTags || [],
          post.price,
          post.deposit,
          post.deadline,
          post.condition,
          Boolean(post.isFormed),
          post.description,
          post.wechat,
          post.qq,
          post.groupNumber || "",
          post.groupInfo,
          post.externalLink || "",
          post.createdAt,
          post.imageAspect || 1.08,
          post.pingguAveragePrice || "",
          post.pingguNote || "",
          JSON.stringify(post.unsoldRoles || [])
        ]
      );
    }

    const comments = [
      ["c-1", "p-card", "u-me", "还能上车吗？想要两套小卡。", new Date(now.getTime() - 1400 * 1000)],
      ["c-2", "p-card", "u-echo", "可以，表单里备注昵称就行，今晚统一拉群。", new Date(now.getTime() - 1100 * 1000)],
      ["c-3", "p-stand", "u-berry", "立牌会有单人拆卖吗？", new Date(now.getTime() - 2800 * 1000)],
      ["c-4", "p-album", "u-me", "蹲补款提醒，怕错过。", new Date(now.getTime() - 5200 * 1000)]
    ];
    for (const comment of comments) {
      await client.query(
        `INSERT INTO comments (id, post_id, author_id, body, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body`,
        comment
      );
    }

    for (const [userId, postId] of [["u-me", "p-card"], ["u-me", "p-plush"]]) {
      await client.query("INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, postId]);
    }
    for (const [userId, postId] of [["u-me", "p-card"], ["u-me", "p-album"]]) {
      await client.query("INSERT INTO post_favorites (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, postId]);
    }
    for (const [followerId, followingId] of [["u-me", "u-echo"], ["u-me", "u-black"], ["u-berry", "u-me"], ["u-echo", "u-moon"], ["u-echo", "u-me"], ["u-black", "u-echo"], ["u-black", "u-me"], ["u-moon", "u-black"]]) {
      await client.query("INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [followerId, followingId]);
    }

    const sourceEvidence = await captureSourceEvidence(client, {
      reporterId: demoReport.reporterID,
      sourceType: demoReport.sourceType,
      sourceId: demoReport.sourceID
    });
    const priorReportResult = await client.query(
      "SELECT case_id FROM reports WHERE id = $1 FOR UPDATE",
      [demoReport.id]
    );
    const priorCaseID = priorReportResult.rows[0]?.case_id || null;
    const caseResult = await client.query(
      `INSERT INTO safety_cases (id, subject_type, subject_id, category, impact_scope, status)
       VALUES ($1, $2, $3, $4, $5, 'received')
       ON CONFLICT (id) DO UPDATE SET
         subject_type = EXCLUDED.subject_type,
         subject_id = EXCLUDED.subject_id,
         category = EXCLUDED.category,
         impact_scope = EXCLUDED.impact_scope,
         status = EXCLUDED.status,
         risk_level = 'none',
         confidence = 0,
         ai_recommendation = '{}'::jsonb,
         manual_hold = false,
         correction_due_at = NULL,
         model_version = '',
         prompt_version = '',
         policy_version = 'safety-policy-v2',
         resolved_at = NULL,
         updated_at = now()
       WHERE (
         (
           safety_cases.subject_type = EXCLUDED.subject_type
           AND safety_cases.subject_id = EXCLUDED.subject_id
           AND safety_cases.category = EXCLUDED.category
           AND safety_cases.impact_scope = EXCLUDED.impact_scope
         ) OR EXISTS (
           SELECT 1
           FROM reports r
           WHERE r.id = $6
             AND r.case_id = safety_cases.id
             AND r.target_type = $7
             AND r.target_id = $8
             AND r.reason = $9
             AND r.detail = $10
             AND r.reporter_id = $11
         )
       )
         AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.case_id = safety_cases.id AND r.id <> $6)
         AND NOT EXISTS (SELECT 1 FROM safety_evidence e WHERE e.case_id = safety_cases.id AND e.id <> $12)
         AND NOT EXISTS (SELECT 1 FROM safety_case_events event WHERE event.case_id = safety_cases.id)
         AND NOT EXISTS (SELECT 1 FROM safety_actions action WHERE action.case_id = safety_cases.id)
         AND NOT EXISTS (SELECT 1 FROM safety_jobs job WHERE job.case_id = safety_cases.id)
       RETURNING safety_cases.id`,
      [
        demoReport.caseID,
        demoReport.subjectType,
        demoReport.subjectID,
        demoReport.reasonCode,
        demoReport.impactScope,
        demoReport.id,
        demoReport.sourceType,
        demoReport.sourceID,
        demoReport.reason,
        demoReport.detail,
        demoReport.reporterID,
        demoReport.evidenceID
      ]
    );
    assertFixtureWrite(caseResult);
    const reportResult = await client.query(
      `INSERT INTO reports (
         id, target_type, target_id, reason, detail, reporter_id, status,
         client_request_id, case_id, source_type, source_id, subject_type, subject_id, reason_code, reported_field
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 'pending',
         $7, $8, $2, $3, $9, $10, $11, $12
       )
       ON CONFLICT (id) DO UPDATE SET
         target_type = EXCLUDED.target_type,
         target_id = EXCLUDED.target_id,
         reason = EXCLUDED.reason,
         detail = EXCLUDED.detail,
         reporter_id = EXCLUDED.reporter_id,
         status = EXCLUDED.status,
         client_request_id = EXCLUDED.client_request_id,
         case_id = EXCLUDED.case_id,
         source_type = EXCLUDED.source_type,
         source_id = EXCLUDED.source_id,
         subject_type = EXCLUDED.subject_type,
         subject_id = EXCLUDED.subject_id,
         reason_code = EXCLUDED.reason_code,
         reported_field = EXCLUDED.reported_field,
         admin_result = NULL,
         handled_at = NULL,
         updated_at = now()
       WHERE reports.target_type = EXCLUDED.target_type
         AND reports.target_id = EXCLUDED.target_id
         AND reports.reason = EXCLUDED.reason
         AND reports.detail = EXCLUDED.detail
         AND reports.reporter_id = EXCLUDED.reporter_id
         AND (
           reports.case_id = EXCLUDED.case_id
           OR (
             reports.case_id LIKE 'sc-legacy-%'
             AND NOT EXISTS (SELECT 1 FROM reports other WHERE other.case_id = reports.case_id AND other.id <> reports.id)
             AND NOT EXISTS (SELECT 1 FROM safety_evidence e WHERE e.case_id = reports.case_id)
             AND NOT EXISTS (SELECT 1 FROM safety_case_events event WHERE event.case_id = reports.case_id)
             AND NOT EXISTS (SELECT 1 FROM safety_actions action WHERE action.case_id = reports.case_id)
             AND NOT EXISTS (SELECT 1 FROM safety_jobs job WHERE job.case_id = reports.case_id)
           )
         )
       RETURNING reports.id`,
      [
        demoReport.id,
        demoReport.sourceType,
        demoReport.sourceID,
        demoReport.reason,
        demoReport.detail,
        demoReport.reporterID,
        demoReport.clientRequestID,
        demoReport.caseID,
        demoReport.subjectType,
        demoReport.subjectID,
        demoReport.reasonCode,
        demoReport.reportedField
      ]
    );
    assertFixtureWrite(reportResult);
    const evidenceResult = await client.query(
      `INSERT INTO safety_evidence (
         id, case_id, report_id, client_request_id, evidence_type, text_snapshot, structured_snapshot,
         object_keys, context_start_message_id, context_end_message_id, retention_delete_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::jsonb,
         $8, $9, $10, $11
       )
       ON CONFLICT (id) DO UPDATE SET
         case_id = EXCLUDED.case_id,
         report_id = EXCLUDED.report_id,
         client_request_id = EXCLUDED.client_request_id,
         evidence_type = EXCLUDED.evidence_type,
         text_snapshot = EXCLUDED.text_snapshot,
         structured_snapshot = EXCLUDED.structured_snapshot,
         object_keys = EXCLUDED.object_keys,
         context_start_message_id = EXCLUDED.context_start_message_id,
         context_end_message_id = EXCLUDED.context_end_message_id,
         retention_delete_at = EXCLUDED.retention_delete_at,
         redacted_at = NULL
       WHERE safety_evidence.case_id = EXCLUDED.case_id
         AND safety_evidence.report_id = EXCLUDED.report_id
       RETURNING safety_evidence.id`,
      [
        demoReport.evidenceID,
        demoReport.caseID,
        demoReport.id,
        demoReport.clientRequestID,
        sourceEvidence.evidenceType,
        sourceEvidence.textSnapshot,
        JSON.stringify({
          source: sourceEvidence.structuredSnapshot,
          report: {
            reasonCode: demoReport.reasonCode,
            reportedField: demoReport.reportedField,
            detail: demoReport.detail,
            supplemental: false
          }
        }),
        sourceEvidence.objectKeys,
        sourceEvidence.contextStartMessageId,
        sourceEvidence.contextEndMessageId,
        sourceEvidence.retentionDeleteAt
      ]
    );
    assertFixtureWrite(evidenceResult);
    await cleanupMigratedDemoCase(client, priorCaseID);
  });
  console.log("seed complete");
} finally {
  await pool.end();
}

function assertConfiguredLocalDatabase() {
  const configuredHost = databaseHostFromEnvironment();
  if (!isLocalDatabaseHost(configuredHost)) {
    throw new Error("Refusing to seed a non-loopback database");
  }
}

async function assertConnectedLocalDatabase() {
  const allowedDatabases = demoSeedDatabaseAllowlist();
  const { rows } = await query(
    "SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address"
  );
  const target = rows[0];
  if (!target?.database_name || (target.server_address && !isLoopbackAddress(target.server_address))) {
    throw new Error("Refusing to seed a non-loopback database");
  }
  if (!allowedDatabases.has(target.database_name)) {
    throw new Error("Refusing to seed a database not listed in DEMO_SEED_DATABASE_ALLOWLIST");
  }
}

function demoSeedDatabaseAllowlist() {
  const raw = String(process.env.DEMO_SEED_DATABASE_ALLOWLIST || "").trim();
  const names = raw.split(",").map((name) => name.trim());
  if (!raw || names.some((name) => !name)) {
    throw new Error("Refusing to seed without a valid DEMO_SEED_DATABASE_ALLOWLIST");
  }
  return new Set(names);
}

function databaseHostFromEnvironment() {
  const explicitHost = String(process.env.DB_HOST || "").trim();
  if (explicitHost) return explicitHost;

  const databaseURL = String(process.env.DATABASE_URL || "").trim();
  if (!databaseURL) throw new Error("Refusing to seed without an explicit local database target");
  let parsed;
  try {
    parsed = new URL(databaseURL);
  } catch {
    throw new Error("Refusing to seed without a valid local database target");
  }
  return parsed.searchParams.get("host") || parsed.hostname;
}

function isLocalDatabaseHost(host) {
  const normalized = String(host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return !normalized || normalized.startsWith("/") || normalized === "localhost" || isLoopbackAddress(normalized);
}

function isLoopbackAddress(address) {
  const normalized = String(address || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.startsWith("::ffff:")) return isLoopbackAddress(normalized.slice(7));
  if (isIP(normalized) === 4) return normalized.split(".")[0] === "127";
  return isIP(normalized) === 6 && ["::1", "0:0:0:0:0:0:0:1"].includes(normalized);
}

function assertFixtureWrite(result) {
  if (result.rowCount !== 1) refuseAmbiguousDemoFixture();
}

async function cleanupMigratedDemoCase(client, priorCaseID) {
  if (!priorCaseID || priorCaseID === demoReport.caseID) return;
  if (!priorCaseID.startsWith("sc-legacy-")) refuseAmbiguousDemoFixture();

  const cleanupResult = await client.query(
    `DELETE FROM safety_cases legacy_case
     WHERE legacy_case.id = $1
       AND legacy_case.id LIKE 'sc-legacy-%'
       AND legacy_case.subject_type = $4
       AND legacy_case.subject_id = $5
       AND legacy_case.category = 'other'
       AND legacy_case.impact_scope = $4
       AND legacy_case.status = 'received'
       AND EXISTS (
         SELECT 1 FROM reports r
         WHERE r.id = $2 AND r.case_id = $3
       )
       AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.case_id = legacy_case.id)
       AND NOT EXISTS (SELECT 1 FROM safety_evidence e WHERE e.case_id = legacy_case.id)
       AND NOT EXISTS (SELECT 1 FROM safety_case_events event WHERE event.case_id = legacy_case.id)
       AND NOT EXISTS (SELECT 1 FROM safety_actions action WHERE action.case_id = legacy_case.id)
       AND NOT EXISTS (SELECT 1 FROM safety_jobs job WHERE job.case_id = legacy_case.id)
     RETURNING legacy_case.id`,
    [priorCaseID, demoReport.id, demoReport.caseID, demoReport.sourceType, demoReport.sourceID]
  );
  assertFixtureWrite(cleanupResult);
}

function refuseAmbiguousDemoFixture() {
  throw new Error("Refusing to repair an ambiguous demo safety fixture collision");
}
