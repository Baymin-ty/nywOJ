const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../../db');
const { handler, fail, ok, paginate, buildWhere } = require('../../db/util');
const { Format, ip2loc, msFormat, recordEvent, eventList, eventExp, briefFormat } = require('../../static');
const config = require('../../config.json');
const { listGlobalKeys } = require('../../auth/policy');
const { sendVerificationCode } = require('../../services/mail');
const { judgeRes } = require('../../db/format');
const { ensureContestRatingStorageSchema, latestRatingJoin, effectiveRatingExpr } = require('../contest/ratingStorage');

const NAME_REGEX = /^[A-Za-z0-9\-_.#$]{3,24}$/;
const USERNAME_RULE_MESSAGE = '用户名长度应在3~24之间，可包含字母、数字和 -_.#$';
const EMAIL_REGEX = /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/;
const VERIFY_CODE_TTL_MS = 3 * 60 * 1000;
const VERIFY_CODE_RATE_LIMIT_MS = 30 * 1000;
const USER_LIST_SORTS = new Set(['acceptedProblemCount', 'rating', 'clickCnt']);
const USER_LIST_MAX_PAGE_SIZE = 100;
const DEFAULT_AVATAR = '/default-avatar.svg';
const GRAVATAR_CDN = 'https://www.gravatar.com/avatar/';
const GITHUB_AVATAR_CDN = 'https://github.com/';
const AVATAR_TYPES = new Set(['gravatar', 'qq', 'github']);
const PROFILE_TEXT_LIMITS = {
  nickname: 24,
  bio: 160,
  organization: 80,
  location: 80,
  homepageUrl: 80,
  telegram: 30,
  github: 30,
  qq: 30,
};

const preferenceObject = (key) => {
  const preference = config.preference || config.PREFERENCE || {};
  return preference[key] || preference[key && key.toUpperCase && key.toUpperCase()] || {};
};

const preferenceBoolean = (section, key, fallback) => {
  const value = preferenceObject(section)[key];
  return value === undefined ? fallback : !!value;
};

const clientServerPreference = () => ({
  misc: {
    sortUserByRating: preferenceBoolean('misc', 'sortUserByRating', false),
  },
});

let userProfileSchemaReady = null;
const ensureUserProfileSchema = () => {
  if (!userProfileSchemaReady) {
    userProfileSchemaReady = (async () => {
      for (const column of [
        { name: 'nickname', ddl: "VARCHAR(24) NOT NULL DEFAULT ''" },
        { name: 'bio', ddl: "VARCHAR(160) NOT NULL DEFAULT ''" },
        { name: 'publicEmail', ddl: 'TINYINT NOT NULL DEFAULT 0' },
        { name: 'avatarInfo', ddl: "VARCHAR(128) NOT NULL DEFAULT ''" },
        { name: 'organization', ddl: "VARCHAR(80) NOT NULL DEFAULT ''" },
        { name: 'location', ddl: "VARCHAR(80) NOT NULL DEFAULT ''" },
        { name: 'homepageUrl', ddl: "VARCHAR(80) NOT NULL DEFAULT ''" },
        { name: 'telegram', ddl: "VARCHAR(30) NOT NULL DEFAULT ''" },
        { name: 'github', ddl: "VARCHAR(30) NOT NULL DEFAULT ''" },
      ]) {
        const row = await db.one(
          `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='userInfo' AND COLUMN_NAME=?`,
          [column.name]
        );
        if (!row || !row.cnt) {
          await db.query(`ALTER TABLE userInfo ADD COLUMN ${column.name} ${column.ddl}`);
        }
      }
    })();
  }
  return userProfileSchemaReady;
};

let userStatsSchemaReady = null;
const ensureUserStatsSchema = () => {
  if (!userStatsSchemaReady) {
    userStatsSchemaReady = (async () => {
      for (const column of [
        { name: 'acceptedProblemCount', ddl: 'INT NOT NULL DEFAULT 0' },
      ]) {
        const row = await db.one(
          `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='userInfo' AND COLUMN_NAME=?`,
          [column.name]
        );
        if (!row || !row.cnt) {
          await db.query(`ALTER TABLE userInfo ADD COLUMN ${column.name} ${column.ddl}`);
        }
      }
    })();
  }
  return userStatsSchemaReady;
};

let userRatingHistorySchemaReady = null;
const ensureUserRatingHistorySchema = () => {
  if (!userRatingHistorySchemaReady) {
    userRatingHistorySchemaReady = (async () => {
      await ensureUserStatsSchema();
      await ensureContestRatingStorageSchema();
    })();
  }
  return userRatingHistorySchemaReady;
};

const acceptedProblemCountExpr = (uidSql = 'u.uid') =>
  `(SELECT COUNT(DISTINCT s.pid) FROM submission s WHERE s.uid=${uidSql} AND s.judgeResult=4)`;

const publicRatingSelect = (alias = 'u', latestAlias = 'latestRating') =>
  `${effectiveRatingExpr(alias, latestAlias)} AS rating,` +
  `${alias}.rating AS cachedRating,` +
  `COALESCE(${latestAlias}.newRating,0) AS historyRating,` +
  `(COALESCE(${alias}.rating,0)<>COALESCE(${latestAlias}.newRating,0)) AS ratingCacheMismatch`;

const rankCacheValue = async (cache, key, loader) => {
  if (!cache.has(key)) cache.set(key, await loader());
  return cache.get(key);
};

const attachUserLeaderboardRanks = async (rows, sortBy) => {
  const acceptedRankCache = new Map();
  const ratingRankCache = new Map();
  const clickRankCache = new Map();
  await Promise.all(rows.map(async (row) => {
    const accepted = Number(row.acceptedProblemCount || 0);
    const rating = Number(row.rating || 0);
    const clickCnt = Number(row.clickCnt || 0);
    const acceptedAhead = await rankCacheValue(acceptedRankCache, accepted, async () =>
      Number((await db.one(
        `SELECT COUNT(*) AS cnt FROM userInfo u WHERE u.inUse=1 AND ${acceptedProblemCountExpr('u.uid')} > ?`,
        [accepted]
      ))?.cnt || 0)
    );
    row.acceptedRank = acceptedAhead + 1;
    if (rating > 0) {
      const ratingAhead = await rankCacheValue(ratingRankCache, rating, async () =>
        Number((await db.one(
          `SELECT COUNT(*) AS cnt
             FROM userInfo u ${latestRatingJoin('u')}
            WHERE u.inUse=1 AND ${effectiveRatingExpr('u')} > ?`,
          [rating]
        ))?.cnt || 0)
      );
      row.ratingRank = ratingAhead + 1;
    } else {
      row.ratingRank = null;
    }
    const clickAhead = await rankCacheValue(clickRankCache, clickCnt, async () =>
      Number((await db.one(
        'SELECT COUNT(*) AS cnt FROM userInfo u WHERE u.inUse=1 AND COALESCE(u.clickCnt,0) > ?',
        [clickCnt]
      ))?.cnt || 0)
    );
    row.clickRank = clickAhead + 1;
    if (sortBy === 'rating') row.rank = row.ratingRank;
    else if (sortBy === 'clickCnt') row.rank = row.clickRank;
    else row.rank = row.acceptedRank;
  }));
};

const publicUserMetaSelect = () =>
  `u.uid,u.name,u.nickname,u.bio,u.qq,u.avatarInfo,u.motto,u.reg_time,u.clickCnt,${publicRatingSelect('u')},${acceptedProblemCountExpr('u.uid')} AS acceptedProblemCount`;

const md5 = (value) => crypto.createHash('md5').update(String(value || '').trim().toLowerCase()).digest('hex');

const parseAvatarInfo = (avatarInfo) => {
  const raw = String(avatarInfo || '').trim();
  const pos = raw.indexOf(':');
  const type = pos >= 0 ? raw.slice(0, pos) : '';
  const key = pos >= 0 ? raw.slice(pos + 1) : raw;
  if (!AVATAR_TYPES.has(type)) return { type: '', key: '' };
  return { type, key };
};

const avatarUrl = ({ type, key }, size = 160) => {
  if (!type || !key) return DEFAULT_AVATAR;
  if (type === 'qq') {
    const qqSize = size <= 40 ? 1 : size <= 100 ? 3 : size <= 140 ? 4 : 5;
    return `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(key)}&s=${qqSize}`;
  }
  if (type === 'github') return `${GITHUB_AVATAR_CDN}${encodeURIComponent(key)}.png?size=${size}`;
  if (type === 'gravatar') return `${GRAVATAR_CDN}${encodeURIComponent(key)}?s=${size}&d=404`;
  return DEFAULT_AVATAR;
};

const resolveAvatar = (user, size = 160) => {
  let avatar = parseAvatarInfo(user && user.avatarInfo);
  if (!avatar.type && user && user.qq) avatar = { type: 'qq', key: String(user.qq) };
  return {
    type: avatar.type || 'default',
    key: avatar.key || '',
    url: avatarUrl(avatar, size),
  };
};

const userLookupFromBody = (body, alias = '') => {
  const prefix = alias ? `${alias}.` : '';
  const uid = Number(body && (body.uid || body.userId));
  if (Number.isInteger(uid) && uid > 0) return { where: `${prefix}uid=?`, params: [uid] };
  const username = String((body && (body.username || body.name)) || '').trim();
  if (username) return { where: `${prefix}name=?`, params: [username] };
  return null;
};

const decoratePublicUserMeta = (user, rank) => {
  const avatar = resolveAvatar(user, 80);
  user.avatarInfo = avatar.type === 'default' ? '' : `${avatar.type}:${avatar.key}`;
  user.avatarType = avatar.type;
  user.avatarKey = avatar.key;
  user.avatar = avatar.url;
  user.rating = Number(user.rating || 0);
  user.cachedRating = Number(user.cachedRating || 0);
  user.historyRating = Number(user.historyRating || 0);
  user.ratingCacheMismatch = !!Number(user.ratingCacheMismatch || 0);
  user.acceptedProblemCount = Number(user.acceptedProblemCount || 0);
  user.clickCnt = Number(user.clickCnt || 0);
  user.reg_time = user.reg_time ? briefFormat(user.reg_time) : '';
  if (rank != null) user.rank = rank;
  return user;
};

const trimLimited = (value, limit) => String(value || '').trim().slice(0, limit);

const normalizePublicEmail = (value) => value === true || value === 1 || value === '1';

const normalizeProfileFields = (info) => {
  const profile = {};
  for (const [key, limit] of Object.entries(PROFILE_TEXT_LIMITS)) {
    profile[key] = trimLimited(info && info[key], limit);
  }
  if (profile.homepageUrl && !/^https?:\/\//i.test(profile.homepageUrl)) {
    profile.homepageUrl = `https://${profile.homepageUrl}`;
  }
  if (profile.homepageUrl && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(profile.homepageUrl)) {
    return { error: '个人网址格式错误' };
  }
  if (profile.telegram && !/^[A-Za-z0-9_]{5,30}$/.test(profile.telegram)) {
    return { error: 'Telegram 用户名格式错误' };
  }
  if (profile.github && !/^[A-Za-z0-9-]{1,30}$/.test(profile.github)) {
    return { error: 'GitHub 用户名格式错误' };
  }
  if (profile.qq && !/^\d{4,30}$/.test(profile.qq)) {
    return { error: 'QQ 号格式错误' };
  }
  profile.publicEmail = normalizePublicEmail(info && info.publicEmail);
  return { data: profile };
};

const normalizeAvatarInfo = (info, current = {}) => {
  const hasAvatarInput = info && (
    info.avatarInfo !== undefined ||
    info.avatarType !== undefined ||
    info.avatarKey !== undefined
  );
  if (!hasAvatarInput) return { data: String(current.avatarInfo || '') };

  let type = '';
  let key = '';
  if (info.avatarInfo !== undefined) {
    const parsed = parseAvatarInfo(info.avatarInfo);
    type = parsed.type;
    key = parsed.key;
  } else {
    type = String(info.avatarType || '').trim();
    key = String(info.avatarKey || '').trim();
  }
  if (!AVATAR_TYPES.has(type)) return { error: '头像类型错误' };

  if (type === 'qq' && !key) key = String(info.qq || current.qq || '').trim();
  if (type === 'github' && !key) key = String(info.github || current.github || '').trim();
  if (type === 'gravatar') {
    key = key || current.email || '';
    if (!/^[a-f0-9]{32}$/i.test(key)) key = md5(key);
  }

  if (type === 'qq' && key && !/^\d{4,30}$/.test(key)) return { error: 'QQ 头像账号格式错误' };
  if (type === 'github' && key && !/^[A-Za-z0-9-]{1,39}$/.test(key)) return { error: 'GitHub 头像用户名格式错误' };
  if (type !== 'gravatar' && !key) return { error: '请填写头像账号' };
  return { data: `${type}:${key}` };
};

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
  await ensureUserProfileSchema();
  await ensureUserStatsSchema();
  const { name, pwd, rePwd } = req.body;
  const verified = req.session.verifiedEmail;
  if (!verified || !verified.email) return fail(res, '请先验证邮箱');
  if (Date.now() > verified.expire) return fail(res, '操作超时，请重新绑定邮箱');
  if (!name || !pwd || !rePwd) return fail(res, '请确认信息完善');
  if (!NAME_REGEX.test(name)) return fail(res, USERNAME_RULE_MESSAGE);
  if (pwd.length > 31 || pwd.length < 6) return fail(res, '密码长度应在6~31之间');
  if (pwd !== rePwd) return fail(res, '两次输入的密码不一致');

  const exist = await db.exists('SELECT uid FROM userInfo WHERE name=?', [name]);
  if (exist) return fail(res, '此用户名已被注册');

  const password = bcrypt.hashSync(pwd, 12);
  const r = await db.query(
    'INSERT INTO userInfo(name,pwd,reg_time,email,acceptedProblemCount,rating) values (?,?,?,?,0,0)',
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
  await ensureUserProfileSchema();
  if (!req.session.uid) return fail(res, '请先登录');
  const user = await db.one('SELECT * FROM userInfo WHERE uid=?', [req.session.uid]);
  if (!user) return fail(res, '获取用户信息错误');
  if (!user.inUse) {
    req.session.destroy();
    return fail(res, '请先登录');
  }
  req.session.name = user.name;
  req.session.email = user.email;
  req.session.avatar = resolveAvatar(user, 80).url;
  const permissions = req.perms ? listGlobalKeys(req.perms) : [];
  return ok(res, {
    uid: req.session.uid,
    name: req.session.name,
    email: req.session.email,
    ip: req.session.ip,
    avatar: req.session.avatar,
	    permissions,
	    serverPreference: clientServerPreference(),
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

exports.checkAvailability = handler(async (req, res) => {
  const source = req.method === 'GET' ? req.query : req.body;
  const result = {};
  if (source.username != null || source.name != null) {
    const username = String(source.username != null ? source.username : source.name).trim();
    result.usernameAvailable = NAME_REGEX.test(username) &&
      !(await db.exists('SELECT uid FROM userInfo WHERE name=?', [username]));
  }
  if (source.email != null) {
    const email = normalizeEmail(source.email);
    result.emailAvailable = EMAIL_REGEX.test(email) &&
      !(await db.exists('SELECT uid FROM userInfo WHERE email=?', [email]));
  }
  return ok(res, result);
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
  await ensureUserProfileSchema();
  await ensureUserRatingHistorySchema();
  const lookup = userLookupFromBody(req.body, 'u');
  if (!lookup) return fail(res, '请确认信息完善');
  const info = await db.one(
    `SELECT u.uid,u.name,u.email,u.publicEmail,u.avatarInfo,u.nickname,u.bio,u.organization,u.location,u.homepageUrl,
            u.telegram,u.github,u.reg_time,u.login_time,u.clickCnt,u.inUse,u.motto,u.qq,
            ${publicRatingSelect('u')},
            ${acceptedProblemCountExpr('u.uid')} AS acceptedProblemCount
       FROM userInfo u ${latestRatingJoin('u')}
      WHERE ${lookup.where}
      LIMIT 1`,
    lookup.params
  );
  if (!info) return fail(res, '无此用户');
  const uid = info.uid;
  const avatar = resolveAvatar(info, 230);
  info.avatar = avatar.url;
  info.avatarType = avatar.type;
  info.avatarKey = avatar.key;
  info.avatarInfo = avatar.type === 'default' ? '' : `${avatar.type}:${avatar.key}`;
  if (info.reg_time) info.reg_time = briefFormat(info.reg_time);
  if (info.login_time) info.login_time = briefFormat(info.login_time);
  // Roles attached so the profile page can decorate the user (badges, name color).
  info.roles = await db.column(
    'SELECT r.`key` AS k FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.uid=?',
    [uid],
    'k'
  );
  const [heatmap, resultRows, levelRows, tagRows, contestTakePart] = await Promise.all([
    db.query(
      `SELECT DATE_FORMAT(submitTime, '%Y-%m-%d') AS date, COUNT(*) AS cnt
       FROM submission
       WHERE uid=? AND submitTime >= DATE_SUB(CURDATE(), INTERVAL 364 DAY)
       GROUP BY DATE_FORMAT(submitTime, '%Y-%m-%d')
       ORDER BY date`,
      [uid]
    ),
    db.query(
      'SELECT judgeResult, COUNT(*) AS cnt FROM submission WHERE uid=? GROUP BY judgeResult ORDER BY cnt DESC',
      [uid]
    ),
    db.query(
      `SELECT p.level, COUNT(DISTINCT p.pid) AS solved
         FROM submission s INNER JOIN problem p ON p.pid=s.pid
        WHERE s.uid=? AND s.judgeResult=4
        GROUP BY p.level ORDER BY p.level`,
      [uid]
    ),
    db.query(
      `SELECT JSON_UNQUOTE(jt.value) AS tag,
              COUNT(DISTINCT s.pid) AS tried,
              COUNT(DISTINCT IF(s.judgeResult=4, s.pid, NULL)) AS solved
         FROM submission s
         INNER JOIN problem p ON p.pid=s.pid
         JOIN JSON_TABLE(p.tags, '$[*]' COLUMNS (value JSON PATH '$')) AS jt
        WHERE s.uid=? AND JSON_VALID(p.tags)
        GROUP BY JSON_UNQUOTE(jt.value)
        ORDER BY tried DESC, solved DESC
        LIMIT 12`,
      [uid]
    ),
    db.one(
      `SELECT COUNT(DISTINCT c.cid) AS cnt
         FROM contest c INNER JOIN submission s ON s.cid=c.cid
        WHERE s.uid=? AND c.done=1`,
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
    levels: levelRows.map((r) => ({ level: r.level, solved: r.solved })),
    tags: tagRows.map((r) => ({
      tag: r.tag,
      tried: Number(r.tried || 0),
      solved: Number(r.solved || 0),
      rate: Number(r.tried || 0) ? Math.round(Number(r.solved || 0) * 100 / Number(r.tried || 0)) : 0,
    })),
    total: resultStats.reduce((sum, r) => sum + Number(r.cnt || 0), 0),
    accepted: resultStats
      .filter((r) => r.resultId === 4)
      .reduce((sum, r) => sum + Number(r.cnt || 0), 0),
  };
  info.contestTakePartCount = Number(contestTakePart && contestTakePart.cnt || 0);
  info.acceptedRank = 1 + Number((await db.one(
    `SELECT COUNT(*) AS cnt FROM userInfo u WHERE u.inUse=1 AND ${acceptedProblemCountExpr('u.uid')} > ?`,
    [info.acceptedProblemCount || 0]
  ))?.cnt || 0);
  info.rank = info.acceptedRank;
  info.rating = Number(info.rating || 0);
  info.cachedRating = Number(info.cachedRating || 0);
  info.historyRating = Number(info.historyRating || 0);
  info.ratingCacheMismatch = !!Number(info.ratingCacheMismatch || 0);
  info.ratingRank = Number(info.rating || 0) > 0
    ? 1 + Number((await db.one(
      `SELECT COUNT(*) AS cnt
         FROM userInfo u ${latestRatingJoin('u')}
        WHERE u.inUse=1 AND ${effectiveRatingExpr('u')} > ?`,
      [info.rating || 0]
    ))?.cnt || 0)
    : null;
  if (!req.can('user.manage') && !req.can('user.role.admin') && Number(req.session.uid) !== Number(info.uid)) {
    delete info.login_time;
    if (!info.publicEmail) delete info.email;
  }
  return ok(res, { info });
});

exports.getUserMeta = handler(async (req, res) => {
  await ensureUserProfileSchema();
  await ensureUserRatingHistorySchema();
  const lookup = userLookupFromBody(req.body, 'u');
  if (!lookup) return fail(res, '请确认信息完善');
  const meta = await db.one(
    `SELECT ${publicUserMetaSelect()} FROM userInfo u ${latestRatingJoin('u')} WHERE ${lookup.where} LIMIT 1`,
    lookup.params
  );
  if (!meta) return fail(res, '无此用户');
  return ok(res, { meta: decoratePublicUserMeta(meta) });
});

exports.searchUser = handler(async (req, res) => {
  await ensureUserProfileSchema();
  await ensureUserRatingHistorySchema();
  const source = req.method === 'GET' ? req.query : req.body;
  const query = String(source.query || source.q || '').trim();
  const limit = Math.min(Math.max(Number(source.limit) || 20, 1), 50);
  if (!query) return ok(res, { data: [], userMetas: [] });
  const pattern = source.wildcard === false || source.wildcard === 'false'
    ? `${query}%`
    : `%${query}%`;
  const users = await db.query(
    `SELECT ${publicUserMetaSelect()}
       FROM userInfo u ${latestRatingJoin('u')}
      WHERE u.inUse=1 AND (u.name LIKE ? OR u.nickname LIKE ?)
      ORDER BY u.name LIKE ? DESC, ${acceptedProblemCountExpr('u.uid')} DESC, u.uid ASC
      LIMIT ?`,
    [pattern, pattern, `${query}%`, limit]
  );
  users.forEach((u) => decoratePublicUserMeta(u));
  return ok(res, { data: users, userMetas: users });
});

exports.getUserList = handler(async (req, res) => {
  await ensureUserProfileSchema();
  await ensureUserRatingHistorySchema();
  const pageSize = Math.min(Number(req.body.pageSize) || 50, USER_LIST_MAX_PAGE_SIZE);
  const { offset, limit } = paginate({ body: { ...req.body, pageSize } }, 50);
  const sortBy = USER_LIST_SORTS.has(req.body.sortBy) ? req.body.sortBy : 'acceptedProblemCount';
  const acceptedExpr = acceptedProblemCountExpr('u.uid');
  const orderExpr = sortBy === 'rating'
    ? `rating DESC,${acceptedExpr} DESC,u.uid ASC`
    : sortBy === 'clickCnt'
      ? `COALESCE(u.clickCnt,0) DESC,${acceptedExpr} DESC,rating DESC,u.uid ASC`
      : `acceptedProblemCount DESC,rating DESC,u.uid ASC`;
  const data = await db.query(
    `SELECT ${publicUserMetaSelect()} FROM userInfo u ${latestRatingJoin('u')} WHERE u.inUse=1 ORDER BY ${orderExpr} LIMIT ?,?`,
    [offset, limit]
  );
  const total = await db.one('SELECT COUNT(*) AS total FROM userInfo WHERE inUse=1');
  await attachUserLeaderboardRanks(data, sortBy);
  for (let i = 0; i < data.length; i++) {
    decoratePublicUserMeta(data[i], data[i].rank);
  }
  return ok(res, { data, total: total.total, sortBy });
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
  await ensureUserProfileSchema();
  const info = req.body.userInfo || {};
  const normalizedProfile = normalizeProfileFields(info);
  if (normalizedProfile.error) return fail(res, normalizedProfile.error);
  const profile = normalizedProfile.data;
  const before = await db.one(
    'SELECT email,qq,motto,publicEmail,avatarInfo,nickname,bio,organization,location,homepageUrl,telegram,github FROM userInfo WHERE uid=?',
    [req.session.uid]
  );
  if (!before) return fail(res, '请先登录');
  const normalizedAvatar = normalizeAvatarInfo(info, before);
  if (normalizedAvatar.error) return fail(res, normalizedAvatar.error);
  const avatarInfo = normalizedAvatar.data;
  await db.query(
    'UPDATE userInfo SET qq=?,motto=?,publicEmail=?,avatarInfo=?,nickname=?,bio=?,organization=?,location=?,homepageUrl=?,telegram=?,github=? WHERE uid=?',
    [
      profile.qq,
      String(info.motto || '').slice(0, 1000),
      profile.publicEmail ? 1 : 0,
      avatarInfo,
      profile.nickname,
      profile.bio,
      profile.organization,
      profile.location,
      profile.homepageUrl,
      profile.telegram,
      profile.github,
      req.session.uid,
    ]
  );
  req.session.avatar = resolveAvatar({ avatarInfo, qq: profile.qq }, 80).url;
  const detail = {};
  const nextForAudit = {
    qq: profile.qq,
    motto: String(info.motto || '').slice(0, 1000),
    publicEmail: profile.publicEmail ? 1 : 0,
    avatarInfo,
    nickname: profile.nickname,
    bio: profile.bio,
    organization: profile.organization,
    location: profile.location,
    homepageUrl: profile.homepageUrl,
    telegram: profile.telegram,
    github: profile.github,
  };
  for (const key of Object.keys(nextForAudit)) {
    if (before && before[key] !== nextForAudit[key]) detail[key] = { old: before[key], new: nextForAudit[key] };
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
