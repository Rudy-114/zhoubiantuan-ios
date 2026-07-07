const SUPPORT_EMAIL = "support@zhoubiantuanmail.top";
const UPDATED_AT = "2026-07-07";

export const PRIVACY_POLICY_PATHS = ["/privacy-policy", "/privacy", "/api/privacy-policy", "/api/privacy"];

const sections = [
  {
    title: "1. 适用范围",
    body: [
      "本隐私政策适用于周边团 iOS App 以及由 api.zhoubiantuanmail.top 提供的相关后端服务。周边团用于发布、浏览和沟通周边团购信息；当前版本不提供站内支付、订单、退款、物流或担保交易服务。",
      "你在 App 内看到的微信、QQ、群号、外部表单或其他外部联系方式，通常由发帖用户主动提供。你离开周边团后与第三方或团长发生的交易、付款、退款、物流和售后安排，不由周边团直接处理。"
    ]
  },
  {
    title: "2. 我们收集的信息",
    body: [
      "账号信息：邮箱、验证码校验记录、密码哈希、昵称、头像、个人简介，以及你主动填写的性别、生日、地区、小红书号等资料。",
      "用户内容：你主动发布或发送的帖子、合集、商品图片、标签、价格、定金、截团时间、成团状态、描述、评论、私信、举报理由和举报详情。",
      "联系和沟通信息：你在帖子或合集中主动填写的微信、QQ、群号、群说明、外部链接，以及你通过客服邮箱发来的咨询内容。",
      "图片与相册信息：只有在你主动选择上传头像、主页背景、商品图片或私信图片时，App 才会读取你授权选择的图片；保存私信图片到系统相册时，会请求相册写入权限。",
      "本地偏好和安全信息：App 会在本机保存登录状态、访问令牌、深色模式、浏览记录、搜索历史、后端调试偏好等必要信息。为保障服务安全和排查故障，服务器会记录基础运行日志、接口访问时间、错误日志和反滥用相关记录。"
    ]
  },
  {
    title: "3. 信息使用目的",
    body: [
      "我们使用上述信息用于注册登录、验证码发送、账号展示、资料编辑、发帖和合集管理、浏览搜索、收藏点赞、评论私信、举报处理、内容安全审核、客服支持、账号删除、反垃圾和基础运营维护。",
      "我们不会将你的个人信息出售给第三方，也不会将这些信息用于跨 App 或跨网站追踪。当前版本未接入广告追踪 SDK。"
    ]
  },
  {
    title: "4. 第三方服务与信息共享",
    body: [
      "为提供基础服务，我们会使用云服务器、数据库、对象存储、邮件发送服务和内容安全审核服务来处理账号、内容、图片、验证码和安全审核相关数据。这些服务仅在实现周边团功能、保障安全和履行法定义务所需范围内处理信息。",
      "当你在帖子、合集或私信中主动公开联系方式或外部链接时，其他用户可能会看到并复制这些信息。请不要公开身份证件、住址、银行卡、精确定位、未成年人隐私或其他高风险信息。",
      "如法律法规、监管要求、司法机关、争议处理或平台安全处置需要，我们可能在必要范围内保存或提供相关记录。"
    ]
  },
  {
    title: "5. 存储、安全与账号删除",
    body: [
      "账号密码以哈希形式保存，登录状态通过令牌维护。图片存储在云对象存储中，后端服务访问数据库和对象存储时使用服务端密钥，密钥不会放入 iOS 客户端。",
      "你可以在 App 内编辑资料、退出登录、删除本地浏览记录，也可以在“设置 - 账号与安全 - 删除账号”中直接发起账号删除。删除后，我们会停止展示或去标识化你的账号资料，隐藏你发布的内容，并尽合理努力清理由你上传的头像、主页背景、帖子图片和私信图片。",
      "出于安全、审计、争议处理或法律要求，部分记录可能在必要期限内保留；超过必要范围后，我们会删除或去标识化处理。"
    ]
  },
  {
    title: "6. 未成年人保护",
    body: [
      "未成年人使用周边团前，应取得父母或其他监护人的同意，并在监护人指导下理解网络交易风险和个人信息保护要求。",
      "未成年人不应独立进行高金额或高风险交易，也不应公开身份证件、住址、学校、银行卡、精确定位或其他敏感信息。监护人如发现未成年人信息被不当展示或使用，可以通过客服邮箱联系我们处理。"
    ]
  },
  {
    title: "7. 你的权利与联系我们",
    body: [
      "你可以通过 App 内功能访问、更正、删除部分个人资料和本地记录，也可以删除账号。如需处理无法在 App 内完成的更正、删除、投诉、举报、账号问题或隐私咨询，请发送邮件至客服邮箱。",
      `客服邮箱：${SUPPORT_EMAIL}`
    ]
  },
  {
    title: "8. 政策更新",
    body: [
      "我们可能根据产品功能、法律法规或审核要求更新本政策。重要变更会在 App 内或本页面以适当方式提示。"
    ]
  }
];

export function servePrivacyPolicy(_req, res) {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.type("html").send(privacyPolicyHtml());
}

export function privacyPolicyHtml() {
  const sectionHtml = sections
    .map((section) => `
      <section>
        <h2>${escapeHtml(section.title)}</h2>
        ${section.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
      </section>`)
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>周边团隐私政策</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f5;
      --text: #202124;
      --muted: #5f6368;
      --line: #dedbd2;
      --accent: #b42335;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.72;
    }
    main {
      width: min(880px, calc(100% - 32px));
      margin: 0 auto;
      padding: 44px 0 64px;
    }
    header {
      border-bottom: 1px solid var(--line);
      margin-bottom: 28px;
      padding-bottom: 22px;
    }
    h1 {
      font-size: clamp(30px, 5vw, 44px);
      line-height: 1.16;
      margin: 0 0 12px;
      letter-spacing: 0;
    }
    h2 {
      font-size: 20px;
      line-height: 1.35;
      margin: 30px 0 10px;
      letter-spacing: 0;
    }
    p {
      font-size: 16px;
      margin: 10px 0;
    }
    .meta {
      color: var(--muted);
      margin: 0;
    }
    a {
      color: var(--accent);
      overflow-wrap: anywhere;
    }
    footer {
      border-top: 1px solid var(--line);
      color: var(--muted);
      margin-top: 34px;
      padding-top: 18px;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>周边团隐私政策</h1>
      <p class="meta">生效日期：${UPDATED_AT} · 最近更新：${UPDATED_AT}</p>
      <p class="meta">联系邮箱：<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
    </header>
    ${sectionHtml}
    <footer>
      <p>本页面为周边团 App Store 送审和用户查阅使用的公开隐私政策页面。</p>
    </footer>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
