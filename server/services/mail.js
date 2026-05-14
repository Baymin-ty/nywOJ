const nodemailer = require('nodemailer');
const config = require('../config.json');

const DEFAULT_FROM = 'nywojservice@163.com';

let transporter = null;

const emailConfig = () => config.EMAIL || {};

const getTransporter = () => {
  if (transporter) return transporter;
  const cfg = emailConfig();
  transporter = nodemailer.createTransport({
    host: cfg.host || 'smtp.163.com',
    port: cfg.port || 465,
    secure: cfg.secure == null ? true : !!cfg.secure,
    auth: {
      user: cfg.username,
      pass: cfg.password,
    },
  });
  return transporter;
};

const fromAddress = () => emailConfig().from || emailConfig().username || DEFAULT_FROM;

const sendMail = async ({ to, subject, text, html }) => {
  if (!to || !subject || (!text && !html)) throw new Error('invalid mail payload');
  await getTransporter().sendMail({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  });
};

const verificationTemplates = {
  bindEmail: {
    subject: 'nywOJ绑定邮箱验证码',
    body: ({ code }) => `你正在 nywOJ 进行绑定邮箱操作，验证码为 ${code}\n该验证码 3 分钟内有效。`,
  },
  changeEmail: {
    subject: 'nywOJ修改邮箱验证码',
    body: ({ code, name }) => `你正在 nywOJ 进行修改邮箱操作${name ? `（用户名: ${name}）` : ''}，验证码为 ${code}\n该验证码 3 分钟内有效。`,
  },
  resetPassword: {
    subject: 'nywOJ找回密码验证码',
    body: ({ code, name }) => `你正在 nywOJ 找回密码${name ? `（用户名: ${name}）` : ''}，验证码为 ${code}\n该验证码 3 分钟内有效。若非本人操作，请忽略本邮件。`,
  },
  loginEmailCode: {
    subject: 'nywOJ邮箱登录验证码',
    body: ({ code, name }) => `你正在使用邮箱验证码登录 nywOJ${name ? `（用户名: ${name}）` : ''}，验证码为 ${code}\n该验证码 3 分钟内有效。若非本人操作，请忽略本邮件。`,
  },
};

const sendVerificationCode = async ({ to, purpose, code, name }) => {
  const template = verificationTemplates[purpose];
  if (!template) throw new Error(`unknown mail purpose: ${purpose}`);
  await sendMail({
    to,
    subject: template.subject,
    text: template.body({ code, name }),
  });
};

module.exports = {
  sendMail,
  sendVerificationCode,
};
