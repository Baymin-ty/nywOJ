const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../../db');
const { handler, ok } = require('../../db/util');
const config = require('../../config.json');
const { listGlobalKeys, loadEffectivePermissions } = require('../../auth/policy');
const { ensureGroupSchema } = require('../../groupSchema');
const { ip2loc, recordEvent } = require('../../static');
const { sendVerificationCode } = require('../../services/mail');
const { ensureContestRatingStorageSchema, latestRatingJoin, effectiveRatingExpr } = require('../contest/ratingStorage');

const NAME_REGEX = /^[A-Za-z0-9\-_.#$]{3,24}$/;
const EMAIL_REGEX = /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/;
const DEFAULT_AVATAR = '/default-avatar.svg';
const EMAIL_VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000;
const EMAIL_VERIFICATION_RATE_LIMIT_MS = 60 * 1000;
const EMAIL_VERIFICATION_PURPOSE = {
  Register: 'bindEmail',
  ChangeEmail: 'changeEmail',
  ResetPassword: 'resetPassword',
};

let userCompatSchemaReady = null;
let userMigrationSchemaReady = null;
const emailVerificationLastSent = Object.create(null);

const ensureUserCompatSchema = () => {
  if (!userCompatSchemaReady) {
    userCompatSchemaReady = (async () => {
      for (const column of [
        { name: 'avatarInfo', ddl: "VARCHAR(128) NOT NULL DEFAULT ''" },
        { name: 'nickname', ddl: "VARCHAR(24) NOT NULL DEFAULT ''" },
        { name: 'bio', ddl: "VARCHAR(160) NOT NULL DEFAULT ''" },
        { name: 'publicEmail', ddl: 'TINYINT NOT NULL DEFAULT 0' },
        { name: 'acceptedProblemCount', ddl: 'INT NOT NULL DEFAULT 0' },
        { name: 'rating', ddl: 'INT NOT NULL DEFAULT 0' },
      ]) {
        const row = await db.one(
          `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='userInfo' AND COLUMN_NAME=?`,
          [column.name]
        );
        if (!row || !row.cnt) await db.query(`ALTER TABLE userInfo ADD COLUMN ${column.name} ${column.ddl}`);
      }
      await db.query(`
        CREATE TABLE IF NOT EXISTS user_privilege (
          userId INT NOT NULL,
          privilegeType VARCHAR(40) NOT NULL,
          PRIMARY KEY (userId, privilegeType),
          KEY idx_privilege (privilegeType)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await ensureContestRatingStorageSchema();
    })();
  }
  return userCompatSchemaReady;
};

const ensureUserMigrationSchema = () => {
  if (!userMigrationSchemaReady) {
    userMigrationSchemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS user_migration_info (
        userId INT NOT NULL PRIMARY KEY,
        oldUsername VARCHAR(80) NOT NULL,
        oldEmail VARCHAR(120) NOT NULL DEFAULT '',
        oldPasswordHashBcrypt CHAR(60) NOT NULL,
        usernameMustChange TINYINT NOT NULL DEFAULT 0,
        migrated TINYINT NOT NULL DEFAULT 0,
        UNIQUE KEY idx_old_username (oldUsername),
        KEY idx_old_email (oldEmail),
        KEY idx_migrated (migrated)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
  return userMigrationSchemaReady;
};

const normalizeEmail = (email) => String(email || '').trim();
const normalizeUsername = (username) => String(username || '').trim();
const enumError = (res, error, extra = {}) => ok(res, { error, ...extra });

const generateEmailVerificationCode = () => {
  let code = '';
  for (let i = 0; i < 6; i++) code += String(crypto.randomInt(10));
  return code;
};

const emailVerificationRateKey = (email) => normalizeEmail(email).toLowerCase();

const checkEmailVerificationRateLimit = (email) => {
  const key = emailVerificationRateKey(email);
  const last = emailVerificationLastSent[key];
  if (!last) return false;
  return Date.now() - last < EMAIL_VERIFICATION_RATE_LIMIT_MS;
};

const markEmailVerificationRateLimit = (email) => {
  emailVerificationLastSent[emailVerificationRateKey(email)] = Date.now();
};

const hashOldPassword = (oldPassword) =>
  crypto.createHash('md5').update(`${oldPassword || ''}syzoj2_xxx`).digest('hex').toLowerCase();

const findLoginMigrationInfo = async ({ oldUsername, userId }) => {
  await ensureUserMigrationSchema();
  const username = String(oldUsername || '').trim();
  if (username) return db.one('SELECT * FROM user_migration_info WHERE oldUsername=? LIMIT 1', [username]);
  const uid = Number(userId) || 0;
  if (!uid) return null;
  return db.one('SELECT * FROM user_migration_info WHERE userId=? LIMIT 1', [uid]);
};

const sendNotMigratedLogin = async (req, res, migrationInfo, password) => {
  if (!migrationInfo || migrationInfo.migrated) return false;
  if (!bcrypt.compareSync(hashOldPassword(password), migrationInfo.oldPasswordHashBcrypt)) {
    recordEvent(req, 'user.loginFail.wrongPassword', null, migrationInfo.userId);
    enumError(res, 'WRONG_PASSWORD');
    return true;
  }
  ok(res, { error: 'USER_NOT_MIGRATED', username: migrationInfo.oldUsername });
  return true;
};

const updatePasswordForUserOrMigration = async (user, newPassword) => {
  const migrationInfo = await findLoginMigrationInfo({ userId: user.uid });
  if (migrationInfo && !migrationInfo.migrated) {
    const oldPasswordHashBcrypt = bcrypt.hashSync(hashOldPassword(newPassword), 10);
    await db.query('UPDATE user_migration_info SET oldPasswordHashBcrypt=? WHERE userId=?', [
      oldPasswordHashBcrypt,
      user.uid,
    ]);
    return;
  }
  const hashed = bcrypt.hashSync(newPassword, 12);
  await db.query('UPDATE userInfo SET pwd=? WHERE uid=?', [hashed, user.uid]);
};

const parseAvatarInfo = (avatarInfo) => {
  const raw = String(avatarInfo || '').trim();
  const pos = raw.indexOf(':');
  if (pos < 0) return { type: '', key: '' };
  return { type: raw.slice(0, pos), key: raw.slice(pos + 1) };
};

const avatarUrl = (user, size = 80) => {
  let avatar = parseAvatarInfo(user && user.avatarInfo);
  if (!avatar.type && user && user.qq) avatar = { type: 'qq', key: String(user.qq) };
  if (avatar.type === 'qq' && avatar.key) {
    const qqSize = size <= 40 ? 1 : size <= 100 ? 3 : size <= 140 ? 4 : 5;
    return `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(avatar.key)}&s=${qqSize}`;
  }
  if (avatar.type === 'github' && avatar.key) return `https://github.com/${encodeURIComponent(avatar.key)}.png?size=${size}`;
  if (avatar.type === 'gravatar' && avatar.key) {
    return `https://www.gravatar.com/avatar/${encodeURIComponent(avatar.key)}?s=${size}&d=404`;
  }
  return DEFAULT_AVATAR;
};

const sessionExpireSeconds = () => Math.floor((parseInt(config.SESSION && config.SESSION.expire, 10) || 604800000) / 1000);

const browserText = (req) => {
  const browser = (req.useragent && req.useragent.browser) || {};
  return `${browser.name || 'unknown'} ${browser.version || ''}`.trim();
};

const osText = (req) => {
  const os = (req.useragent && req.useragent.os) || {};
  return `${os.name || 'unknown'} ${os.version || ''}`.trim();
};

const startLoginSession = async (req, user) => {
  req.session.uid = user.uid;
  req.session.name = user.name;
  req.session.email = user.email;
  const now = new Date();
  await db.query('UPDATE userInfo SET login_time=? WHERE uid=?', [now, user.uid]);
  await db.query(
    'INSERT INTO userSession(uid,token,browser,os,loginIp,loginLoc,time,lastact) values (?,?,?,?,?,?,?,?)',
    [
      user.uid,
      req.sessionID,
      browserText(req),
      osText(req),
      req.session.ip || req.ip || '',
      ip2loc(req.session.ip || req.ip || ''),
      now,
      now,
    ]
  );
  recordEvent(req, 'user.login');
};

const revokeAllSessions = async (uid, curToken) => {
  const sessions = await db.query(
    'SELECT token FROM userSession WHERE uid=? AND TIMESTAMPDIFF(SECOND,time,NOW()) < ? AND time != ?',
    [uid, sessionExpireSeconds(), new Date(0)]
  );
  const tokens = sessions.map((s) => s.token).filter((token) => token && token !== curToken);
  if (!tokens.length) return;
  await db.query('UPDATE sessions SET expires=? WHERE session_id in(?)', [0, tokens]);
  await db.query('UPDATE userSession SET time=? WHERE token in(?)', [new Date(0), tokens]);
};

const toMillis = (value) => {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

const activeSessionRows = (uid) =>
  db.query(
    'SELECT id,token,browser,os,loginIp,loginLoc,time,lastact FROM userSession ' +
      'WHERE uid=? AND TIMESTAMPDIFF(SECOND,lastact,NOW()) < ? AND time != ? ORDER BY lastact DESC',
    [uid, sessionExpireSeconds(), new Date(0)]
  );

const uidFromSessionInfoToken = async (req) => {
  if (req.session && req.session.uid) return Number(req.session.uid) || 0;
  const token = String((req.query && req.query.token) || '').trim();
  if (!token) return 0;
  const row = await db.one(
    `SELECT us.uid
       FROM userSession us
       INNER JOIN userInfo u ON u.uid=us.uid
      WHERE us.token=? AND TIMESTAMPDIFF(SECOND,us.lastact,NOW()) < ? AND us.time != ? AND u.inUse=1
      LIMIT 1`,
    [token, sessionExpireSeconds(), new Date(0)]
  );
  if (!row) return 0;
  await db.query('UPDATE userSession SET lastact=? WHERE uid=? AND token=?', [new Date(), row.uid, token]);
  return Number(row.uid) || 0;
};

const canManageUser = (req) => req.can && (req.can('user.manage') || req.can('user.role.admin'));

const preferenceSecurityFlag = (key, fallback) => {
  const security =
    (config.preference && config.preference.security) ||
    (config.PREFERENCE && config.PREFERENCE.security) ||
    (config.PREFERENCE && config.PREFERENCE.SECURITY) ||
    {};
  if (Object.prototype.hasOwnProperty.call(security, key)) return !!security[key];
  return fallback;
};

const requireEmailVerification = () => preferenceSecurityFlag('requireEmailVerification', true);

const allowUserChangeUsername = () => preferenceSecurityFlag('allowUserChangeUsername', true);

const preferenceObject = (key) => {
  const preference = config.preference || config.PREFERENCE || {};
  return preference[key] || preference[key && key.toUpperCase && key.toUpperCase()] || {};
};

const preferenceNumber = (section, key, fallback) => {
  const value = preferenceObject(section)[key];
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const preferenceBoolean = (section, key, fallback) => {
  const value = preferenceObject(section)[key];
  return value == null ? fallback : !!value;
};

const preferenceString = (section, key, fallback) => {
  const value = preferenceObject(section)[key];
  return value == null ? fallback : String(value);
};

const authType = (type) => {
  const value = String(type || '').trim();
  if (value === 'Register' || value === 'register' || value === 'bindEmail') return 'Register';
  if (value === 'ChangeEmail' || value === 'changeEmail') return 'ChangeEmail';
  if (value === 'ResetPassword' || value === 'resetPassword') return 'ResetPassword';
  return '';
};

const serverPreference = () => ({
  siteName: (config.EVENT_REPORT && config.EVENT_REPORT.siteName) || config.SITE_NAME || 'nywOJ',
  security: {
    requireEmailVerification: requireEmailVerification(),
    allowUserChangeUsername: allowUserChangeUsername(),
    recaptchaEnabled: preferenceSecurityFlag('recaptchaEnabled', false),
    recaptchaKey: preferenceString('security', 'recaptchaKey', ''),
    allowEveryoneCreateProblem: preferenceSecurityFlag('allowEveryoneCreateProblem', true),
    allowNonPrivilegedUserEditPublicProblem: preferenceSecurityFlag('allowNonPrivilegedUserEditPublicProblem', true),
    allowOwnerManageProblemPermission: preferenceSecurityFlag('allowOwnerManageProblemPermission', false),
    allowOwnerDeleteProblem: preferenceSecurityFlag('allowOwnerDeleteProblem', true),
    allowEveryoneCreateDiscussion: preferenceSecurityFlag('allowEveryoneCreateDiscussion', true),
    discussionDefaultPublic: preferenceSecurityFlag('discussionDefaultPublic', true),
    discussionReplyDefaultPublic: preferenceSecurityFlag('discussionReplyDefaultPublic', true),
  },
  pagination: {
    homepageUserList: preferenceNumber('pagination', 'homepageUserList', 10),
    homepageProblemList: preferenceNumber('pagination', 'homepageProblemList', 10),
    problemSet: preferenceNumber('pagination', 'problemSet', 50),
    searchProblemsPreview: preferenceNumber('pagination', 'searchProblemsPreview', 7),
    submissions: preferenceNumber('pagination', 'submissions', 10),
    submissionStatistics: preferenceNumber('pagination', 'submissionStatistics', 10),
    userList: preferenceNumber('pagination', 'userList', 30),
    userAuditLogs: preferenceNumber('pagination', 'userAuditLogs', 10),
    discussions: preferenceNumber('pagination', 'discussions', 10),
    searchDiscussionsPreview: preferenceNumber('pagination', 'searchDiscussionsPreview', 7),
    discussionReplies: preferenceNumber('pagination', 'discussionReplies', 40),
    discussionRepliesHead: preferenceNumber('pagination', 'discussionRepliesHead', 20),
    discussionRepliesMore: preferenceNumber('pagination', 'discussionRepliesMore', 20),
  },
  misc: {
    appLogo: preferenceString('misc', 'appLogo', 'default'),
    appLogoForTheme: preferenceObject('misc').appLogoForTheme || { pure: 'original', far: 'inverted' },
    googleAnalyticsId: preferenceObject('misc').googleAnalyticsId || null,
    plausibleApiEndpoint: preferenceObject('misc').plausibleApiEndpoint || null,
    gravatarCdn: preferenceString('misc', 'gravatarCdn', 'https://gravatar.com'),
    redirectOldUrls: preferenceBoolean('misc', 'redirectOldUrls', true),
    contestsEntryUrl: preferenceObject('misc').contestsEntryUrl || null,
    homepageUserListOnMainView: preferenceBoolean('misc', 'homepageUserListOnMainView', true),
    sortUserByRating: preferenceBoolean('misc', 'sortUserByRating', false),
    renderMarkdownInUserBio: preferenceBoolean('misc', 'renderMarkdownInUserBio', false),
    discussionReactionEmojis: preferenceObject('misc').discussionReactionEmojis || ['👍', '👎', '😄', '😕', '❤️', '🤔', '🤣', '🌿', '🍋', '🕊️'],
    discussionReactionAllowCustomEmojis: preferenceBoolean('misc', 'discussionReactionAllowCustomEmojis', true),
  },
});

const acceptedCountExpr = (uidSql = 'u.uid') =>
  `(SELECT COUNT(DISTINCT s.pid) FROM submission s WHERE s.uid=${uidSql} AND s.judgeResult=4)`;

const submissionCountExpr = (uidSql = 'u.uid') =>
  `(SELECT COUNT(*) FROM submission s WHERE s.uid=${uidSql})`;

const userAvatar = (user) => {
  let avatar = parseAvatarInfo(user && user.avatarInfo);
  if (!avatar.type && user && user.qq) avatar = { type: 'qq', key: String(user.qq) };
  if (!avatar.type) avatar = { type: 'qq', key: '' };
  return avatar;
};

const publicUserMeta = (user) => ({
  id: user.uid,
  uid: user.uid,
  username: user.name,
  name: user.name,
  email: user.email || '',
  nickname: user.nickname || '',
  bio: user.bio || '',
  avatar: userAvatar(user),
  isAdmin: Number(user.uid) === 1,
  acceptedProblemCount: Number(user.acceptedProblemCount || 0),
  submissionCount: Number(user.submissionCount || 0),
  rating: Number(user.rating || 0),
  registrationTime: user.reg_time || null,
});

exports.getSessionInfo = handler(async (req, res) => {
  const result = {
    serverPreference: serverPreference(),
    serverVersion: {
      hash: process.env.GIT_COMMIT || '',
      date: process.env.BUILD_DATE || '',
    },
  };

  const sessionUid = await uidFromSessionInfoToken(req);
  if (sessionUid) {
    await ensureUserCompatSchema();
    const user = await db.one(
      `SELECT u.uid,u.name,u.email,u.qq,u.avatarInfo,u.nickname,u.bio,u.reg_time,u.inUse,
              ${effectiveRatingExpr('u')} AS rating,
              ${acceptedCountExpr('u.uid')} AS acceptedProblemCount,
              ${submissionCountExpr('u.uid')} AS submissionCount
         FROM userInfo u ${latestRatingJoin('u')}
        WHERE u.uid=?`,
      [sessionUid]
    );
    if (user && user.inUse) {
      await ensureGroupSchema();
      result.userMeta = publicUserMeta(user);
      result.joinedGroupsCount = Number((await db.one(
        'SELECT COUNT(*) AS cnt FROM group_members WHERE uid=?',
        [user.uid]
      ))?.cnt || 0);
      const perms = req.session && Number(req.session.uid) === Number(user.uid) && req.perms
        ? req.perms
        : await loadEffectivePermissions(user.uid);
      result.userPrivileges = await db.column(
        'SELECT privilegeType FROM user_privilege WHERE userId=? ORDER BY privilegeType ASC',
        [user.uid],
        'privilegeType'
      );
      result.permissionKeys = perms ? listGlobalKeys(perms) : [];
    }
  }

  if (req.query && req.query.jsonp) {
    const body = `(window.getSessionInfoCallback || (function (sessionInfo) { window.sessionInfo = sessionInfo; }))(${JSON.stringify(result)});`;
    res.type('application/javascript').send(body);
    return;
  }
  return ok(res, result);
});

exports.login = handler(async (req, res) => {
  if (req.session.uid) return enumError(res, 'ALREADY_LOGGEDIN');
  const username = normalizeUsername(req.body.username || req.body.name || '');
  const email = normalizeEmail(req.body.email || '');
  const account = username || normalizeUsername(req.body.account || '');
  const password = req.body.password || req.body.pwd;
  if (!account && !email) return enumError(res, 'NO_SUCH_USER');
  if (!password) return enumError(res, 'WRONG_PASSWORD');

  const lookup = email || account;
  const isEmail = !!email || EMAIL_REGEX.test(lookup);
  const user = await db.one(
    isEmail ? 'SELECT * FROM userInfo WHERE email=? LIMIT 1' : 'SELECT * FROM userInfo WHERE name=? LIMIT 1',
    [lookup]
  );
  if (!user) {
    if (!isEmail && account) {
      const migrationInfo = await findLoginMigrationInfo({ oldUsername: account });
      if (await sendNotMigratedLogin(req, res, migrationInfo, password)) return;
    }
    return enumError(res, 'NO_SUCH_USER');
  }
  if (!user.inUse) {
    recordEvent(req, 'user.loginFail.userBlocked', null, user.uid);
    return enumError(res, 'NO_SUCH_USER');
  }
  const migrationInfo = await findLoginMigrationInfo({ userId: user.uid });
  if (await sendNotMigratedLogin(req, res, migrationInfo, password)) return;
  if (!bcrypt.compareSync(password, user.pwd)) {
    recordEvent(req, 'user.loginFail.wrongPassword', null, user.uid);
    return enumError(res, 'WRONG_PASSWORD');
  }

  await startLoginSession(req, user);
  return ok(res, { token: req.sessionID, username: user.name });
});

exports.logout = handler(async (req, res) => {
  if (req.session && req.session.uid) {
    recordEvent(req, 'user.logout');
    await db.query('UPDATE userSession SET time=? WHERE token=?', [new Date(0), req.sessionID]);
  }
  await new Promise((resolve) => req.session.destroy(() => resolve()));
  return ok(res, {});
});

exports.checkAvailability = handler(async (req, res) => {
  const source = req.method === 'GET' ? req.query : req.body;
  const result = {};
  if (source.username != null || source.name != null) {
    const username = normalizeUsername(source.username != null ? source.username : source.name);
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

exports.sendEmailVerificationCode = handler(async (req, res) => {
  const type = authType(req.body.type);
  const email = normalizeEmail(req.body.email);
  if (!type) return enumError(res, 'FAILED_TO_SEND', { errorMessage: 'Invalid email verification code type.' });
  if (!EMAIL_REGEX.test(email)) return enumError(res, 'FAILED_TO_SEND', { errorMessage: 'Invalid email address.' });

  let user = null;

  if (type === 'Register') {
    if (req.session.uid) return enumError(res, 'ALREADY_LOGGEDIN');
    const taken = await db.exists('SELECT uid FROM userInfo WHERE email=? LIMIT 1', [email]);
    if (taken) return enumError(res, 'DUPLICATE_EMAIL');
  }

  if (type === 'ChangeEmail') {
    if (!req.session.uid) return enumError(res, 'PERMISSION_DENIED');
    const taken = await db.exists('SELECT uid FROM userInfo WHERE email=? LIMIT 1', [email]);
    if (taken) return enumError(res, 'DUPLICATE_EMAIL');
  }

  if (type === 'ResetPassword') {
    if (req.session.uid) return enumError(res, 'ALREADY_LOGGEDIN');
    user = await db.one('SELECT uid,name,inUse FROM userInfo WHERE email=? LIMIT 1', [email]);
    if (!user || !user.inUse) return enumError(res, 'NO_SUCH_USER');
  }

  if (!requireEmailVerification()) {
    return enumError(res, 'FAILED_TO_SEND', { errorMessage: 'Email verification code disabled.' });
  }

  if (checkEmailVerificationRateLimit(email)) return enumError(res, 'RATE_LIMITED');

  const code = generateEmailVerificationCode();
  const purpose = EMAIL_VERIFICATION_PURPOSE[type];
  const expire = Date.now() + EMAIL_VERIFICATION_CODE_TTL_MS;
  if (type === 'ResetPassword') {
    req.session.passwordReset = { uid: user.uid, email, code, expire };
  } else {
    req.session.verifyCode = { code, expire, email, purpose };
  }
  markEmailVerificationRateLimit(email);

  try {
    await sendVerificationCode({
      to: email,
      purpose,
      code,
      name: type === 'ResetPassword' ? user.name : req.session.name,
    });
  } catch (err) {
    return enumError(res, 'FAILED_TO_SEND', { errorMessage: err && err.message ? err.message : 'Failed to send email.' });
  }

  if (type === 'ResetPassword') {
    recordEvent(req, 'auth.sendPasswordResetCode', { to: email }, user.uid);
  } else if (req.session.uid) {
    recordEvent(req, 'auth.sendEmailVerifyCode', { to: email, purpose });
  }
  return ok(res, {});
});

exports.register = handler(async (req, res) => {
  await ensureUserCompatSchema();
  if (req.session.uid) return enumError(res, 'ALREADY_LOGGEDIN');
  const name = normalizeUsername(req.body.username || req.body.name);
  const email = normalizeEmail(req.body.email);
  const code = String(req.body.emailVerificationCode || req.body.code || '').trim();
  const password = String(req.body.password || req.body.pwd || '');
  const verify = req.session.verifyCode;
  const needsEmailVerification = requireEmailVerification();

  if (!name || !NAME_REGEX.test(name)) return enumError(res, 'DUPLICATE_USERNAME');
  if (!email || !EMAIL_REGEX.test(email)) return enumError(res, 'DUPLICATE_EMAIL');
  if (needsEmailVerification) {
    if (!code || !verify || verify.email !== email || verify.purpose !== 'bindEmail') return enumError(res, 'INVALID_EMAIL_VERIFICATION_CODE');
    if (Date.now() > verify.expire) return enumError(res, 'INVALID_EMAIL_VERIFICATION_CODE');
    if (verify.code !== code) return enumError(res, 'INVALID_EMAIL_VERIFICATION_CODE');
  }
  if (password.length < 6 || password.length > 32) return enumError(res, 'INVALID_EMAIL_VERIFICATION_CODE');

  const nameTaken = await db.exists('SELECT uid FROM userInfo WHERE name=? LIMIT 1', [name]);
  if (nameTaken) return enumError(res, 'DUPLICATE_USERNAME');
  const emailTaken = await db.exists('SELECT uid FROM userInfo WHERE email=? LIMIT 1', [email]);
  if (emailTaken) return enumError(res, 'DUPLICATE_EMAIL');

  const hashed = bcrypt.hashSync(password, 12);
  const result = await db.query(
    'INSERT INTO userInfo(name,pwd,reg_time,email,acceptedProblemCount,rating) values (?,?,?,?,0,0)',
    [name, hashed, new Date(), email]
  );
  if (!result.affectedRows) return enumError(res, 'DUPLICATE_USERNAME');
  if (needsEmailVerification) req.session.verifyCode = null;
  req.session.verifiedEmail = null;

  const user = await db.one('SELECT * FROM userInfo WHERE uid=?', [result.insertId]);
  await startLoginSession(req, user);
  return ok(res, { token: req.sessionID, username: user.name });
});

exports.resetPassword = handler(async (req, res) => {
  if (req.session.uid) return enumError(res, 'ALREADY_LOGGEDIN');
  const email = normalizeEmail(req.body.email);
  const code = String(req.body.emailVerificationCode || req.body.code || '').trim();
  const newPassword = String(req.body.newPassword || req.body.pwd || '');
  const reset = req.session.passwordReset;
  if (!email || !EMAIL_REGEX.test(email)) return enumError(res, 'NO_SUCH_USER');
  if (!code || !reset || reset.email !== email) return enumError(res, 'INVALID_EMAIL_VERIFICATION_CODE');
  if (Date.now() > reset.expire) return enumError(res, 'INVALID_EMAIL_VERIFICATION_CODE');
  if (reset.code !== code) return enumError(res, 'INVALID_EMAIL_VERIFICATION_CODE');
  if (newPassword.length < 6 || newPassword.length > 32) return enumError(res, 'INVALID_EMAIL_VERIFICATION_CODE');

  const user = await db.one('SELECT * FROM userInfo WHERE uid=? AND email=? AND inUse=1', [reset.uid, email]);
  if (!user) return enumError(res, 'NO_SUCH_USER');
  await updatePasswordForUserOrMigration(user, newPassword);
  await revokeAllSessions(user.uid, null);
  recordEvent(req, 'auth.resetPasswordByEmail', { email }, user.uid);
  req.session.passwordReset = null;

  await startLoginSession(req, user);
  return ok(res, { token: req.sessionID, username: user.name });
});

exports.listUserSessions = handler(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const requestedUserId = parseInt(req.body.userId || req.body.uid || req.session.uid, 10);
  const currentUid = Number(req.session && req.session.uid) || 0;
  const isSelfRequest = username
    ? username === req.session.name
    : Number(requestedUserId) === currentUid;
  if (!isSelfRequest && !canManageUser(req)) return ok(res, { error: 'PERMISSION_DENIED' });

  const user = username
    ? await db.one('SELECT uid,name FROM userInfo WHERE name=? LIMIT 1', [username])
    : await db.one('SELECT uid,name FROM userInfo WHERE uid=? LIMIT 1', [requestedUserId]);
  if (!user) {
    return ok(res, {
      sessions: [],
      currentSessionId: null,
    });
  }

  const rows = await activeSessionRows(user.uid);
  const sessions = rows.map((row) => ({
    sessionId: Number(row.id),
    token: row.token,
    userAgent: `${row.browser || ''} ${row.os || ''}`.trim(),
    browser: row.browser,
    os: row.os,
    loginIp: row.loginIp,
    loginIpLocation: row.loginLoc || ip2loc(row.loginIp),
    loginTime: toMillis(row.time),
    lastAccessTime: toMillis(row.lastact),
    current: row.token === req.sessionID,
  }));
  const currentRow = rows.find((row) => row.token === req.sessionID);
  return ok(res, {
    sessions,
    currentSessionId: user.uid === req.session.uid && currentRow ? Number(currentRow.id) : null,
  });
});

exports.revokeUserSession = handler(async (req, res) => {
  const userId = parseInt(req.body.userId || req.body.uid, 10);
  const rawSessionId = req.body.sessionId != null ? req.body.sessionId : req.body.token;
  const sessionId = String(rawSessionId || '').trim();
  if (!userId) return ok(res, { error: canManageUser(req) ? 'NO_SUCH_USER' : 'PERMISSION_DENIED' });
  if (userId !== req.session.uid && !canManageUser(req)) return ok(res, { error: 'PERMISSION_DENIED' });
  const user = await db.one('SELECT uid FROM userInfo WHERE uid=? LIMIT 1', [userId]);
  if (!user) return ok(res, { error: 'NO_SUCH_USER' });

  if (sessionId) {
    const numericSessionId = parseInt(sessionId, 10);
    const byNumericId = Number.isSafeInteger(numericSessionId) && String(numericSessionId) === sessionId;
    const row = byNumericId
      ? await db.one('SELECT token FROM userSession WHERE uid=? AND id=? LIMIT 1', [userId, numericSessionId])
      : { token: sessionId };
    if (row && row.token) {
      await db.query('UPDATE sessions SET expires=? WHERE session_id=?', [0, row.token]);
      await db.query('UPDATE userSession SET time=? WHERE uid=? AND token=?', [new Date(0), userId, row.token]);
    }
    if (userId === req.session.uid) recordEvent(req, 'auth.revokeSession');
  } else {
    await revokeAllSessions(userId, userId === req.session.uid ? req.sessionID : null);
    if (userId === req.session.uid) recordEvent(req, 'auth.revokeAllSessions');
  }
  return ok(res, {});
});
