const SUPPORT_EMAIL = "support@zhoubiantuanmail.top";
const UPDATED_AT = "2026-07-19";
const SUPPORT_UPDATED_AT = "2026-07-19";

export const PRIVACY_POLICY_PATHS = ["/privacy-policy", "/privacy", "/api/privacy-policy", "/api/privacy"];
export const SUPPORT_PAGE_PATHS = ["/support", "/help", "/api/support", "/api/help"];

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
      "账号信息：内部账号标识、邮箱、验证码校验记录、密码哈希、昵称、头像、个人简介，以及你主动填写的性别、生日、地区、小红书号等资料。",
      "用户内容：你主动发布或发送的帖子、合集、商品图片、标签、价格、定金、截团时间、成团状态、描述、评论、私信、举报理由和举报详情。",
      "使用与互动信息：你在服务中的点赞、收藏、关注、拉黑、举报及内容处理记录。搜索历史和浏览记录默认只保存在你的设备上，不会作为服务端行为分析数据上传。",
      "联系和沟通信息：你在帖子或合集中主动填写的微信、QQ、群号、群说明、外部链接，以及你通过客服邮箱发来的咨询内容。",
      "图片与相册信息：只有在你主动选择上传头像、主页背景、商品图片或私信图片时，App 才会读取你授权选择的图片；保存私信图片到系统相册时，会请求相册写入权限。",
      "本地偏好和安全信息：App 会在本机保存登录状态、访问令牌、深色模式、浏览记录、搜索历史、后端调试偏好等必要信息。为保障服务安全和排查故障，服务器会记录基础运行日志、接口访问时间、错误日志，并短期保存由 IP 地址等信息生成的不可逆哈希用于反滥用限流。"
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

export function serveSupportPage(_req, res) {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.type("html").send(supportPageHtml());
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
  <link rel="icon" href="data:,">
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
      <p>需要帮助？请访问<a href="/support">周边团用户支持</a>或发送邮件至 <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>。</p>
    </footer>
  </main>
</body>
</html>`;
}

export function supportPageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="周边团 App 用户支持、账号帮助、举报申诉、隐私与社区安全说明。">
  <link rel="icon" href="data:,">
  <title>周边团用户支持</title>
  <style>
    :root {
      color-scheme: light;
      --paper: #f7f4ee;
      --surface: #fffdf8;
      --ink: #211c1b;
      --muted: #706866;
      --line: #ded6cc;
      --accent: #b42335;
      --accent-dark: #861829;
      --serif: "Songti SC", "STSong", Georgia, serif;
      --sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font-family: var(--sans);
      line-height: 1.65;
    }
    a { color: inherit; }
    .skip-link {
      left: 16px;
      position: fixed;
      top: -80px;
      z-index: 10;
    }
    .skip-link:focus {
      background: var(--ink);
      color: white;
      padding: 10px 14px;
      top: 12px;
    }
    .masthead {
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.22);
      display: flex;
      justify-content: space-between;
      left: 0;
      padding: 18px clamp(20px, 5vw, 72px);
      position: absolute;
      right: 0;
      top: 0;
      z-index: 2;
    }
    .brand {
      color: white;
      font-family: var(--serif);
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-decoration: none;
    }
    .masthead a:last-child {
      color: rgba(255, 255, 255, 0.84);
      font-size: 14px;
      text-decoration: none;
    }
    .hero {
      animation: settle 520ms ease-out both;
      background:
        radial-gradient(circle at 78% 22%, rgba(255, 222, 197, 0.2), transparent 24%),
        linear-gradient(128deg, #6f101f 0%, #a82236 58%, #c34a4e 100%);
      color: white;
      min-height: min(620px, 78svh);
      overflow: hidden;
      padding: clamp(130px, 20vh, 190px) clamp(20px, 8vw, 120px) 76px;
      position: relative;
    }
    .hero::after {
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 50%;
      content: "";
      height: min(62vw, 720px);
      position: absolute;
      right: -18vw;
      top: -24vw;
      width: min(62vw, 720px);
    }
    .eyebrow {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.16em;
      margin: 0 0 18px;
      text-transform: uppercase;
    }
    h1 {
      font-family: var(--serif);
      font-size: clamp(48px, 8vw, 92px);
      font-weight: 700;
      letter-spacing: -0.04em;
      line-height: 1.02;
      margin: 0;
      max-width: 820px;
    }
    .hero-copy {
      color: rgba(255, 255, 255, 0.82);
      font-size: clamp(16px, 2vw, 20px);
      margin: 24px 0 34px;
      max-width: 620px;
    }
    .primary-action {
      align-items: center;
      background: white;
      border-radius: 999px;
      color: var(--accent-dark);
      display: inline-flex;
      font-weight: 700;
      min-height: 48px;
      padding: 0 22px;
      text-decoration: none;
      transition: transform 160ms ease, box-shadow 160ms ease;
    }
    .primary-action:hover { box-shadow: 0 14px 32px rgba(38, 7, 12, 0.2); transform: translateY(-2px); }
    .primary-action:focus-visible, .section-nav a:focus-visible, summary:focus-visible, footer a:focus-visible {
      outline: 3px solid #f2bd63;
      outline-offset: 4px;
    }
    .support-main {
      animation: settle 620ms 80ms ease-out both;
      margin: 0 auto;
      max-width: 1120px;
      padding: 0 clamp(20px, 5vw, 64px) 84px;
    }
    .section-nav {
      background: var(--surface);
      border-bottom: 1px solid var(--line);
      display: flex;
      gap: 26px;
      margin: 0 calc(clamp(20px, 5vw, 64px) * -1);
      overflow-x: auto;
      padding: 18px clamp(20px, 5vw, 64px);
      white-space: nowrap;
    }
    .section-nav a { color: var(--muted); font-size: 14px; font-weight: 650; text-decoration: none; }
    .section-nav a:hover { color: var(--accent); }
    section {
      border-top: 1px solid var(--line);
      display: grid;
      gap: clamp(24px, 6vw, 88px);
      grid-template-columns: minmax(190px, 0.72fr) minmax(0, 1.6fr);
      padding: clamp(50px, 8vw, 88px) 0;
      scroll-margin-top: 24px;
    }
    section:first-of-type { border-top: 0; }
    h2 {
      font-family: var(--serif);
      font-size: clamp(27px, 4vw, 38px);
      line-height: 1.18;
      margin: 0;
    }
    h3 { font-size: 18px; margin: 0 0 8px; }
    p { margin: 0 0 16px; }
    .muted { color: var(--muted); }
    .contact-address {
      color: var(--accent);
      font-size: clamp(20px, 3vw, 30px);
      font-weight: 760;
      overflow-wrap: anywhere;
      text-decoration-thickness: 1px;
      text-underline-offset: 5px;
    }
    .support-list { display: grid; gap: 26px; }
    .support-list article { border-left: 2px solid var(--accent); padding-left: 18px; }
    details { border-top: 1px solid var(--line); padding: 18px 0; }
    details:last-child { border-bottom: 1px solid var(--line); }
    summary { cursor: pointer; font-size: 17px; font-weight: 700; list-style-position: outside; }
    details p { color: var(--muted); margin: 12px 0 0; padding-left: 18px; }
    .notice {
      background: #efe7dc;
      border-left: 3px solid var(--accent);
      margin-top: 28px;
      padding: 18px 20px;
    }
    footer {
      align-items: flex-start;
      border-top: 1px solid var(--line);
      color: var(--muted);
      display: flex;
      font-size: 14px;
      gap: 24px;
      justify-content: space-between;
      padding: 28px 0;
    }
    footer a { color: var(--accent); }
    @keyframes settle {
      from { opacity: 0; transform: translateY(14px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (max-width: 680px) {
      .masthead { padding: 16px 20px; }
      .hero { min-height: 560px; padding-left: 20px; padding-right: 20px; }
      .hero::after { height: 390px; right: -210px; top: -90px; width: 390px; }
      section { grid-template-columns: 1fr; }
      footer { display: block; }
      footer p + p { margin-top: 10px; }
    }
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      .hero, .support-main { animation: none; }
      .primary-action { transition: none; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#main">跳到主要内容</a>
  <header class="masthead">
    <a class="brand" href="/support">周边团</a>
    <a href="/privacy-policy">隐私政策</a>
  </header>
  <div class="hero">
    <p class="eyebrow">Support Center</p>
    <h1>周边团用户支持</h1>
    <p class="hero-copy">账号、举报申诉、内容安全或隐私问题，都可以在这里找到处理方式。</p>
    <a class="primary-action" href="mailto:${SUPPORT_EMAIL}?subject=%E5%91%A8%E8%BE%B9%E5%9B%A2%20App%20%E7%94%A8%E6%88%B7%E6%94%AF%E6%8C%81">发送支持邮件</a>
  </div>
  <main class="support-main" id="main">
    <nav class="section-nav" aria-label="支持页面导航">
      <a href="#contact">联系支持</a>
      <a href="#account">账号与登录</a>
      <a href="#safety">举报与申诉</a>
      <a href="#privacy">隐私与数据</a>
    </nav>

    <section id="contact">
      <div><p class="eyebrow muted">01 · Contact</p><h2>联系支持</h2></div>
      <div>
        <p>请使用注册邮箱发送问题，并说明遇到问题的页面、操作时间和提示文字。请勿在邮件中发送密码、验证码、身份证件、银行卡或其他敏感信息。</p>
        <p><a class="contact-address" href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
        <p class="muted">我们收到邮件后会尽快处理。涉及紧急人身安全、诈骗或资金损失时，请同时联系当地执法部门及相关支付平台。</p>
      </div>
    </section>

    <section id="account">
      <div><p class="eyebrow muted">02 · Account</p><h2>账号与登录</h2></div>
      <div>
        <details open>
          <summary>收不到邮箱验证码怎么办？</summary>
          <p>请核对邮箱拼写并检查垃圾邮件，等待发送间隔结束后再试。仍无法收到时，请通过上方邮箱联系我们。</p>
        </details>
        <details>
          <summary>如何删除账号？</summary>
          <p>登录 App 后进入“我的 - 设置 - 账号与安全 - 删除账号”，阅读影响并二次确认。删除后登录凭证立即失效，个人资料会被清除或去标识化，已发布内容会被隐藏。</p>
        </details>
        <details>
          <summary>账号出现限制怎么办？</summary>
          <p>请先查看 App 内的处理原因与可用操作。若你认为处理有误，可按页面提示整改或提交一次申诉，也可以通过支持邮箱补充说明。</p>
        </details>
      </div>
    </section>

    <section id="safety">
      <div><p class="eyebrow muted">03 · Safety</p><h2>举报与申诉</h2></div>
      <div class="support-list">
        <article>
          <h3>举报不当内容或用户</h3>
          <p class="muted">在帖子、评论、用户主页、拼团合集或私信页面选择举报，按实际情况填写原因；举报用户时还可以同时拉黑。</p>
        </article>
        <article>
          <h3>查看处理进度</h3>
          <p class="muted">进入“我的举报”查看提交、审核和处理状态。需要补充材料时，请只提交与该举报直接相关的证据。</p>
        </article>
        <article>
          <h3>社区安全与内容规范</h3>
          <p class="muted">禁止发布违法违禁、色情低俗、暴力威胁、骚扰辱骂、诈骗引流、隐私泄露、垃圾广告或侵权盗用内容。平台可根据内容审核、用户举报与人工复核采取隐藏、整改、限制或下架措施。</p>
        </article>
        <div class="notice">周边团当前不提供站内支付、订单、退款、物流或担保交易服务。通过微信、QQ、群聊或外部链接进行交易前，请自行核实身份、商品和付款风险。</div>
      </div>
    </section>

    <section id="privacy">
      <div><p class="eyebrow muted">04 · Privacy</p><h2>隐私与数据</h2></div>
      <div>
        <p>你可以在 App 内编辑个人资料、关闭并清除本地浏览记录、管理已拉黑用户，或直接删除账号。</p>
        <p>关于信息收集、使用、存储、第三方服务和保留规则，请阅读<a href="/privacy-policy">《周边团隐私政策》</a>。</p>
      </div>
    </section>

    <footer>
      <p>周边团 · 用户支持</p>
      <p>最近更新：${SUPPORT_UPDATED_AT} · <a href="/privacy-policy">隐私政策</a></p>
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
