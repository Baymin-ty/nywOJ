const db = require('../../db');
const { handler, fail, ok, paginate, buildWhere } = require('../../db/util');
const config = require('../../config.json');
const { Format, briefFormat } = require('../../static');
const { problemAuth } = require('../problem/core');

let schemaReady = null;

const REACTION_KEYS = ['like', 'helpful', 'thanks', 'wow'];

const ensureSchema = () => {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS discussion (
          did INT AUTO_INCREMENT PRIMARY KEY,
          pid INT NULL,
          uid INT NOT NULL,
          title VARCHAR(80) NOT NULL,
          content MEDIUMTEXT NOT NULL,
          isPublic TINYINT NOT NULL DEFAULT 1,
          time DATETIME NOT NULL,
          updateTime DATETIME NOT NULL,
          lastReplyTime DATETIME NULL,
          replyCnt INT NOT NULL DEFAULT 0,
          KEY idx_pid_last_reply (pid, lastReplyTime),
          KEY idx_uid_time (uid, time),
          KEY idx_last_reply (lastReplyTime)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS discussionReply (
          rid INT AUTO_INCREMENT PRIMARY KEY,
          did INT NOT NULL,
          uid INT NOT NULL,
          content MEDIUMTEXT NOT NULL,
          isPublic TINYINT NOT NULL DEFAULT 1,
          time DATETIME NOT NULL,
          updateTime DATETIME NOT NULL,
          KEY idx_did_time (did, time),
          KEY idx_uid_time (uid, time)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS discussionReaction (
          did INT NOT NULL,
          uid INT NOT NULL,
          reaction VARCHAR(24) NOT NULL,
          time DATETIME NOT NULL,
          PRIMARY KEY (did, uid, reaction),
          KEY idx_did (did),
          KEY idx_uid (uid)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS discussionReplyReaction (
          rid INT NOT NULL,
          uid INT NOT NULL,
          reaction VARCHAR(24) NOT NULL,
          time DATETIME NOT NULL,
          PRIMARY KEY (rid, uid, reaction),
          KEY idx_rid (rid),
          KEY idx_uid (uid)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })();
  }
  return schemaReady;
};
exports.ensureSchema = ensureSchema;

const uidOf = (req) => (req.session && req.session.uid) || 0;

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

const scopedResourceIds = (req, permissionKeys, resourceType) => {
  const ids = new Set();
  const prefix = `${resourceType}:`;
  for (const key of permissionKeys) {
    const bucket = req.perms?.scoped?.get(key);
    if (!bucket) continue;
    for (const tag of bucket) {
      if (!tag.startsWith(prefix)) continue;
      const id = Number(tag.slice(prefix.length));
      if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    }
  }
  return [...ids];
};

const hasGlobalDiscussionAccess = (req, keys = ['discussion.manage']) =>
  !!(req.can && keys.some((key) => req.can(key)));

const canCreateDiscussion = (req) => !!uidOf(req) && (
  allowEveryoneCreateDiscussion() ||
  hasGlobalDiscussionAccess(req, ['discussion.manage'])
);

const canViewLinkedProblem = async (req, pid) => {
  if (!pid) return true;
  const auth = await problemAuth(req, pid);
  return !!(auth && auth.view);
};

const canManageDiscussion = (req, row) => {
  if (!row) return false;
  return row.uid === uidOf(req) || (req.can && req.can('discussion.manage'));
};

const canViewDiscussion = async (req, row) => {
  if (!row) return false;
  const directAccess = row.uid === uidOf(req) ||
    (req.can && (
      req.can('discussion.manage') ||
      req.can('discussion.view.any') ||
      req.can('discussion.reply.any')
    ));
  if (!directAccess && !(await canViewLinkedProblem(req, row.pid))) return false;
  return !!row.isPublic || directAccess;
};

const canReplyDiscussion = async (req, row) => {
  if (!uidOf(req) || !(await canViewDiscussion(req, row))) return false;
  return !!row.isPublic || canManageDiscussion(req, row) ||
    (req.can && req.can('discussion.reply.any'));
};

const canEditDiscussion = (req, row) => canManageDiscussion(req, row);

const canEditReply = async (req, row) => {
  if (!row) return false;
  if (row.uid === uidOf(req)) return true;
  const discussion = await db.one('SELECT did,uid FROM discussion WHERE did=?', [row.did]);
  return canManageDiscussion(req, discussion);
};

const buildLinkedProblemVisibility = (req) => {
  if (req.can('problem.view.any') || req.can('problem.manage.any')) return null;
  const uid = uidOf(req);
  const parts = ['d.pid IS NULL', 'p.isPublic=1'];
  const params = [];
  if (uid) {
    parts.push('p.publisher=?');
    params.push(uid);
  }
  const scopedPids = scopedResourceIds(req, ['problem.manage.any', 'problem.view.any'], 'problem');
  if (scopedPids.length) {
    parts.push(`d.pid IN (${scopedPids.map(() => '?').join(',')})`);
    params.push(...scopedPids);
  }
  return [`(${parts.join(' OR ')})`, ...params];
};

const normalizeTitle = (title) => String(title || '').trim();

const normalizeContent = (content) => String(content || '').trim();

const normalizeReaction = (value) => String(value || '').trim().toLowerCase();

const normalizeTargetType = (value) => {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'discussion') return 'discussion';
  if (type === 'reply' || type === 'discussionreply' || type === 'discussion_reply') return 'reply';
  return '';
};

const isValidReaction = (reaction) => REACTION_KEYS.includes(reaction);

const emptyReactions = () => REACTION_KEYS.map((key) => ({ key, count: 0, mine: false }));

const positiveInt = (value) => {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const problemIdFilter = (body) => {
  const raw = Object.prototype.hasOwnProperty.call(body, 'problemId') ? body.problemId : body.pid;
  if (raw == null || raw === '') return { specified: false, all: false, pid: null };
  if (String(raw).trim().toLowerCase() === 'all' || Number(raw) === -1) {
    return { specified: true, all: true, pid: null };
  }
  return { specified: true, all: false, pid: positiveInt(raw) };
};

const loadDiscussion = (did) =>
  db.one(
    'SELECT d.did,d.pid,d.uid,d.title,d.content,d.isPublic,d.time,d.updateTime,d.lastReplyTime,d.replyCnt,u.name as publisher,p.title as problemTitle ' +
      'FROM discussion d INNER JOIN userInfo u ON u.uid=d.uid ' +
      'LEFT JOIN problem p ON p.pid=d.pid WHERE d.did=?',
    [did]
  );

const attachReactions = async (req, rows, options) => {
  if (!rows.length) return;
  const ids = [...new Set(rows.map((row) => row[options.rowKey]).filter(Boolean))];
  if (!ids.length) return;

  const reactionById = new Map();
  for (const id of ids) reactionById.set(id, emptyReactions());

  const counts = await db.query(
    `SELECT ${options.idColumn} AS id,reaction,COUNT(*) AS cnt FROM ${options.table} ` +
      `WHERE ${options.idColumn} IN (?) GROUP BY ${options.idColumn},reaction`,
    [ids]
  );
  for (const row of counts) {
    const list = reactionById.get(row.id);
    if (!list) continue;
    const item = list.find((reaction) => reaction.key === row.reaction);
    if (item) item.count = Number(row.cnt) || 0;
  }

  const uid = uidOf(req);
  if (uid) {
    const mine = await db.query(
      `SELECT ${options.idColumn} AS id,reaction FROM ${options.table} WHERE ${options.idColumn} IN (?) AND uid=?`,
      [ids, uid]
    );
    for (const row of mine) {
      const list = reactionById.get(row.id);
      if (!list) continue;
      const item = list.find((reaction) => reaction.key === row.reaction);
      if (item) item.mine = true;
    }
  }

  for (const row of rows) {
    row.reactions = reactionById.get(row[options.rowKey]) || emptyReactions();
  }
};

const attachDiscussionReactions = (req, rows) =>
  attachReactions(req, rows, {
    table: 'discussionReaction',
    idColumn: 'did',
    rowKey: 'did',
  });

const attachReplyReactions = (req, rows) =>
  attachReactions(req, rows, {
    table: 'discussionReplyReaction',
    idColumn: 'rid',
    rowKey: 'rid',
  });

exports.getDiscussionList = handler(async (req, res) => {
  await ensureSchema();
  const { offset, limit } = paginate(req);
  const uid = uidOf(req);
  const problemFilter = problemIdFilter(req.body);
  const pid = problemFilter.pid;
  const authorUid = req.body.publisherId ? positiveInt(req.body.publisherId) : (req.body.uid ? positiveInt(req.body.uid) : null);
  const keyword = normalizeTitle(req.body.keyword);
  if (problemFilter.specified && !problemFilter.all && !pid) return fail(res, '题目 ID 无效');
  if ((req.body.publisherId || req.body.uid) && !authorUid) return fail(res, '用户 ID 无效');

  if (pid && !hasGlobalDiscussionAccess(req, ['discussion.manage', 'discussion.view.any', 'discussion.reply.any']) &&
    !(await canViewLinkedProblem(req, pid))) {
    return fail(res, '无权限查看题目讨论');
  }

  const cond = [];
  if (problemFilter.all) cond.push(['d.pid IS NOT NULL']);
  else if (pid) cond.push(['d.pid=?', pid]);
  else cond.push(['d.pid IS NULL']);
  if (authorUid) cond.push(['d.uid=?', authorUid]);
  if (keyword) cond.push(['d.title LIKE ?', `%${keyword}%`]);
  if (!hasGlobalDiscussionAccess(req, ['discussion.manage', 'discussion.view.any', 'discussion.reply.any'])) {
    const visibilityParts = [];
    const visibilityParams = [];
    const linkedVisibility = buildLinkedProblemVisibility(req);
    if (linkedVisibility) {
      visibilityParts.push(`(d.isPublic=1 AND ${linkedVisibility[0]})`);
      visibilityParams.push(...linkedVisibility.slice(1));
    } else {
      visibilityParts.push('d.isPublic=1');
    }
    if (uid) {
      visibilityParts.push('d.uid=?');
      visibilityParams.push(uid);
    }
    cond.push([`(${visibilityParts.join(' OR ')})`, ...visibilityParams]);
  }

  const { where, params } = buildWhere(cond);
  const rows = await db.query(
    'SELECT d.did,d.pid,d.uid,d.title,d.isPublic,d.time,d.updateTime,d.lastReplyTime,d.replyCnt,u.name as publisher,p.title as problemTitle ' +
      'FROM discussion d INNER JOIN userInfo u ON u.uid=d.uid ' +
      'LEFT JOIN problem p ON p.pid=d.pid ' +
      `${where} ORDER BY COALESCE(d.lastReplyTime,d.updateTime,d.time) DESC,d.did DESC LIMIT ?,?`,
    [...params, offset, limit]
  );
  for (const r of rows) {
    r.time = briefFormat(r.time);
    r.updateTime = Format(r.updateTime);
    r.lastReplyTime = r.lastReplyTime ? Format(r.lastReplyTime) : '';
    r.canEdit = canEditDiscussion(req, r);
  }
  await attachDiscussionReactions(req, rows);
  const cnt = await db.one(
    `SELECT COUNT(*) as total FROM discussion d LEFT JOIN problem p ON p.pid=d.pid${where}`,
    params
  );
  return ok(res, { total: cnt.total, data: rows });
});

exports.getDiscussion = handler(async (req, res) => {
  await ensureSchema();
  const did = positiveInt(req.body.did);
  if (!did) return fail(res, '讨论 ID 无效');
  const row = await loadDiscussion(did);
  if (!row) return fail(res, '未找到讨论');
  if (!(await canViewDiscussion(req, row))) return fail(res, '无权限查看');

  row.time = Format(row.time);
  row.updateTime = Format(row.updateTime);
  row.lastReplyTime = row.lastReplyTime ? Format(row.lastReplyTime) : '';
  row.canEdit = canEditDiscussion(req, row);
  row.canReply = await canReplyDiscussion(req, row);
  await attachDiscussionReactions(req, [row]);
  return ok(res, { data: row });
});

exports.addDiscussion = handler(async (req, res) => {
  await ensureSchema();
  const uid = uidOf(req);
  if (!uid) return fail(res, '请先登录');
  if (!canCreateDiscussion(req)) return fail(res, '无权限发起讨论');

  const pid = req.body.pid ? positiveInt(req.body.pid) : null;
  if (req.body.pid && !pid) return fail(res, '题目 ID 无效');
  if (pid && !(await canViewLinkedProblem(req, pid))) return fail(res, '无权限在此题下发起讨论');

  const now = new Date();
  const result = await db.query(
    'INSERT INTO discussion(pid,uid,title,content,isPublic,time,updateTime,lastReplyTime) VALUES (?,?,?,?,?,?,?,?)',
    [pid, uid, '请输入标题', '请输入内容', discussionDefaultPublic() ? 1 : 0, now, now, now]
  );
  if (!result.affectedRows) return fail(res, '创建讨论失败');
  return ok(res, { did: result.insertId });
});

exports.updateDiscussion = handler(async (req, res) => {
  await ensureSchema();
  const discussion = req.body.discussion || {
    did: req.body.discussionId || req.body.did,
    title: req.body.title,
    content: req.body.content,
    pid: req.body.problemId || req.body.pid,
    isPublic: req.body.isPublic,
  };
  const did = positiveInt(discussion.did || discussion.discussionId || req.body.did);
  if (!did) return fail(res, '讨论 ID 无效');
  const row = await db.one('SELECT did,pid,uid,isPublic FROM discussion WHERE did=?', [did]);
  if (!row) return fail(res, '未找到讨论');
  if (!canEditDiscussion(req, row)) return fail(res, '你只能修改自己的讨论');

  const title = normalizeTitle(discussion.title);
  const content = normalizeContent(discussion.content);
  const pid = discussion.pid ? positiveInt(discussion.pid) : null;
  const isPublic = discussion.isPublic == null ? row.isPublic : discussion.isPublic ? 1 : 0;
  if (!title || title.length > 80) return fail(res, '标题长度需在 1 到 80 字之间');
  if (!content || content.length > 30000) return fail(res, '内容长度需在 1 到 30000 字之间');
  if (discussion.pid && !pid) return fail(res, '题目 ID 无效');
  if (pid && !(await canViewLinkedProblem(req, pid))) return fail(res, '无权限绑定此题目');

  const result = await db.query(
    'UPDATE discussion SET pid=?,title=?,content=?,isPublic=?,updateTime=? WHERE did=?',
    [pid, title, content, isPublic, new Date(), did]
  );
  if (!result.affectedRows) return fail(res, '更新讨论失败');
  return ok(res);
});

exports.delDiscussion = handler(async (req, res) => {
  await ensureSchema();
  const did = positiveInt(req.body.did);
  if (!did) return fail(res, '讨论 ID 无效');
  const row = await db.one('SELECT did,uid FROM discussion WHERE did=?', [did]);
  if (!row) return fail(res, '未找到讨论');
  if (!canEditDiscussion(req, row)) return fail(res, '你只能删除自己的讨论');

  await db.tx(async (t) => {
    await t.query('DELETE FROM discussionReplyReaction WHERE rid IN (SELECT rid FROM discussionReply WHERE did=?)', [did]);
    await t.query('DELETE FROM discussionReaction WHERE did=?', [did]);
    await t.query('DELETE FROM discussionReply WHERE did=?', [did]);
    await t.query('DELETE FROM discussion WHERE did=?', [did]);
  });
  return ok(res);
});

exports.getReplies = handler(async (req, res) => {
  await ensureSchema();
  const { offset, limit } = paginate(req, 30);
  const did = positiveInt(req.body.did);
  if (!did) return fail(res, '讨论 ID 无效');
  const discussion = await db.one('SELECT did,pid,uid,isPublic FROM discussion WHERE did=?', [did]);
  if (!discussion) return fail(res, '未找到讨论');
  if (!(await canViewDiscussion(req, discussion))) return fail(res, '无权限查看');

  const cond = [['r.did=?', did]];
  const canManage = canManageDiscussion(req, discussion);
  if (!canManage) cond.push(['(r.isPublic=1 OR r.uid=?)', uidOf(req)]);
  const { where, params } = buildWhere(cond);
  const rows = await db.query(
    'SELECT r.rid,r.did,r.uid,r.content,r.isPublic,r.time,r.updateTime,u.name as publisher ' +
      'FROM discussionReply r INNER JOIN userInfo u ON u.uid=r.uid' +
      `${where} ORDER BY r.time ASC,r.rid ASC LIMIT ?,?`,
    [...params, offset, limit]
  );
  for (const r of rows) {
    r.time = Format(r.time);
    r.updateTime = Format(r.updateTime);
    r.canEdit = r.uid === uidOf(req) || canManage;
  }
  await attachReplyReactions(req, rows);
  const cnt = await db.one(`SELECT COUNT(*) as total FROM discussionReply r${where}`, params);
  return ok(res, { total: cnt.total, data: rows });
});

exports.addReply = handler(async (req, res) => {
  await ensureSchema();
  const uid = uidOf(req);
  if (!uid) return fail(res, '请先登录');
  const did = positiveInt(req.body.did);
  if (!did) return fail(res, '讨论 ID 无效');
  const discussion = await db.one('SELECT did,pid,uid,isPublic FROM discussion WHERE did=?', [did]);
  if (!discussion) return fail(res, '未找到讨论');
  if (!(await canReplyDiscussion(req, discussion))) return fail(res, '无权限回复');

  const content = normalizeContent(req.body.content);
  if (!content || content.length > 20000) return fail(res, '回复长度需在 1 到 20000 字之间');

  const now = new Date();
  const result = await db.tx(async (t) => {
    const inserted = await t.query(
      'INSERT INTO discussionReply(did,uid,content,isPublic,time,updateTime) VALUES (?,?,?,?,?,?)',
      [did, uid, content, discussionReplyDefaultPublic() ? 1 : 0, now, now]
    );
    await t.query('UPDATE discussion SET replyCnt=replyCnt+1,lastReplyTime=?,updateTime=? WHERE did=?', [now, now, did]);
    return inserted;
  });
  if (!result.affectedRows) return fail(res, '回复失败');
  // 通知讨论作者（自己回自己不通知）
  if (discussion.uid && discussion.uid !== uid) {
    const replier = await db.one('SELECT name FROM userInfo WHERE uid=?', [uid]).catch(() => null);
    require('./notification').push(discussion.uid, {
      type: 'discussion_reply', refType: 'discussion', refId: did,
      title: `${(replier && replier.name) || '有人'} 回复了你的讨论`,
      content: content.slice(0, 200), link: `/discussion/${did}`, excludeUid: uid,
    }).catch(() => {});
  }
  return ok(res, { rid: result.insertId });
});

exports.updateReply = handler(async (req, res) => {
  await ensureSchema();
  const reply = req.body.reply || {};
  const rid = positiveInt(reply.rid || req.body.rid);
  if (!rid) return fail(res, '回复 ID 无效');
  const row = await db.one('SELECT rid,did,uid,isPublic FROM discussionReply WHERE rid=?', [rid]);
  if (!row) return fail(res, '未找到回复');
  if (!(await canEditReply(req, row))) return fail(res, '你只能修改自己的回复');

  const content = normalizeContent(reply.content);
  const isPublic = reply.isPublic ? 1 : 0;
  if (!content || content.length > 20000) return fail(res, '回复长度需在 1 到 20000 字之间');

  const result = await db.query(
    'UPDATE discussionReply SET content=?,isPublic=?,updateTime=? WHERE rid=?',
    [content, isPublic, new Date(), rid]
  );
  if (!result.affectedRows) return fail(res, '更新回复失败');
  return ok(res);
});

exports.delReply = handler(async (req, res) => {
  await ensureSchema();
  const rid = positiveInt(req.body.rid);
  if (!rid) return fail(res, '回复 ID 无效');
  const row = await db.one('SELECT rid,did,uid FROM discussionReply WHERE rid=?', [rid]);
  if (!row) return fail(res, '未找到回复');
  if (!(await canEditReply(req, row))) return fail(res, '你只能删除自己的回复');

  await db.tx(async (t) => {
    await t.query('DELETE FROM discussionReplyReaction WHERE rid=?', [rid]);
    await t.query('DELETE FROM discussionReply WHERE rid=?', [rid]);
    await t.query('UPDATE discussion SET replyCnt=GREATEST(replyCnt-1,0) WHERE did=?', [row.did]);
  });
  return ok(res);
});

exports.toggleReaction = handler(async (req, res) => {
  await ensureSchema();
  const uid = uidOf(req);
  if (!uid) return fail(res, '请先登录');

  const targetType = normalizeTargetType(req.body.targetType || req.body.type);
  const id = positiveInt(req.body.id);
  const reaction = normalizeReaction(req.body.reactionKey || req.body.key || req.body.emoji || req.body.reaction);
  const hasDesiredState = typeof req.body.selected === 'boolean' || typeof req.body.reaction === 'boolean';
  const desiredState = typeof req.body.selected === 'boolean' ? req.body.selected : req.body.reaction;
  if (!targetType) return fail(res, 'Reaction 目标无效');
  if (!id) return fail(res, 'Reaction 目标 ID 无效');
  if (!isValidReaction(reaction)) return fail(res, 'Reaction 类型无效');

  let table = '';
  let idColumn = '';
  if (targetType === 'discussion') {
    const discussion = await db.one('SELECT did,pid,uid,isPublic FROM discussion WHERE did=?', [id]);
    if (!discussion) return fail(res, '未找到讨论');
    if (!(await canViewDiscussion(req, discussion))) return fail(res, '无权限操作');
    table = 'discussionReaction';
    idColumn = 'did';
  } else {
    const reply = await db.one(
      'SELECT r.rid,r.did,r.uid,r.isPublic,d.pid,d.uid AS discussionUid,d.isPublic AS discussionPublic ' +
        'FROM discussionReply r INNER JOIN discussion d ON d.did=r.did WHERE r.rid=?',
      [id]
    );
    if (!reply) return fail(res, '未找到回复');
    const discussion = {
      did: reply.did,
      pid: reply.pid,
      uid: reply.discussionUid,
      isPublic: reply.discussionPublic,
    };
    if (!(await canViewDiscussion(req, discussion))) return fail(res, '无权限操作');
    if (!reply.isPublic && reply.uid !== uid && !canManageDiscussion(req, discussion)) return fail(res, '无权限操作');
    table = 'discussionReplyReaction';
    idColumn = 'rid';
  }

  const selected = await db.tx(async (t) => {
    const existing = await t.one(`SELECT uid FROM ${table} WHERE ${idColumn}=? AND uid=? AND reaction=?`, [
      id,
      uid,
      reaction,
    ]);
    if (hasDesiredState) {
      if (desiredState && !existing) {
        await t.query(`INSERT IGNORE INTO ${table}(${idColumn},uid,reaction,time) VALUES (?,?,?,?)`, [
          id,
          uid,
          reaction,
          new Date(),
        ]);
      } else if (!desiredState && existing) {
        await t.query(`DELETE FROM ${table} WHERE ${idColumn}=? AND uid=? AND reaction=?`, [id, uid, reaction]);
      }
      return !!desiredState;
    }
    if (existing) {
      await t.query(`DELETE FROM ${table} WHERE ${idColumn}=? AND uid=? AND reaction=?`, [id, uid, reaction]);
      return false;
    }
    await t.query(`INSERT IGNORE INTO ${table}(${idColumn},uid,reaction,time) VALUES (?,?,?,?)`, [
      id,
      uid,
      reaction,
      new Date(),
    ]);
    return true;
  });

  return ok(res, { selected });
});
