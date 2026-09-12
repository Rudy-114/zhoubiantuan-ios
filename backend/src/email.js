import nodemailer from "nodemailer";
import { config } from "./config.js";

let transporter;

function getTransporter() {
  const smtp = config.email.smtp;
  if (!smtp.host || !smtp.user || !smtp.pass || !config.email.from) {
    const error = new Error("邮件发送服务未配置");
    error.status = 503;
    throw error;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: {
        user: smtp.user,
        pass: smtp.pass
      }
    });
  }
  return transporter;
}

export async function sendEmailCode({ email, code, purpose }) {
  if (config.nodeEnv === "test") throw new Error("Real email delivery is disabled during tests");
  const title = purpose === "login" ? "登录验证码" : "注册验证码";
  const subject = `周边团${title}`;
  const text = [
    `你的周边团${title}是：${code}`,
    `验证码 ${config.email.codeTtlMinutes} 分钟内有效。`,
    "如果不是你本人操作，可以忽略这封邮件。"
  ].join("\n");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#202124">
      <p>你的周边团${title}是：</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:12px 0">${code}</p>
      <p>验证码 ${config.email.codeTtlMinutes} 分钟内有效。</p>
      <p style="color:#6b7280">如果不是你本人操作，可以忽略这封邮件。</p>
    </div>
  `;

  await getTransporter().sendMail({
    from: config.email.from,
    to: email,
    subject,
    text,
    html
  });
}
