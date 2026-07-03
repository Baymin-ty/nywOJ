const bcrypt = require('bcryptjs');
const db = require('../../db');
const { handler, ok, fail } = require('../../db/util');
const config = require('../../config.json');
const { eventList, eventExp, ip2loc, recordEvent } = require('../../static');
const policy = require('../../auth/policy');
const { ensureContestRatingStorageSchema, latestRatingJoin, effectiveRatingExpr } = require('../contest/ratingStorage');

const NAME_REGEX = /^[A-Za-z0-9\-_.#$]{3,24}$/;
const EMAIL_REGEX = /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/;
const USER_LIST_SORTS = new Set(['acceptedProblemCount', 'rating']);
const DEFAULT_USER_SEARCH_LIMIT = 10;
const DEFAULT_USER_LIST_LIMIT = 100;
const DEFAULT_AVATAR = '/default-avatar.svg';

const PRIVILEGE_TO_PERMISSION = {
  EditHomepage: 'announcement.manage',
  ManageUser: 'user.manage',
  ManageUserGroup: 'group.manage',
  ManageProblem: 'problem.manage.any',
  ManageContest: 'contest.manage.any',
  ManageDiscussion: 'discussion.manage',
};
const USER_PRIVILEGE_TYPES = new Set([
  'EditHomepage',
  'ManageUser',
  'ManageUserGroup',
  'ManageProblem',
  'ManageContest',
  'ManageDiscussion',
  'SkipRecaptcha',
]);

let compatSchemaReady = null;

const ensureCompatSchema = () => {
  if (!compatSchemaReady) {
    compatSchemaReady = (async () => {
      const columns = [
        { name: 'nickname', ddl: "VARCHAR(24) NOT NULL DEFAULT ''" },
        { name: 'bio', ddl: "VARCHAR(160) NOT NULL DEFAULT ''" },
        { name: 'publicEmail', ddl: 'TINYINT NOT NULL DEFAULT 0' },
        { name: 'avatarInfo', ddl: "VARCHAR(128) NOT NULL DEFAULT ''" },
        { name: 'organization', ddl: "VARCHAR(80) NOT NULL DEFAULT ''" },
        { name: 'location', ddl: "VARCHAR(80) NOT NULL DEFAULT ''" },
        { name: 'homepageUrl', ddl: "VARCHAR(80) NOT NULL DEFAULT ''" },
        { name: 'telegram', ddl: "VARCHAR(30) NOT NULL DEFAULT ''" },
        { name: 'github', ddl: "VARCHAR(30) NOT NULL DEFAULT ''" },
        { name: 'acceptedProblemCount', ddl: 'INT NOT NULL DEFAULT 0' },
      ];
      for (const column of columns) {
        const row = await db.one(
          'SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
          ['userInfo', column.name]
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
  return compatSchemaReady;
};

const uidOf = (req) => (req.session && req.session.uid) || 0;

const canManageUsers = (req) => !!(req.can && (req.can('user.manage') || req.can('user.role.admin')));

const canAccessUser = (req, uid) => uidOf(req) === Number(uid) || canManageUsers(req);

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

const queryLimitNumber = (key, fallback) => {
  const section = config.queryLimit || config.QUERY_LIMIT || {};
  const value = section[key];
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const positiveCount = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
};

const escapeLike = (value) => String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);

const acceptedCountExpr = (uidSql = 'u.uid') =>
  `(SELECT COUNT(DISTINCT s.pid) FROM submission s WHERE s.uid=${uidSql} AND s.judgeResult=4)`;

const submissionCountExpr = (uidSql = 'u.uid') =>
  `(SELECT COUNT(*) FROM submission s WHERE s.uid=${uidSql})`;

const compatRatingSelect = (alias = 'u', latestAlias = 'latestRating') =>
  `${effectiveRatingExpr(alias, latestAlias)} AS effectiveRating,` +
  `${alias}.rating AS cachedRating,` +
  `COALESCE(${latestAlias}.newRating,0) AS historyRating,` +
  `(COALESCE(${alias}.rating,0)<>COALESCE(${latestAlias}.newRating,0)) AS ratingCacheMismatch`;

const compatUserSelect = () =>
  `u.*,${compatRatingSelect('u')},${acceptedCountExpr('u.uid')} AS acceptedProblemCount,${submissionCountExpr('u.uid')} AS submissionCount`;

const rankCacheValue = async (cache, key, loader) => {
  if (!cache.has(key)) cache.set(key, await loader());
  return cache.get(key);
};

const attachLeaderboardRanks = async (rows, sortBy) => {
  const acceptedRankCache = new Map();
  const ratingRankCache = new Map();
  await Promise.all(rows.map(async (row) => {
    const accepted = Number(row.acceptedProblemCount || 0);
    const rating = Number(row.effectiveRating != null ? row.effectiveRating : row.rating || 0);
    const acceptedAhead = await rankCacheValue(acceptedRankCache, accepted, async () =>
      Number((await db.one(
        `SELECT COUNT(*) AS cnt FROM userInfo u WHERE u.inUse=1 AND ${acceptedCountExpr('u.uid')} > ?`,
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
    row.rank = sortBy === 'rating' ? row.ratingRank : row.acceptedRank;
  }));
};

const lookupUser = async (body) => {
  await ensureCompatSchema();
  const uid = parseInt(body.userId || body.uid, 10);
  if (uid) return db.one(`SELECT ${compatUserSelect()} FROM userInfo u ${latestRatingJoin('u')} WHERE u.uid=? LIMIT 1`, [uid]);
  const username = String(body.username || body.name || '').trim();
  if (username) return db.one(`SELECT ${compatUserSelect()} FROM userInfo u ${latestRatingJoin('u')} WHERE u.name=? LIMIT 1`, [username]);
  return null;
};

const parseAvatar = (row) => {
  const info = String(row.avatarInfo || '').trim();
  const pos = info.indexOf(':');
  if (pos > 0) return { type: info.slice(0, pos), key: info.slice(pos + 1) };
  if (row.qq) return { type: 'qq', key: String(row.qq) };
  return { type: 'qq', key: '' };
};

const avatarUrl = (avatar, size = 80) => {
  if (!avatar || !avatar.key) return DEFAULT_AVATAR;
  if (avatar.type === 'qq') {
    const qqSize = size <= 40 ? 1 : size <= 100 ? 3 : size <= 140 ? 4 : 5;
    return `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(avatar.key)}&s=${qqSize}`;
  }
  if (avatar.type === 'github') return `https://github.com/${encodeURIComponent(avatar.key)}.png?size=${size}`;
  if (avatar.type === 'gravatar') {
    return `https://www.gravatar.com/avatar/${encodeURIComponent(avatar.key)}?s=${size}&d=404`;
  }
  return DEFAULT_AVATAR;
};

const userMeta = (row) => ({
  id: row.uid,
  uid: row.uid,
  username: row.name,
  name: row.name,
  email: row.publicEmail || row.uid === row.currentViewer || row.showPrivate ? row.email || '' : '',
  nickname: row.nickname || '',
  bio: row.bio || '',
  avatar: parseAvatar(row),
  isAdmin: Number(row.uid) === 1,
  acceptedProblemCount: Number(row.acceptedProblemCount || 0),
  submissionCount: Number(row.submissionCount || 0),
  rating: Number(row.effectiveRating != null ? row.effectiveRating : row.rating || 0),
  cachedRating: Number(row.cachedRating != null ? row.cachedRating : row.rating || 0),
  historyRating: Number(row.historyRating || 0),
  ratingCacheMismatch: !!Number(row.ratingCacheMismatch || 0),
  ...(row.rank !== undefined ? { rank: row.rank == null ? null : Number(row.rank) } : {}),
  ...(row.acceptedRank !== undefined ? { acceptedRank: Number(row.acceptedRank || 0) } : {}),
  ...(row.ratingRank !== undefined ? { ratingRank: row.ratingRank == null ? null : Number(row.ratingRank) } : {}),
  registrationTime: row.reg_time,
});

const localUserMeta = (meta) => ({
  ...meta,
  avatar: avatarUrl(meta.avatar, 80),
  avatarType: meta.avatar && meta.avatar.type,
  avatarKey: meta.avatar && meta.avatar.key,
  avatarInfo: meta.avatar && meta.avatar.key ? `${meta.avatar.type}:${meta.avatar.key}` : '',
  reg_time: meta.registrationTime,
});

const compatUserSelectForAlias = (alias, latestAlias = 'latestRating') =>
  `${alias}.*,${compatRatingSelect(alias, latestAlias)},` +
  `${acceptedCountExpr(`${alias}.uid`)} AS acceptedProblemCount,` +
  `${submissionCountExpr(`${alias}.uid`)} AS submissionCount`;

const informationOf = (row) => ({
  organization: row.organization || '',
  location: row.location || '',
  url: row.homepageUrl || '',
  telegram: row.telegram || '',
  qq: row.qq || '',
  github: row.github || '',
});

const usernameAvailable = async (username, uid) =>
  NAME_REGEX.test(username) &&
  !(await db.exists('SELECT uid FROM userInfo WHERE name=? AND uid<>?', [username, uid]));

const emailAvailable = async (email, uid) =>
  EMAIL_REGEX.test(email) &&
  !(await db.exists('SELECT uid FROM userInfo WHERE email=? AND uid<>?', [email, uid]));

exports.searchUser = handler(async (req, res) => {
  await ensureCompatSchema();
  const source = req.method === 'GET' ? req.query : req.body;
  const query = String(source.query || source.q || '').trim();
  if (!query) return ok(res, { userMetas: [], data: [] });

  let pattern = escapeLike(query);
  const wildcard = source.wildcard || (source.q != null ? 'Both' : '');
  if (wildcard === 'Start' || wildcard === 'Both') pattern = `%${pattern}`;
  if (wildcard === 'End' || wildcard === 'Both') pattern = `${pattern}%`;

  const limit = queryLimitNumber('searchUser', DEFAULT_USER_SEARCH_LIMIT);
  const rows = await db.query(
    `SELECT ${compatUserSelect()}
       FROM userInfo u ${latestRatingJoin('u')}
      WHERE u.inUse=1 AND u.name LIKE ?
      ORDER BY u.name ASC
      LIMIT ?`,
    [pattern, limit]
  );
  const viewer = uidOf(req);
  const userMetas = rows.map((row) => {
    row.currentViewer = viewer;
    row.showPrivate = canAccessUser(req, row.uid);
    return userMeta(row);
  });
  return ok(res, { userMetas, data: userMetas.map(localUserMeta) });
});

exports.getUserMeta = handler(async (req, res) => {
  await ensureCompatSchema();
  const user = await lookupUser(req.body || {});
  if (!user) return ok(res, { error: 'NO_SUCH_USER' });
  user.currentViewer = uidOf(req);
  user.showPrivate = canAccessUser(req, user.uid);
  const result = { meta: userMeta(user) };
  if (req.body && req.body.getPrivileges) {
    result.privileges = await db.column(
      'SELECT privilegeType FROM user_privilege WHERE userId=? ORDER BY privilegeType ASC',
      [user.uid],
      'privilegeType'
    );
  }
  return ok(res, result);
});

exports.getUserList = handler(async (req, res) => {
  await ensureCompatSchema();
  const maxTakeCount = queryLimitNumber('userList', DEFAULT_USER_LIST_LIMIT);
  const takeCount = Math.max(Math.floor(Number(req.body.takeCount || req.body.pageSize || 30) || 30), 1);
  if (takeCount > maxTakeCount) return ok(res, { error: 'TAKE_TOO_MANY' });

  const pageId = Math.max(Number(req.body.pageId || 1) || 1, 1);
  const skipCount = Math.max(
    Math.floor(Number(req.body.skipCount != null ? req.body.skipCount : (pageId - 1) * takeCount) || 0),
    0
  );
  const sortBy = USER_LIST_SORTS.has(req.body.sortBy) ? req.body.sortBy : 'acceptedProblemCount';
  const acceptedExpr = acceptedCountExpr('u.uid');
  const orderExpr = sortBy === 'rating'
    ? `${effectiveRatingExpr('u')} DESC,${acceptedExpr} DESC,u.uid ASC`
    : `${acceptedExpr} DESC,${effectiveRatingExpr('u')} DESC,u.uid ASC`;
  const rows = await db.query(
    `SELECT ${compatUserSelect()}
       FROM userInfo u ${latestRatingJoin('u')}
      WHERE u.inUse=1
      ORDER BY ${orderExpr}
      LIMIT ?,?`,
    [skipCount, takeCount]
  );
  const count = Number((await db.one('SELECT COUNT(*) AS cnt FROM userInfo WHERE inUse=1'))?.cnt || 0);
  await attachLeaderboardRanks(rows, sortBy);
  const viewer = uidOf(req);
  const userMetas = rows.map((row) => {
    row.currentViewer = viewer;
    row.showPrivate = canAccessUser(req, row.uid);
    return {
      ...userMeta(row),
      reg_time: row.reg_time,
      login_time: row.login_time,
    };
  });
  return ok(res, {
    userMetas,
    count,
    data: userMetas.map(localUserMeta),
    total: count,
    sortBy,
  });
});

exports.setUserPrivileges = handler(async (req, res) => {
  await ensureCompatSchema();
  if (!req.can('user.role.admin')) return ok(res, { error: 'PERMISSION_DENIED' });
  const uid = parseInt(req.body.userId || req.body.uid, 10);
  if (!uid || !(await db.exists('SELECT 1 FROM userInfo WHERE uid=?', [uid]))) return ok(res, { error: 'NO_SUCH_USER' });
  const privileges = Array.isArray(req.body.privileges) ? [...new Set(req.body.privileges)] : [];
  if (privileges.some((privilege) => !USER_PRIVILEGE_TYPES.has(privilege))) {
    return ok(res, { error: 'FAILED' });
  }
  const permissionKeys = privileges.map((p) => PRIVILEGE_TO_PERMISSION[p]).filter(Boolean);
  const oldPrivileges = await db.column('SELECT privilegeType FROM user_privilege WHERE userId=?', [uid], 'privilegeType');
  const mappedKeys = Object.values(PRIVILEGE_TO_PERMISSION);
  const permRows = mappedKeys.length
    ? await db.query('SELECT id,`key` FROM permissions WHERE `key` IN (?)', [mappedKeys])
    : [];
  const permByKey = new Map(permRows.map((row) => [row.key, row.id]));
  if (permissionKeys.some((key) => !permByKey.has(key))) return ok(res, { error: 'FAILED' });
  await db.tx(async (tx) => {
    await tx.query('DELETE FROM user_privilege WHERE userId=?', [uid]);
    if (privileges.length) {
      await tx.query('INSERT INTO user_privilege(userId,privilegeType) VALUES ?', [privileges.map((p) => [uid, p])]);
    }
    if (permRows.length) {
      await tx.query('DELETE FROM user_permissions WHERE uid=? AND permission_id IN (?) AND resource_type IS NULL', [
        uid,
        permRows.map((row) => row.id),
      ]);
    }
    const values = permissionKeys
      .filter((key) => permByKey.has(key))
      .map((key) => [uid, permByKey.get(key), 'allow', null, null, req.session.uid || null]);
    if (values.length) {
      await tx.query(
        'INSERT INTO user_permissions(uid,permission_id,effect,resource_type,resource_id,granted_by) VALUES ?',
        [values]
      );
    }
  });
  policy.invalidate(uid);
  recordEvent(req, 'auth.grantUserPermission', { uid, oldPrivileges, privileges });
  return ok(res);
});

exports.updateUserProfile = handler(async (req, res) => {
  await ensureCompatSchema();
  const user = await lookupUser(req.body || {});
  if (!user) return ok(res, { error: 'NO_SUCH_USER' });
  if (!canAccessUser(req, user.uid)) return ok(res, { error: 'PERMISSION_DENIED' });
  const username = String(req.body.username || user.name).trim();
  const requestEmail = String(req.body.email || user.email || '').trim();
  const email = requireEmailVerification() ? (user.email || '') : requestEmail;
  const changingUsername = username !== user.name;
  if (changingUsername && !allowUserChangeUsername() && !canManageUsers(req)) return ok(res, { error: 'PERMISSION_DENIED' });
  if (changingUsername && !(await usernameAvailable(username, user.uid))) return ok(res, { error: 'DUPLICATE_USERNAME' });
  if (email !== (user.email || '') && !(await emailAvailable(email, user.uid))) return ok(res, { error: 'DUPLICATE_EMAIL' });
  const info = req.body.information || {};
  await db.query(
    `UPDATE userInfo
        SET name=?,email=?,publicEmail=?,avatarInfo=?,nickname=?,bio=?,
            organization=?,location=?,homepageUrl=?,telegram=?,qq=?,github=?
      WHERE uid=?`,
    [
      username,
      email,
      req.body.publicEmail ? 1 : 0,
      String(req.body.avatarInfo || '').slice(0, 128),
      String(req.body.nickname || '').slice(0, 24),
      String(req.body.bio || '').slice(0, 160),
      String(info.organization || '').slice(0, 80),
      String(info.location || '').slice(0, 80),
      String(info.url || '').slice(0, 80),
      String(info.telegram || '').slice(0, 30),
      String(info.qq || '').slice(0, 30),
      String(info.github || '').slice(0, 30),
      user.uid,
    ]
  );
  if (user.uid === uidOf(req)) {
    req.session.name = username;
    req.session.email = email;
  }
  recordEvent(req, 'user.updateProfile', { targetUid: user.uid });
  return ok(res);
});

exports.getUserDetail = handler(async (req, res) => {
  const user = await lookupUser(req.body || {});
  if (!user) return ok(res, { error: 'NO_SUCH_USER' });
  user.currentViewer = uidOf(req);
  user.showPrivate = canAccessUser(req, user.uid);
  const days = 53 * 7 + 6;
  const rows = await db.query(
    `SELECT DATE_FORMAT(submitTime, '%Y-%m-%d') AS date, COUNT(*) AS cnt
       FROM submission
      WHERE uid=? AND submitTime >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY DATE_FORMAT(submitTime, '%Y-%m-%d')`,
    [user.uid, days]
  );
  const byDate = new Map(rows.map((row) => [row.date, Number(row.cnt || 0)]));
  const submissionCountPerDay = [];
  const base = new Date(req.body.now || Date.now());
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    submissionCountPerDay.push(byDate.get(key) || 0);
  }
  const rank = 1 + Number((await db.one(
    `SELECT COUNT(*) AS cnt FROM userInfo u WHERE ${acceptedCountExpr('u.uid')} > ?`,
    [user.acceptedProblemCount || 0]
  ))?.cnt || 0);
  return ok(res, {
    meta: userMeta(user),
    information: informationOf(user),
    submissionCountPerDay,
    rank,
    hasPrivilege: canAccessUser(req, user.uid),
  });
});

exports.getUserProfile = handler(async (req, res) => {
  const user = await lookupUser(req.body || {});
  if (!user) return ok(res, { error: 'NO_SUCH_USER' });
  if (!canAccessUser(req, user.uid)) return ok(res, { error: 'PERMISSION_DENIED' });
  user.currentViewer = uidOf(req);
  user.showPrivate = true;
  return ok(res, {
    meta: userMeta(user),
    publicEmail: !!user.publicEmail,
    avatarInfo: user.avatarInfo || '',
    information: informationOf(user),
  });
});

exports.getUserSecuritySettings = handler(async (req, res) => {
  const user = await lookupUser(req.body || {});
  if (!user) return ok(res, { error: 'NO_SUCH_USER' });
  if (!canAccessUser(req, user.uid)) return ok(res, { error: 'PERMISSION_DENIED' });
  user.currentViewer = uidOf(req);
  user.showPrivate = true;
  return ok(res, { meta: userMeta(user) });
});

exports.queryAuditLogs = handler(async (req, res) => {
  const maxTake = queryLimitNumber('userAuditLogs', 20);
  const take = positiveCount(req.body.takeCount ?? req.body.pageSize, maxTake);
  if (take > maxTake) return ok(res, { error: 'TAKE_TOO_MANY' });
  const target = await lookupUser(req.body || {});
  if ((req.body.userId || req.body.username) && !target) return ok(res, { error: 'NO_SUCH_USER' });
  const targetUid = target ? target.uid : null;
  if (targetUid && !canAccessUser(req, targetUid)) return ok(res, { error: 'PERMISSION_DENIED' });
  if (!targetUid && !canManageUsers(req)) return ok(res, { error: 'PERMISSION_DENIED' });
  const skip = Math.max(Number(req.body.skipCount || 0) || 0, 0);
  const actionQuery = String(req.body.actionQuery || '').trim();
  const eventIds = actionQuery
    ? eventList.map((key, id) => ({ key, id })).filter((item) => item.key.startsWith(actionQuery)).map((item) => item.id)
    : [];
  const cond = [];
  const params = [];
  if (targetUid) { cond.push('a.uid=?'); params.push(targetUid); }
  if (req.body.ip) { cond.push('a.ip=?'); params.push(req.body.ip); }
  if (eventIds.length) { cond.push(`a.event IN (${eventIds.map(() => '?').join(',')})`); params.push(...eventIds); }
  const objectIdCondition = (value) => {
    const id = Number(value);
    if (!Number.isSafeInteger(id)) return null;
    const paths = ['id', 'uid', 'userId', 'targetUid', 'pid', 'problemId', 'cid', 'contestId', 'gid', 'groupId', 'did', 'discussionId', 'rid'];
    return [
      `(JSON_VALID(a.detail) AND (${paths.map((key) => `CAST(JSON_UNQUOTE(JSON_EXTRACT(a.detail,'$.${key}')) AS UNSIGNED)=?`).join(' OR ')}))`,
      ...paths.map(() => id),
    ];
  };
  const firstObjectCond = objectIdCondition(req.body.firstObjectId);
  if (firstObjectCond) { cond.push(firstObjectCond[0]); params.push(...firstObjectCond.slice(1)); }
  const secondObjectCond = objectIdCondition(req.body.secondObjectId);
  if (secondObjectCond) { cond.push(secondObjectCond[0]); params.push(...secondObjectCond.slice(1)); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT a.*,${compatUserSelectForAlias('u')}
       FROM userAudit a
       LEFT JOIN userInfo u ON u.uid=a.uid
       ${latestRatingJoin('u')}
       ${where}
      ORDER BY a.id DESC LIMIT ?,?`,
    [...params, skip, take]
  );
  const count = await db.one(`SELECT COUNT(*) AS cnt FROM userAudit a ${where}`, params);
  const viewer = uidOf(req);
  return ok(res, {
    results: rows.map((row) => {
      row.currentViewer = viewer;
      row.showPrivate = canAccessUser(req, row.uid);
      const details = row.detail ? (() => { try { return JSON.parse(row.detail); } catch (_) { return row.detail; } })() : null;
      return {
        user: row.uid ? userMeta(row) : null,
        ip: row.ip,
        ipLocation: row.iploc || ip2loc(row.ip),
        time: row.time,
        action: eventList[row.event] || String(row.event),
        details,
        firstObjectType: details && typeof details === 'object' && details.firstObjectType || null,
        firstObjectId: details && typeof details === 'object' && (details.firstObjectId || details.pid || details.uid || details.gid || details.did || details.id) || null,
        secondObjectType: details && typeof details === 'object' && details.secondObjectType || null,
        secondObjectId: details && typeof details === 'object' && (details.secondObjectId || details.targetUid || details.userId || details.rid) || null,
      };
    }),
    count: Number(count.cnt || 0),
  });
});

exports.updateUserPassword = handler(async (req, res) => {
  const user = await lookupUser(req.body || {});
  if (!user) return ok(res, { error: 'NO_SUCH_USER' });
  if (!canAccessUser(req, user.uid)) return ok(res, { error: 'PERMISSION_DENIED' });
  const isSelf = user.uid === uidOf(req);
  if (isSelf && !canManageUsers(req) && !bcrypt.compareSync(String(req.body.oldPassword || ''), user.pwd)) {
    return ok(res, { error: 'WRONG_OLD_PASSWORD' });
  }
  const password = String(req.body.password || '');
  if (password.length < 6 || password.length > 32) return fail(res, '密码长度应在6~32之间');
  await db.query('UPDATE userInfo SET pwd=? WHERE uid=?', [bcrypt.hashSync(password, 12), user.uid]);
  recordEvent(req, user.uid === uidOf(req) ? 'auth.changePassword' : 'admin.updateUserInfo', { targetUid: user.uid });
  return ok(res);
});

exports.updateUserSelfEmail = handler(async (req, res) => {
  await ensureCompatSchema();
  const uid = uidOf(req);
  if (!uid) return ok(res, { error: 'PERMISSION_DENIED' });
  const email = String(req.body.email || '').trim();
  const old = await db.one('SELECT email FROM userInfo WHERE uid=?', [uid]);
  const verify = req.session.verifyCode;
  const needsEmailVerification = requireEmailVerification();
  if (needsEmailVerification) {
    const code = String(req.body.emailVerificationCode || '');
    if (!code || !verify || verify.email !== email || verify.purpose !== 'changeEmail' || verify.code !== code || Date.now() > verify.expire) {
      return ok(res, { error: 'INVALID_EMAIL_VERIFICATION_CODE' });
    }
  }
  if (!(await emailAvailable(email, uid))) return ok(res, { error: 'DUPLICATE_EMAIL' });
  await db.query('UPDATE userInfo SET email=? WHERE uid=?', [email, uid]);
  req.session.email = email;
  if (needsEmailVerification) req.session.verifyCode = null;
  recordEvent(req, 'auth.changeEmail', { email: { old: old && old.email, new: email } });
  return ok(res);
});
