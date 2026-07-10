const db = require('../../db');
const { handler, ok } = require('../../db/util');
const config = require('../../config.json');
const { listGlobalKeys, loadEffectivePermissions } = require('../../auth/policy');
const { ensureGroupSchema } = require('../../groupSchema');
const { ensureContestRatingStorageSchema, latestRatingJoin, effectiveRatingExpr } = require('../contest/ratingStorage');

let userCompatSchemaReady = null;

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

const parseAvatarInfo = (avatarInfo) => {
  const raw = String(avatarInfo || '').trim();
  const pos = raw.indexOf(':');
  if (pos < 0) return { type: '', key: '' };
  return { type: raw.slice(0, pos), key: raw.slice(pos + 1) };
};

const sessionExpireSeconds = () => Math.floor((parseInt(config.SESSION && config.SESSION.expire, 10) || 604800000) / 1000);

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

  return ok(res, result);
});
