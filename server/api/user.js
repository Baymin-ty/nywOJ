const bcrypt = require('bcryptjs');
const mail = require('nodemailer');
const db = require('../db');
const { handler, fail, ok, paginate } = require('../db/util');
const { Format, ip2loc, msFormat, recordEvent, eventList, eventExp, briefFormat } = require('../static');
const config = require('../config.json');
const { listGlobalKeys } = require('../auth/policy');

const NAME_REGEX = /^[A-Za-z0-9]+$/;
const EMAIL_REGEX = /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/;

const revokeAllSessions = async (uid, curToken) => {
  const sessions = await db.query(
    'SELECT token FROM userSession WHERE uid=? AND TIMESTAMPDIFF(SECOND,time,NOW()) < ?',
    [uid, config.SESSION.expire / 1000]
  );
  const tokens = sessions.map((s) => s.token).filter((t) => t !== curToken);
  if (!tokens.length) return;
  await db.query('UPDATE sessions SET expires=? WHERE session_id in(?)', [0, tokens]);
  await db.query('UPDATE userSession SET time=? WHERE token in(?)', [new Date(0), tokens]);
};

exports.reg = handler(async (req, res) => {
  const { name, pwd, rePwd } = req.body;
  const verified = req.session.verifiedEmail;
  if (!verified || !verified.email) return fail(res, '请先验证邮箱');
  if (Date.now() > verified.expire) return fail(res, '操作超时，请重新绑定邮箱');
  if (!name || !pwd || !rePwd) return fail(res, '请确认信息完善');
  if (name.length < 3 || name.length > 15) return fail(res, '用户名长度应在3~15之间');
  if (!NAME_REGEX.test(name)) return fail(res, '用户名应只包含字母或数字');
  if (pwd.length > 31 || pwd.length < 6) return fail(res, '密码长度应在6~31之间');
  if (pwd !== rePwd) return fail(res, '两次输入的密码不一致');

  const exist = await db.exists('SELECT uid FROM userInfo WHERE name=?', [name]);
  if (exist) return fail(res, '此用户名已被注册');

  const password = bcrypt.hashSync(pwd, 12);
  const r = await db.query(
    'INSERT INTO userInfo(name,pwd,reg_time,email) values (?,?,?,?)',
    [name, password, new Date(), verified.email]
  );
  if (!r.affectedRows) return fail(res, 'sql error');

  req.session.verifyCode = null;
  return ok(res);
});

exports.login = handler(async (req, res) => {
  const { name, pwd } = req.body;
  if (!name || !pwd) return fail(res, '请确认信息完善');

  const user = await db.one('SELECT * FROM userInfo WHERE name=?', [name]);
  if (!user) return fail(res, '请先注册后再登录');
  if (!user.inUse) {
    recordEvent(req, 'user.loginFail.userBlocked', null, user.uid);
    return fail(res, '你号没了');
  }
  if (!bcrypt.compareSync(pwd, user.pwd)) {
    recordEvent(req, 'user.loginFail.wrongPassword', null, user.uid);
    return fail(res, '密码错误');
  }

  req.session.uid = user.uid;
  req.session.name = user.name;
  req.session.email = user.email;
  recordEvent(req, 'user.login');

  const now = new Date();
  await db.query('UPDATE userInfo SET login_time=? WHERE uid=?', [now, user.uid]);
  await db.query(
    'INSERT INTO userSession(uid,token,browser,os,loginIp,loginLoc,time,lastact) values (?,?,?,?,?,?,?,?)',
    [
      user.uid,
      req.sessionID,
      `${req.useragent.browser.name} ${req.useragent.browser.version}`,
      `${req.useragent.os.name} ${req.useragent.os.version}`,
      req.session.ip,
      ip2loc(req.session.ip),
      now,
      now,
    ]
  );
  return ok(res);
});

exports.getUserInfo = handler(async (req, res) => {
  if (!req.session.uid) return fail(res, '请先登录');
  const user = await db.one('SELECT * FROM userInfo WHERE uid=?', [req.session.uid]);
  if (!user) return fail(res, '获取用户信息错误');
  if (!user.inUse) {
    req.session.destroy();
    return fail(res, '请先登录');
  }
  req.session.name = user.name;
  req.session.email = user.email;
  req.session.avatar = user.qq
    ? `https://q1.qlogo.cn/g?b=qq&nk=${user.qq}&s=3`
    : '/default-avatar.svg';
  req.session.preferenceLang = user.preferenceLang;
  const permissions = req.perms ? listGlobalKeys(req.perms) : [];
  return ok(res, {
    uid: req.session.uid,
    name: req.session.name,
    email: req.session.email,
    ip: req.session.ip,
    avatar: req.session.avatar,
    preferenceLang: req.session.preferenceLang,
    permissions,
  });
});

exports.logout = handler(async (req, res) => {
  recordEvent(req, 'user.logout');
  await db.query('UPDATE userSession SET time=? WHERE token=?', [new Date(0), req.sessionID]);
  req.session.destroy();
  return ok(res);
});

let lastSent = {};

exports.sendEmailVerifyCode = handler(async (req, res) => {
  const { email } = req.body;

  if (lastSent[req.session.ip]) {
    const rest = Date.now() - lastSent[req.session.ip] - 30 * 1000;
    if (rest < 0) return fail(res, `请 ${Math.ceil(rest / -1000)} 秒后再试`);
  }
  if (!EMAIL_REGEX.test(email)) return fail(res, '请检查邮箱是否合法');

  const charset = 'abcdefghijklmnpqrstuvwxyzABCDEFGHJKLMNOPQRSTUVWXYZ1234567890';
  let verifyCode = '';
  for (let i = 0; i < 6; i++) verifyCode += charset.charAt(Math.floor(Math.random() * 60));

  req.session.verifyCode = {
    code: verifyCode,
    expire: Date.now() + 3 * 60 * 1000,
    email,
  };

  const transporter = mail.createTransport({
    host: 'smtp.163.com',
    port: 465,
    secureConnection: true,
    auth: { user: config.EMAIL.username, pass: config.EMAIL.password },
  });

  const mailOptions = {
    from: 'nywojservice@163.com',
    to: email,
    subject: req.body.update ? 'nywOJ修改邮箱验证码' : 'nywOJ绑定邮箱验证码',
    text: req.body.update
      ? `你正在nywOJ进行修改邮箱操作(用户名: ${req.session.name}), 验证码为 ${verifyCode}\n该验证码3分钟内有效。`
      : `你正在nywOJ进行绑定邮箱操作,验证码为 ${verifyCode}\n该验证码3分钟内有效。`,
  };

  if (req.session.uid) {
    recordEvent(req, 'auth.sendEmailVerifyCode', { to: email });
  }

  await new Promise((resolve, reject) => {
    transporter.sendMail(mailOptions, (err) => (err ? reject(err) : resolve()));
  });
  lastSent[req.session.ip] = Date.now();
  return ok(res);
});

exports.setUserEmail = handler(async (req, res) => {
  const userCode = req.body.code;
  if (!req.session.verifyCode || !userCode) return fail(res, '请确认信息完善且操作正确');
  if (userCode !== req.session.verifyCode.code) return fail(res, '验证码错误');
  if (Date.now() > req.session.verifyCode.expire) return fail(res, '验证码超时');

  const newEmail = req.session.verifyCode.email;
  const taken = await db.exists('SELECT email FROM userInfo WHERE email=?', [newEmail]);
  if (taken) return fail(res, '此邮箱已绑定过其他账号');

  if (!req.body.update) {
    req.session.verifiedEmail = {
      email: newEmail,
      expire: Date.now() + 10 * 60 * 1000,
    };
    req.session.verifyCode = null;
    return ok(res, { message: '验证成功,请在10分钟内完成注册操作' });
  }

  const cur = await db.one('SELECT email FROM userInfo WHERE uid=?', [req.session.uid]);
  await db.query('UPDATE userInfo SET email=? WHERE uid=?', [newEmail, req.session.uid]);
  req.session.email = newEmail;
  await revokeAllSessions(req.session.uid, req.sessionID);
  recordEvent(req, 'auth.changeEmail', { email: { old: cur ? cur.email : null, new: newEmail } });
  req.session.verifyCode = null;
  return ok(res, { message: '更新邮箱成功' });
});

exports.getUserPublicInfo = handler(async (req, res) => {
  const { uid } = req.body;
  const info = await db.one(
    'SELECT uid,name,email,reg_time,login_time,clickCnt,inUse,motto,qq,preferenceLang FROM userInfo WHERE uid=?',
    [uid]
  );
  if (!info) return fail(res, '无此用户');
  if (info.reg_time) info.reg_time = briefFormat(info.reg_time);
  if (info.login_time) info.login_time = briefFormat(info.login_time);
  // Roles attached so the profile page can decorate the user (badges, name color).
  info.roles = await db.column(
    'SELECT r.`key` AS k FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.uid=?',
    [uid],
    'k'
  );
  if (!req.can('user.list') && req.session.uid !== info.uid) {
    delete info.login_time;
    delete info.email;
  }
  return ok(res, { info });
});

exports.setUserMotto = handler(async (req, res) => {
  const motto = req.body.data;
  if (motto.length > 1000) return fail(res, '个人主页长度应在1000以内');
  await db.query('UPDATE userInfo SET motto=? WHERE uid=?', [motto, req.session.uid]);
  return ok(res);
});

exports.listSessions = handler(async (req, res) => {
  const list = await db.query(
    'SELECT * FROM userSession WHERE uid=? AND TIMESTAMPDIFF(SECOND,lastact,NOW()) < ? AND time != ? ORDER BY lastact DESC',
    [req.session.uid, config.SESSION.expire / 1000, new Date(0)]
  );
  const now = Date.now();
  for (const s of list) {
    delete s.id;
    s.lastact = s.token === req.sessionID ? '当前会话' : msFormat(now - new Date(s.lastact).getTime());
    s.time = Format(s.time);
  }
  return ok(res, { data: list });
});

exports.revokeSession = handler(async (req, res) => {
  if (req.body.revokeAll) {
    await revokeAllSessions(req.session.uid, req.sessionID);
    recordEvent(req, 'auth.revokeAllSessions');
    return ok(res, { message: 'ok' });
  }
  const { token } = req.body;
  const exists = await db.exists('SELECT id FROM userSession WHERE uid=? AND token=?', [req.session.uid, token]);
  if (!exists) return fail(res, '无效token');

  recordEvent(req, 'auth.revokeSession');
  await db.query('UPDATE sessions SET expires=? WHERE session_id=?', [0, token]);
  await db.query('UPDATE userSession SET time=? WHERE uid=? AND token=?', [new Date(0), req.session.uid, token]);
  return ok(res, { message: 'ok' });
});

exports.updateUserPublicInfo = handler(async (req, res) => {
  const info = req.body.userInfo || {};
  const before = await db.one('SELECT qq,motto,preferenceLang FROM userInfo WHERE uid=?', [req.session.uid]);
  await db.query(
    'UPDATE userInfo SET qq=?,motto=?,preferenceLang=? WHERE uid=?',
    [info.qq, info.motto, info.preferenceLang, req.session.uid]
  );
  const detail = {};
  for (const key of ['qq', 'motto', 'preferenceLang']) {
    if (before && before[key] !== info[key]) detail[key] = { old: before[key], new: info[key] };
  }
  recordEvent(req, 'user.updateProfile', detail);
  return ok(res, { message: 'ok' });
});

exports.listAudits = handler(async (req, res) => {
  const { offset, limit } = paginate(req, 10);
  const list = await db.query(
    'SELECT * FROM userAudit WHERE uid=? ORDER BY id DESC LIMIT ?,?',
    [req.session.uid, offset, limit]
  );
  for (const r of list) {
    delete r.id;
    r.eventExp = eventExp[r.event];
    r.event = eventList[r.event];
    r.time = Format(r.time);
  }
  const cnt = await db.one('SELECT COUNT(*) as cnt FROM userAudit WHERE uid=?', [req.session.uid]);
  return ok(res, { data: list, total: cnt.cnt });
});

exports.modifyPassword = handler(async (req, res) => {
  const { newPwd } = req.body;
  if (newPwd.new !== newPwd.rep) return fail(res, '两次密码不一致');
  if (newPwd.new.length > 31 || newPwd.new.length < 6) return fail(res, '密码长度应在6~31之间');

  const user = await db.one('SELECT pwd FROM userInfo WHERE uid=?', [req.session.uid]);
  if (!user || !bcrypt.compareSync(newPwd.old, user.pwd)) return fail(res, '旧密码错误');

  const updPwd = bcrypt.hashSync(newPwd.new, 12);
  await db.query('UPDATE userInfo SET pwd=? WHERE uid=?', [updPwd, req.session.uid]);
  recordEvent(req, 'auth.changePassword');
  await revokeAllSessions(req.session.uid, req.sessionID);
  return ok(res, { message: 'ok' });
});
