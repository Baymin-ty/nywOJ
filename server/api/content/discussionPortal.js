const db = require('../../db');
const { handler, ok } = require('../../db/util');
const config = require('../../config.json');
const { problemAuth } = require('../problem/core');
const discussionApi = require('./discussion');
const { ensureContestRatingStorageSchema, latestRatingJoin, effectiveRatingExpr } = require('../contest/ratingStorage');

let userMetaSchemaReady = null;

const ensureUserMetaSchema = () => {
  if (!userMetaSchemaReady) {
    userMetaSchemaReady = (async () => {
      const columns = [
        { name: 'nickname', ddl: "VARCHAR(24) NOT NULL DEFAULT ''" },
        { name: 'bio', ddl: "VARCHAR(160) NOT NULL DEFAULT ''" },
        { name: 'avatarInfo', ddl: "VARCHAR(128) NOT NULL DEFAULT ''" },
        { name: 'publicEmail', ddl: 'TINYINT NOT NULL DEFAULT 0' },
      ];
      for (const column of columns) {
        const row = await db.one(
          'SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
          ['userInfo', column.name]
        );
        if (!row || !row.cnt) await db.query(`ALTER TABLE userInfo ADD COLUMN ${column.name} ${column.ddl}`);
      }
      await ensureContestRatingStorageSchema();
    })();
  }
  return userMetaSchemaReady;
};

const uidOf = (req) => (req.session && req.session.uid) || 0;

const positiveInt = (value) => {
  const n = parseInt(value, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const problemIdFilter = (body) => {
  const raw = body.problemId;
  if (raw == null || raw === '') return { specified: false, all: false, pid: null };
  if (String(raw).trim().toLowerCase() === 'all' || Number(raw) === -1) {
    return { specified: true, all: true, pid: null };
  }
  return { specified: true, all: false, pid: positiveInt(raw) };
};

const boolValue = (value, fallback = true) => {
  if (value == null) return fallback;
  if (typeof value === 'string') return !['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase());
  return !!value;
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

const allowEveryoneCreateDiscussion = () => preferenceSecurityFlag('allowEveryoneCreateDiscussion', true);

const discussionDefaultPublic = () => preferenceSecurityFlag('discussionDefaultPublic', true);

const discussionReplyDefaultPublic = () => preferenceSecurityFlag('discussionReplyDefaultPublic', true);

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

const nonNegativeCount = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
};

const hasDiscussionManagePrivilege = (req) => !!(req.can && req.can('discussion.manage'));

const canDeleteDiscussion = (req, row) => !!(row && uidOf(req) && (
  row.uid === uidOf(req) ||
  hasDiscussionManagePrivilege(req)
));

const canManageHiddenReplies = (req) => hasDiscussionManagePrivilege(req);

const canModifyReply = (req, row) => !!(row && uidOf(req) && (
  row.uid === uidOf(req) ||
  hasDiscussionManagePrivilege(req)
));

const canModifyDiscussion = (req, row) => !!(row && uidOf(req) && (
  row.uid === uidOf(req) ||
  hasDiscussionManagePrivilege(req)
));

const canManageDiscussionPublicness = (req) => hasDiscussionManagePrivilege(req);

const canCreateDiscussion = (req) => !!uidOf(req) && (
  allowEveryoneCreateDiscussion() ||
  hasDiscussionManagePrivilege(req)
);

const canViewLinkedProblem = async (req, pid) => {
  if (!pid) return true;
  const auth = await problemAuth(req, pid);
  return !!(auth && auth.view);
};

const canView = async (req, row) => {
  if (!row) return false;
  if (row.isPublic) return true;
  const direct = row.uid === uidOf(req) || (req.can && (
    req.can('discussion.manage') ||
    req.can('discussion.view.any') ||
    req.can('discussion.reply.any')
  ));
  if (!direct && !(await canViewLinkedProblem(req, row.pid))) return false;
  return direct;
};

const canReply = async (req, row) => uidOf(req) && await canView(req, row);

const loadDiscussion = (did) => db.one(
  `SELECT d.did,d.pid,d.uid,d.title,d.content,d.isPublic,d.time,d.updateTime,d.lastReplyTime,d.replyCnt,
          p.title AS problemTitle,p.type AS problemType,p.isPublic AS problemPublic,p.time AS problemTime,
          p.publisher,p.submitCnt,p.acCnt
     FROM discussion d
     LEFT JOIN problem p ON p.pid=d.pid
    WHERE d.did=?`,
  [did]
);

const parseAvatar = (row) => {
  const info = String(row.avatarInfo || '').trim();
  const pos = info.indexOf(':');
  if (pos > 0) return { type: info.slice(0, pos), key: info.slice(pos + 1) };
  if (row.qq) return { type: 'qq', key: String(row.qq) };
  return { type: 'qq', key: '' };
};

const acceptedCountExpr = (uidSql = 'u.uid') =>
  `(SELECT COUNT(DISTINCT s.pid) FROM submission s WHERE s.uid=${uidSql} AND s.judgeResult=4)`;

const submissionCountExpr = (uidSql = 'u.uid') =>
  `(SELECT COUNT(*) FROM submission s WHERE s.uid=${uidSql})`;

const userMetaSelect = () =>
  `u.uid,u.name,u.email,u.publicEmail,u.qq,u.avatarInfo,u.nickname,u.bio,u.reg_time,` +
  `${effectiveRatingExpr('u')} AS rating,` +
  `${acceptedCountExpr('u.uid')} AS acceptedProblemCount,` +
  `${submissionCountExpr('u.uid')} AS submissionCount`;

const canViewUserEmail = (req, row) =>
  !!(row && row.publicEmail) ||
  Number(row && row.uid) === Number(uidOf(req)) ||
  !!(req.can && (req.can('user.manage') || req.can('user.role.admin')));

const userMeta = async (req, uid) => {
  await ensureUserMetaSchema();
  const row = await db.one(
    `SELECT ${userMetaSelect()} FROM userInfo u ${latestRatingJoin('u')} WHERE u.uid=?`,
    [uid]
  );
  if (!row) return null;
  return {
    id: row.uid,
    uid: row.uid,
    username: row.name,
    name: row.name,
    email: canViewUserEmail(req, row) ? row.email || '' : '',
    nickname: row.nickname || '',
    bio: row.bio || '',
    avatar: parseAvatar(row),
    isAdmin: Number(row.uid) === 1,
    acceptedProblemCount: Number(row.acceptedProblemCount || 0),
    submissionCount: Number(row.submissionCount || 0),
    rating: Number(row.rating || 0),
    registrationTime: row.reg_time || null,
  };
};

const problemTypeOf = (type) => ([2, 3].includes(Number(type)) ? 'SubmitAnswer' : 'Traditional');

const problemDto = (row) => row && row.pid ? {
  meta: {
    id: row.pid,
    pid: row.pid,
    type: problemTypeOf(row.problemType),
    isPublic: !!row.problemPublic,
    publicTime: row.problemTime,
    ownerId: row.publisher,
    locales: ['zh-CN'],
    submissionCount: Number(row.submitCnt || 0),
    acceptedSubmissionCount: Number(row.acCnt || 0),
  },
  title: row.problemTitle || '',
  titleLocale: 'zh-CN',
} : null;

const loadProblemDto = async (pid) => {
  if (!pid) return null;
  const row = await db.one(
    `SELECT p.pid,p.title AS problemTitle,p.type AS problemType,p.isPublic AS problemPublic,
            p.time AS problemTime,p.publisher,p.submitCnt,p.acCnt
       FROM problem p
      WHERE p.pid=?`,
    [pid]
  );
  return problemDto(row);
};

const discussionMeta = (row) => ({
  id: row.did,
  did: row.did,
  title: row.title,
  publishTime: row.time,
  editTime: row.updateTime,
  sortTime: row.lastReplyTime || row.updateTime || row.time,
  replyCount: Number(row.replyCnt || 0),
  isPublic: !!row.isPublic,
  publisherId: row.uid,
  problemId: row.pid || undefined,
});

const discussionPermissions = (req, row) => {
  if (!uidOf(req)) return row.isPublic ? ['View'] : [];
  if (hasDiscussionManagePrivilege(req)) {
    return ['View', 'Modify', 'ManagePermission', 'ManagePublicness', 'Delete'];
  }
  const permissions = [];
  if (
    row.isPublic ||
    row.uid === uidOf(req) ||
    (req.can && (
      req.can('discussion.view.any') ||
      req.can('discussion.reply.any') ||
      req.can('discussion.manage')
    ))
  ) {
    permissions.push('View');
  }
  if (canModifyDiscussion(req, row)) permissions.push('Modify');
  if (row.uid === uidOf(req)) permissions.push('Delete');
  return permissions;
};

const replyPermissions = (req, row) => {
  if (!uidOf(req)) return [];
  if (hasDiscussionManagePrivilege(req)) return ['Modify', 'ManagePublicness', 'Delete'];
  return row.uid === uidOf(req) ? ['Modify', 'Delete'] : [];
};

const reactionsFor = async (table, idColumn, id, uid) => {
  const counts = await db.query(
    `SELECT reaction,COUNT(*) AS cnt FROM ${table} WHERE ${idColumn}=? GROUP BY reaction`,
    [id]
  );
  const count = Object.fromEntries(counts.map((row) => [row.reaction, Number(row.cnt) || 0]));
  let currentUserReactions = [];
  if (uid) {
    currentUserReactions = await db.column(
      `SELECT reaction FROM ${table} WHERE ${idColumn}=? AND uid=?`,
      [id, uid],
      'reaction'
    );
  }
  return { count, currentUserReactions };
};

const discussionDto = async (req, row) => ({
  meta: discussionMeta(row),
  content: row.content,
  problem: problemDto(row),
  publisher: await userMeta(req, row.uid),
  reactions: await reactionsFor('discussionReaction', 'did', row.did, uidOf(req)),
  permissions: discussionPermissions(req, row),
});

const replyDto = async (req, row, discussion) => ({
  id: row.rid,
  rid: row.rid,
  content: row.content,
  publishTime: row.time,
  editTime: row.updateTime,
  isPublic: !!row.isPublic,
  publisher: await userMeta(req, row.uid),
  reactions: await reactionsFor('discussionReplyReaction', 'rid', row.rid, uidOf(req)),
  permissions: replyPermissions(req, row),
});

exports.createDiscussion = handler(async (req, res) => {
  await discussionApi.ensureSchema();
  const uid = uidOf(req);
  if (!uid) return ok(res, { error: 'PERMISSION_DENIED' });
  if (!canCreateDiscussion(req)) return ok(res, { error: 'PERMISSION_DENIED' });
  const pid = positiveInt(req.body.problemId || req.body.pid);
  if (req.body.problemId || req.body.pid) {
    const problem = pid && await db.one('SELECT pid FROM problem WHERE pid=?', [pid]);
    if (!problem) return ok(res, { error: 'NO_SUCH_PROBLEM' });
    if (!(await canViewLinkedProblem(req, pid))) return ok(res, { error: 'PERMISSION_DENIED' });
  }
  const title = String(req.body.title || '').trim();
  const content = String(req.body.content || '').trim();
  if (!title || !content) return ok(res, { error: 'PERMISSION_DENIED' });
  const now = new Date();
  const result = await db.query(
    'INSERT INTO discussion(pid,uid,title,content,isPublic,time,updateTime,lastReplyTime) VALUES (?,?,?,?,?,?,?,?)',
    [
      pid || null,
      uid,
      title.slice(0, 80),
      content,
      boolValue(req.body.isPublic, discussionDefaultPublic()) ? 1 : 0,
      now,
      now,
      now,
    ]
  );
  return ok(res, { discussionId: result.insertId, did: result.insertId });
});

exports.createDiscussionReply = handler(async (req, res) => {
  await discussionApi.ensureSchema();
  const uid = uidOf(req);
  if (!uid) return ok(res, { error: 'PERMISSION_DENIED' });
  const did = positiveInt(req.body.discussionId || req.body.did);
  const discussion = did && await loadDiscussion(did);
  if (!discussion) return ok(res, { error: 'NO_SUCH_DISCUSSION' });
  if (!(await canReply(req, discussion))) return ok(res, { error: 'PERMISSION_DENIED' });
  const content = String(req.body.content || '').trim();
  if (!content) return ok(res, { error: 'PERMISSION_DENIED' });
  const now = new Date();
  const result = await db.tx(async (t) => {
    const inserted = await t.query(
      'INSERT INTO discussionReply(did,uid,content,isPublic,time,updateTime) VALUES (?,?,?,?,?,?)',
      [did, uid, content, boolValue(req.body.isPublic, discussionReplyDefaultPublic()) ? 1 : 0, now, now]
    );
    await t.query('UPDATE discussion SET replyCnt=replyCnt+1,lastReplyTime=?,updateTime=? WHERE did=?', [now, now, did]);
    return inserted;
  });
  const reply = await db.one('SELECT rid,did,uid,content,isPublic,time,updateTime FROM discussionReply WHERE rid=?', [result.insertId]);
  return ok(res, { reply: await replyDto(req, reply, discussion) });
});

exports.queryDiscussion = handler(async (req, res) => {
  await discussionApi.ensureSchema();
  const takeCount = positiveCount(req.body.takeCount ?? req.body.pageSize, 20);
  if (takeCount > queryLimitNumber('discussions', 20)) return ok(res, { error: 'TAKE_TOO_MANY' });
  const skipCount = Math.max(Number(req.body.skipCount || 0) || 0, 0);
  const where = [];
  const params = [];
  const uid = uidOf(req);
  const titleOnly = !!req.body.titleOnly;
  const keyword = String(req.body.keyword || '').trim();
  if (keyword) {
    where.push('(d.title LIKE ? OR d.content LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const problemFilter = problemIdFilter(req.body);
  const filterProblem = !titleOnly && problemFilter.pid ? await loadProblemDto(problemFilter.pid) : null;
  const filterProblemExists = problemFilter.pid
    ? (titleOnly ? await db.exists('SELECT pid FROM problem WHERE pid=?', [problemFilter.pid]) : !!filterProblem)
    : false;
  if (problemFilter.all) {
    where.push('d.pid IS NOT NULL');
  } else if (filterProblemExists) {
    where.push('d.pid=?');
    params.push(problemFilter.pid);
  } else {
    where.push('d.pid IS NULL');
  }

  const filterPublisher = !titleOnly && req.body.publisherId ? await userMeta(req, req.body.publisherId) : null;
  const filterPublisherExists = req.body.publisherId
    ? (titleOnly ? await db.exists('SELECT uid FROM userInfo WHERE uid=?', [req.body.publisherId]) : !!filterPublisher)
    : false;
  const publisherId = filterPublisherExists ? Number(req.body.publisherId) : null;
  if (publisherId) {
    where.push('d.uid=?');
    params.push(publisherId);
  }
  const hasPrivilege = !!(req.can && req.can('discussion.manage'));
  if (!hasPrivilege && !(uid && publisherId === uid)) {
    where.push('(d.isPublic=1 OR d.uid=?)');
    params.push(uid);
  } else if (req.body.nonpublic) {
    where.push('d.isPublic=0');
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT d.did,d.pid,d.uid,d.title,d.content,d.isPublic,d.time,d.updateTime,d.lastReplyTime,d.replyCnt,
            p.title AS problemTitle,p.type AS problemType,p.isPublic AS problemPublic,p.time AS problemTime,
            p.publisher,p.submitCnt,p.acCnt
       FROM discussion d
       LEFT JOIN problem p ON p.pid=d.pid
       ${clause}
      ORDER BY COALESCE(d.lastReplyTime,d.updateTime,d.time) DESC,d.did DESC
      LIMIT ?,?`,
    [...params, skipCount, takeCount]
  );
  const countRow = await db.one(`SELECT COUNT(*) AS total FROM discussion d ${clause}`, params);
  const response = {
    discussions: await Promise.all(rows.map(async (row) => ({
      meta: discussionMeta(row),
      problem: !titleOnly && problemDto(row),
      publisher: !titleOnly ? await userMeta(req, row.uid) : undefined,
    }))),
    count: Number(countRow.total || 0),
  };
  if (!titleOnly) {
    response.permissions = {
      createDiscussion: canCreateDiscussion(req),
      filterNonpublic: hasPrivilege,
    };
    response.filterPublisher = filterPublisher;
    response.filterProblem = filterProblem;
  }
  return ok(res, response);
});

const visibleReplies = async (req, discussion, whereExtra, paramsExtra, limit) => {
  const where = ['r.did=?'];
  const params = [discussion.did];
  if (!canManageHiddenReplies(req)) {
    where.push('(r.isPublic=1 OR r.uid=?)');
    params.push(uidOf(req));
  }
  where.push(...whereExtra);
  const rows = await db.query(
    `SELECT r.rid,r.did,r.uid,r.content,r.isPublic,r.time,r.updateTime
       FROM discussionReply r
      WHERE ${where.join(' AND ')}
      ORDER BY r.rid ASC
      LIMIT ?`,
    [...params, ...paramsExtra, limit]
  );
  return Promise.all(rows.map((row) => replyDto(req, row, discussion)));
};

exports.getDiscussionAndReplies = handler(async (req, res) => {
  await discussionApi.ensureSchema();
  const type = req.body.queryRepliesType || 'HeadTail';
  const maxRepliesTakeCount = queryLimitNumber('discussionReplies', 50);
  let idRangeTake = 0;
  let headTake = 0;
  let tailTake = 0;
  if (type === 'IdRange') {
    idRangeTake = positiveCount(req.body.idRangeTakeCount, 30);
    if (idRangeTake > maxRepliesTakeCount) return ok(res, { error: 'TAKE_TOO_MANY' });
  } else {
    headTake = positiveCount(req.body.headTakeCount, 20);
    tailTake = nonNegativeCount(req.body.tailTakeCount, 0);
    if (headTake + tailTake > maxRepliesTakeCount) return ok(res, { error: 'TAKE_TOO_MANY' });
  }
  const did = positiveInt(req.body.discussionId || req.body.did);
  const discussion = did && await loadDiscussion(did);
  if (!discussion) return ok(res, { error: 'NO_SUCH_DISCUSSION' });
  if (!(await canView(req, discussion))) return ok(res, { error: 'PERMISSION_DENIED' });
  const result = {};
  if (req.body.getDiscussion !== false) {
    result.discussion = await discussionDto(req, discussion);
    result.permissionCreateNewDiscussion = canCreateDiscussion(req);
  }
  if (type === 'IdRange') {
    const where = [];
    const params = [];
    if (req.body.afterId) { where.push('r.rid>?'); params.push(Number(req.body.afterId)); }
    if (req.body.beforeId) { where.push('r.rid<?'); params.push(Number(req.body.beforeId)); }
    result.repliesInRange = await visibleReplies(req, discussion, where, params, idRangeTake);
    result.repliesCountInRange = result.repliesInRange.length;
  } else {
    result.repliesHead = await visibleReplies(req, discussion, [], [], headTake);
    if (tailTake > 0) {
      const tailRows = await db.query(
        `SELECT r.rid,r.did,r.uid,r.content,r.isPublic,r.time,r.updateTime
           FROM discussionReply r
          WHERE r.did=?
          ORDER BY r.rid DESC
          LIMIT ?`,
        [discussion.did, tailTake]
      );
      result.repliesTail = (await Promise.all(tailRows.reverse().map((row) => replyDto(req, row, discussion))))
        .filter((reply) => canManageHiddenReplies(req) || reply.isPublic || reply.publisher.id === uidOf(req));
    } else {
      result.repliesTail = [];
    }
    const countRow = await db.one('SELECT COUNT(*) AS total FROM discussionReply WHERE did=?', [discussion.did]);
    result.repliesTotalCount = Number(countRow.total || 0);
  }
  return ok(res, result);
});

exports.updateDiscussion = handler(async (req, res) => {
  await discussionApi.ensureSchema();
  const source = req.body.discussion || req.body;
  const did = positiveInt(source.discussionId || source.did || req.body.discussionId || req.body.did);
  const discussion = did && await loadDiscussion(did);
  if (!discussion) return ok(res, { error: 'NO_SUCH_DISCUSSION' });
  if (!canModifyDiscussion(req, discussion)) return ok(res, { error: 'PERMISSION_DENIED' });

  const hasPid = Object.prototype.hasOwnProperty.call(source, 'pid') ||
    Object.prototype.hasOwnProperty.call(source, 'problemId');
  let pid = discussion.pid || null;
  if (hasPid) {
    const rawPid = source.problemId ?? source.pid;
    pid = rawPid == null || rawPid === '' ? null : positiveInt(rawPid);
    if (rawPid != null && rawPid !== '' && !pid) return ok(res, { error: 'PERMISSION_DENIED' });
    if (pid && !(await canViewLinkedProblem(req, pid))) return ok(res, { error: 'PERMISSION_DENIED' });
  }

  const hasPublic = Object.prototype.hasOwnProperty.call(source, 'isPublic') ||
    Object.prototype.hasOwnProperty.call(source, 'public');
  const isPublic = hasPublic
    ? (boolValue(source.isPublic ?? source.public, !!discussion.isPublic) ? 1 : 0)
    : discussion.isPublic ? 1 : 0;
  const title = String(source.title ?? discussion.title ?? '').slice(0, 80);
  const content = String(source.content ?? discussion.content ?? '');
  await db.query(
    'UPDATE discussion SET pid=?,title=?,content=?,isPublic=?,updateTime=? WHERE did=?',
    [pid, title, content, isPublic, new Date(), did]
  );
  return ok(res);
});

exports.setDiscussionPublic = handler(async (req, res) => {
  await discussionApi.ensureSchema();
  const did = positiveInt(req.body.discussionId || req.body.did || req.body.id);
  const discussion = did && await db.one('SELECT did,pid,uid,isPublic FROM discussion WHERE did=?', [did]);
  if (!discussion) return ok(res, { error: 'NO_SUCH_DISCUSSION' });
  if (!canManageDiscussionPublicness(req, discussion)) return ok(res, { error: 'PERMISSION_DENIED' });
  const isPublic = boolValue(req.body.isPublic ?? req.body.public, false) ? 1 : 0;
  await db.query('UPDATE discussion SET isPublic=?,updateTime=? WHERE did=?', [isPublic, new Date(), did]);
  return ok(res);
});

exports.setDiscussionReplyPublic = handler(async (req, res) => {
  await discussionApi.ensureSchema();
  const rid = positiveInt(req.body.discussionReplyId || req.body.rid || req.body.id);
  const reply = rid && await db.one('SELECT rid,did,uid,isPublic FROM discussionReply WHERE rid=?', [rid]);
  if (!reply) return ok(res, { error: 'NO_SUCH_DISCUSSION_REPLY' });
  if (!canManageDiscussionPublicness(req, reply)) return ok(res, { error: 'PERMISSION_DENIED' });
  const isPublic = boolValue(req.body.isPublic ?? req.body.public, false) ? 1 : 0;
  await db.query('UPDATE discussionReply SET isPublic=?,updateTime=? WHERE rid=?', [isPublic, new Date(), rid]);
  return ok(res);
});

exports.updateDiscussionReply = handler(async (req, res) => {
  await discussionApi.ensureSchema();
  const rid = positiveInt(req.body.discussionReplyId || req.body.rid);
  const reply = rid && await db.one('SELECT rid,did,uid FROM discussionReply WHERE rid=?', [rid]);
  if (!reply) return ok(res, { error: 'NO_SUCH_DISCUSSION_REPLY' });
  const discussion = await loadDiscussion(reply.did);
  if (!canModifyReply(req, reply)) return ok(res, { error: 'PERMISSION_DENIED' });
  const editTime = new Date();
  await db.query('UPDATE discussionReply SET content=?,updateTime=? WHERE rid=?', [String(req.body.content || ''), editTime, rid]);
  return ok(res, { editTime });
});

exports.deleteDiscussion = handler(async (req, res) => {
  await discussionApi.ensureSchema();
  const did = positiveInt(req.body.discussionId || req.body.did);
  const discussion = did && await loadDiscussion(did);
  if (!discussion) return ok(res, { error: 'NO_SUCH_DISCUSSION' });
  if (!canDeleteDiscussion(req, discussion)) return ok(res, { error: 'PERMISSION_DENIED' });
  await db.tx(async (t) => {
    await t.query('DELETE FROM discussionReplyReaction WHERE rid IN (SELECT rid FROM discussionReply WHERE did=?)', [did]);
    await t.query('DELETE FROM discussionReaction WHERE did=?', [did]);
    await t.query('DELETE FROM discussionReply WHERE did=?', [did]);
    await t.query('DELETE FROM discussion WHERE did=?', [did]);
  });
  return ok(res);
});

exports.deleteDiscussionReply = handler(async (req, res) => {
  await discussionApi.ensureSchema();
  const rid = positiveInt(req.body.discussionReplyId || req.body.rid);
  const reply = rid && await db.one('SELECT rid,did,uid FROM discussionReply WHERE rid=?', [rid]);
  if (!reply) return ok(res, { error: 'NO_SUCH_DISCUSSION_REPLY' });
  const discussion = await loadDiscussion(reply.did);
  if (!canModifyReply(req, reply)) return ok(res, { error: 'PERMISSION_DENIED' });
  await db.tx(async (t) => {
    await t.query('DELETE FROM discussionReplyReaction WHERE rid=?', [rid]);
    await t.query('DELETE FROM discussionReply WHERE rid=?', [rid]);
    await t.query('UPDATE discussion SET replyCnt=GREATEST(replyCnt-1,0) WHERE did=?', [reply.did]);
  });
  return ok(res);
});
