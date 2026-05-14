const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { handler, fail, ok, paginate, buildWhere } = require('../db/util');
const { Format, ip2loc, msFormat, recordEvent, eventList, eventExp, briefFormat } = require('../static');
const config = require('../config.json');
const { listGlobalKeys } = require('../auth/policy');
const { sendVerificationCode } = require('../services/mail');
const { judgeRes } = require('../db/format');

const NAME_REGEX = /^[A-Za-z0-9]+$/;
const EMAIL_REGEX = /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/;
const VERIFY_CODE_TTL_MS = 3 * 60 * 1000;
const VERIFY_CODE_RATE_LIMIT_MS = 30 * 1000;

const generateVerifyCode = () => {
  const charset = 'abcdefghijklmnpqrstuvwxyzABCDEFGHJKLMNOPQRSTUVWXYZ1234567890';
  let code = '';
  for (let i = 0; i < 6; i++) code += charset[crypto.randomInt(charset.length)];
  return code;
};

const normalizeEmail = (email) => String(email || '').trim();

const checkRateLimit = (req, key) => {
  const bucket = `${req.session.ip || req.ip || 'unknown'}:${key}`;
  const last = lastSent[bucket];
  if (last) {
    const rest = Date.now() - last - VERIFY_CODE_RATE_LIMIT_MS;
    if (rest < 0) return Math.ceil(rest / -1000);
  }
  return 0;
};

const markRateLimit = (req, key) => {
  const bucket = `${req.session.ip || req.ip || 'unknown'}:${key}`;
  lastSent[bucket] = Date.now();
};

const startLoginSession = async (req, user) => {
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
};

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
  const account = String(req.body.name || req.body.account || '').trim();
  const { pwd } = req.body;
  if (!account || !pwd) return fail(res, '请确认信息完善');

  const isEmail = EMAIL_REGEX.test(account);
  const user = await db.one(
    isEmail ? 'SELECT * FROM userInfo WHERE email=? LIMIT 1' : 'SELECT * FROM userInfo WHERE name=? LIMIT 1',
    [account]
  );
  if (!user) return fail(res, '请先注册后再登录');
  if (!user.inUse) {
    recordEvent(req, 'user.loginFail.userBlocked', null, user.uid);
    return fail(res, '你号没了');
  }
  if (!bcrypt.compareSync(pwd, user.pwd)) {
    recordEvent(req, 'user.loginFail.wrongPassword', null, user.uid);
    return fail(res, '密码错误');
  }

  await startLoginSession(req, user);
  return ok(res);
});

exports.sendLoginEmailCode = handler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const purpose = 'loginEmailCode';
  const wait = checkRateLimit(req, purpose);
  if (wait > 0) return fail(res, `请 ${wait} 秒后再试`);
  if (!EMAIL_REGEX.test(email)) return fail(res, '请检查邮箱是否合法');

  const user = await db.one('SELECT uid, name, email, inUse FROM userInfo WHERE email=? LIMIT 1', [email]);
  if (user && user.inUse) {
    const verifyCode = generateVerifyCode();
    req.session.emailLogin = {
      uid: user.uid,
      email,
      code: verifyCode,
      expire: Date.now() + VERIFY_CODE_TTL_MS,
    };
    await sendVerificationCode({
      to: email,
      purpose,
      code: verifyCode,
      name: user.name,
    });
    recordEvent(req, 'auth.sendLoginEmailCode', { to: email }, user.uid);
  } else {
    req.session.emailLogin = null;
  }

  markRateLimit(req, purpose);
  return ok(res, { message: '如果该邮箱已绑定账号，验证码会发送到该邮箱' });
});

exports.loginByEmailCode = handler(async (req, res) => {
  const login = req.session.emailLogin;
  const code = String(req.body.code || '').trim();
  if (!login || !code) return fail(res, '请确认信息完善且操作正确');
  if (Date.now() > login.expire) return fail(res, '验证码超时');
  if (code !== login.code) return fail(res, '验证码错误');

  const user = await db.one('SELECT * FROM userInfo WHERE uid=? AND email=? LIMIT 1', [login.uid, login.email]);
  if (!user) return fail(res, '账号不存在');
  if (!user.inUse) {
    recordEvent(req, 'user.loginFail.userBlocked', null, user.uid);
    return fail(res, '你号没了');
  }

  await startLoginSession(req, user);
  req.session.emailLogin = null;
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
    // uid=1 is the root account: bypasses every guard, including the
    // "builtin role is read-only" rule in /api/auth/updateRole.
    isRoot: Number(req.session.uid) === 1,
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
  const email = normalizeEmail(req.body.email);
  const purpose = req.body.update ? 'changeEmail' : 'bindEmail';
  if (purpose === 'changeEmail' && !req.session.uid) return fail(res, '请先登录');
  const wait = checkRateLimit(req, purpose);
  if (wait > 0) return fail(res, `请 ${wait} 秒后再试`);
  if (!EMAIL_REGEX.test(email)) return fail(res, '请检查邮箱是否合法');

  const verifyCode = generateVerifyCode();

  req.session.verifyCode = {
    code: verifyCode,
    expire: Date.now() + VERIFY_CODE_TTL_MS,
    email,
    purpose,
  };

  if (req.session.uid) {
    recordEvent(req, 'auth.sendEmailVerifyCode', { to: email, purpose });
  }

  await sendVerificationCode({ to: email, purpose, code: verifyCode, name: req.session.name });
  markRateLimit(req, purpose);
  return ok(res);
});

exports.setUserEmail = handler(async (req, res) => {
  const userCode = String(req.body.code || '').trim();
  const purpose = req.body.update ? 'changeEmail' : 'bindEmail';
  if (purpose === 'changeEmail' && !req.session.uid) return fail(res, '请先登录');
  if (!req.session.verifyCode || !userCode) return fail(res, '请确认信息完善且操作正确');
  if (req.session.verifyCode.purpose !== purpose) return fail(res, '请重新获取验证码');
  if (userCode !== req.session.verifyCode.code) return fail(res, '验证码错误');
  if (Date.now() > req.session.verifyCode.expire) return fail(res, '验证码超时');

  const newEmail = req.session.verifyCode.email;
  const taken = await db.one('SELECT uid FROM userInfo WHERE email=? LIMIT 1', [newEmail]);
  if (taken && (!req.body.update || taken.uid !== req.session.uid)) return fail(res, '此邮箱已绑定过其他账号');

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

exports.sendPasswordResetCode = handler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const purpose = 'resetPassword';
  const wait = checkRateLimit(req, purpose);
  if (wait > 0) return fail(res, `请 ${wait} 秒后再试`);
  if (!EMAIL_REGEX.test(email)) return fail(res, '请检查邮箱是否合法');

  const user = await db.one('SELECT uid, name, inUse FROM userInfo WHERE email=? LIMIT 1', [email]);
  if (user && user.inUse) {
    const verifyCode = generateVerifyCode();
    req.session.passwordReset = {
      uid: user.uid,
      email,
      code: verifyCode,
      expire: Date.now() + VERIFY_CODE_TTL_MS,
    };
    await sendVerificationCode({
      to: email,
      purpose,
      code: verifyCode,
      name: user.name,
    });
    recordEvent(req, 'auth.sendPasswordResetCode', { to: email }, user.uid);
  } else {
    req.session.passwordReset = null;
  }

  markRateLimit(req, purpose);
  return ok(res, { message: '如果该邮箱已绑定账号，验证码会发送到该邮箱' });
});

exports.resetPasswordByEmail = handler(async (req, res) => {
  const reset = req.session.passwordReset;
  const code = String(req.body.code || '').trim();
  const { pwd, rePwd } = req.body;
  if (!reset || !code || !pwd || !rePwd) return fail(res, '请确认信息完善且操作正确');
  if (Date.now() > reset.expire) return fail(res, '验证码超时');
  if (code !== reset.code) return fail(res, '验证码错误');
  if (pwd !== rePwd) return fail(res, '两次输入的密码不一致');
  if (pwd.length > 31 || pwd.length < 6) return fail(res, '密码长度应在6~31之间');

  const user = await db.one('SELECT uid, inUse FROM userInfo WHERE uid=? AND email=?', [reset.uid, reset.email]);
  if (!user || !user.inUse) return fail(res, '账号不存在或不可用');

  const updPwd = bcrypt.hashSync(pwd, 12);
  await db.query('UPDATE userInfo SET pwd=? WHERE uid=?', [updPwd, reset.uid]);
  await revokeAllSessions(reset.uid, null);
  recordEvent(req, 'auth.resetPasswordByEmail', { email: reset.email }, reset.uid);
  req.session.passwordReset = null;
  return ok(res, { message: '密码已重置，请重新登录' });
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
  const [heatmap, resultRows] = await Promise.all([
    db.query(
      `SELECT DATE_FORMAT(submitTime, '%Y-%m-%d') AS date, COUNT(*) AS cnt
       FROM submission
       WHERE uid=? AND submitTime >= DATE_SUB(CURDATE(), INTERVAL 89 DAY)
       GROUP BY DATE_FORMAT(submitTime, '%Y-%m-%d')
       ORDER BY date`,
      [uid]
    ),
    db.query(
      'SELECT judgeResult, COUNT(*) AS cnt FROM submission WHERE uid=? GROUP BY judgeResult ORDER BY cnt DESC',
      [uid]
    ),
  ]);
  const resultStats = resultRows.map((r) => ({
    resultId: r.judgeResult,
    result: judgeRes[r.judgeResult] || `Result ${r.judgeResult}`,
    cnt: r.cnt,
  }));
  info.submissionStats = {
    heatmap: heatmap.map((r) => ({ date: r.date, cnt: r.cnt })),
    results: resultStats,
    total: resultStats.reduce((sum, r) => sum + Number(r.cnt || 0), 0),
    accepted: resultStats
      .filter((r) => r.resultId === 4)
      .reduce((sum, r) => sum + Number(r.cnt || 0), 0),
  };
  if (!req.can('user.list') && Number(req.session.uid) !== Number(info.uid)) {
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
  const { offset, limit } = paginate(req, 20);
  const filter = req.body.filter || {};
  const q = (filter.q || '').trim();
  const qLike = q ? `%${q}%` : null;
  const eventType = filter.eventType === '' || filter.eventType == null ? null : Number(filter.eventType);
  const startTime = filter.startTime ? new Date(filter.startTime) : null;
  const endTime = filter.endTime ? new Date(filter.endTime) : null;
  const eventIds = q
    ? eventList
      .map((key, id) => ({ id, key, name: eventExp[id] || '' }))
      .filter((e) => e.key.includes(q) || e.name.includes(q))
      .map((e) => e.id)
    : [];
  const qClause = eventIds.length
    ? `(a.event IN (${eventIds.map(() => '?').join(',')}) OR a.ip LIKE ? OR a.iploc LIKE ? OR a.browser LIKE ? OR a.os LIKE ? OR a.detail LIKE ?)`
    : '(a.ip LIKE ? OR a.iploc LIKE ? OR a.browser LIKE ? OR a.os LIKE ? OR a.detail LIKE ?)';
  const qValues = eventIds.length
    ? [...eventIds, qLike, qLike, qLike, qLike, qLike]
    : [qLike, qLike, qLike, qLike, qLike];
  const { where, params } = buildWhere([
    ['a.uid=?', req.session.uid],
    Number.isNaN(eventType) ? null : ['a.event=?', eventType],
    startTime && !Number.isNaN(startTime.getTime()) ? ['a.time>=?', startTime] : null,
    endTime && !Number.isNaN(endTime.getTime()) ? ['a.time<=?', endTime] : null,
    q ? [qClause, ...qValues] : null,
  ]);
  const list = await db.query(
    `SELECT a.* FROM userAudit a${where} ORDER BY a.id DESC LIMIT ?,?`,
    [...params, offset, limit]
  );
  for (const r of list) {
    r.eventExp = eventExp[r.event];
    r.event = eventList[r.event];
    r.time = Format(r.time);
  }
  const cnt = await db.one(`SELECT COUNT(*) as cnt FROM userAudit a${where}`, params);
  return ok(res, { data: list, total: cnt.cnt, eventList, eventExp });
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
