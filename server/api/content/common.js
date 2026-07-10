const { randomInt } = require('crypto');
const db = require('../../db');
const { handler, fail, ok, paginate, buildWhere } = require('../../db/util');
const { briefFormat, Format } = require('../../static');

let settingSchemaReady = null;

const DEFAULT_HOME_CONFIG = {
  blocks: [
    { id: 'notice', type: 'notice', title: '首页公告', column: 'main', enabled: true, content: '' },
    { id: 'announcements', type: 'announcements', title: '公告栏', column: 'main', enabled: true, content: '' },
    { id: 'latest-problems', type: 'latestProblems', title: '最近新增题目', column: 'main', enabled: true, content: '' },
    { id: 'recent-contests', type: 'recentContests', title: '最近比赛', column: 'main', enabled: true, content: '' },
    { id: 'top-users', type: 'topUsers', title: '用户排行', column: 'side', enabled: true, content: '' },
    { id: 'hitokoto', type: 'hitokoto', title: '一言（ヒトコト）', column: 'side', enabled: true, content: '' },
    { id: 'countdown', type: 'countdown', title: '倒计时', column: 'side', enabled: true, content: '' },
    { id: 'problem-search', type: 'problemSearch', title: '搜索题目', column: 'side', enabled: true, content: '' },
    { id: 'friend-links', type: 'friendLinks', title: '友情链接', column: 'side', enabled: true, content: '' },
    { id: 'rabbit-data', type: 'rabbitData', title: '点击数统计', column: 'side', enabled: true, content: '' },
  ],
};

const HOME_BLOCK_TYPES = new Set([
  'announcements',
  'hitokoto',
  'rabbitData',
  'topUsers',
  'latestProblems',
  'recentContests',
  'notice',
  'countdown',
  'problemSearch',
  'friendLinks',
  'markdown',
]);

const ensureSettingSchema = () => {
  if (!settingSchemaReady) {
    settingSchemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS siteSetting (
        \`key\` VARCHAR(64) PRIMARY KEY,
        value MEDIUMTEXT NOT NULL,
        updateTime DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
  return settingSchemaReady;
};

const cloneDefaultHomeConfig = () => JSON.parse(JSON.stringify(DEFAULT_HOME_CONFIG));

const normalizeHomeBlock = (block, index) => {
  const type = String(block && block.type || '').trim();
  if (!HOME_BLOCK_TYPES.has(type)) return null;
  const rawId = String(block.id || '').trim();
  const id = /^[a-zA-Z0-9_-]{1,40}$/.test(rawId) ? rawId : `${type}-${index + 1}`;
  const title = String(block.title || '').trim().slice(0, 80) || '首页模块';
  const column = block.column === 'side' ? 'side' : 'main';
  const content = String(block.content || '').slice(0, 10000);
  return {
    id,
    type,
    title,
    column,
    enabled: !!block.enabled,
    content: type === 'markdown' ? content : '',
  };
};

const normalizeHomeConfig = (config, fallbackHomepageSettings = null) => {
  const rawBlocks = config && Array.isArray(config.blocks) ? config.blocks : DEFAULT_HOME_CONFIG.blocks;
  const blocks = rawBlocks.map(normalizeHomeBlock).filter(Boolean).slice(0, 20);
  const normalized = { blocks: blocks.length ? blocks : cloneDefaultHomeConfig().blocks };
  const homepageSettings = config && config.homepageSettings ? config.homepageSettings : fallbackHomepageSettings;
  if (homepageSettings && typeof homepageSettings === 'object') {
    normalized.homepageSettings = homepageSettings;
  }
  return normalized;
};

const readHomeConfig = async () => {
  await ensureSettingSchema();
  const row = await db.one('SELECT value FROM siteSetting WHERE `key`=?', ['home.config']);
  if (!row) return cloneDefaultHomeConfig();
  try {
    return normalizeHomeConfig(JSON.parse(row.value));
  } catch (_) {
    return cloneDefaultHomeConfig();
  }
};

const getMark = () => {
  const time = Date.now().toString(36);
  const str = Math.random().toString(36).slice(2, 7);
  return `${time}-${str}`;
};

exports.getHomeConfig = handler(async (req, res) => {
  const config = await readHomeConfig();
  return ok(res, { data: config });
});

exports.updateHomeConfig = handler(async (req, res) => {
  if (!req.can('system.homepage.manage')) return fail(res, '无权限修改首页设置');
  await ensureSettingSchema();
  const current = await readHomeConfig();
  const config = normalizeHomeConfig(req.body.config || {}, current.homepageSettings || null);
  await db.query(
    'INSERT INTO siteSetting(`key`,value,updateTime) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value=VALUES(value),updateTime=VALUES(updateTime)',
    ['home.config', JSON.stringify(config), new Date()]
  );
  return ok(res, { data: config });
});

exports.getAnnouncementList = handler(async (req, res) => {
  const rows = await db.query('SELECT aid,time,title FROM announcement ORDER BY weight DESC LIMIT 5');
  for (const r of rows) r.time = briefFormat(r.time);
  return ok(res, { data: rows });
});

exports.getAnnouncementInfo = handler(async (req, res) => {
  const row = await db.one('SELECT * FROM announcement WHERE aid=?', [req.body.aid]);
  if (!row) return fail(res, 'error');
  row.time = briefFormat(row.time);
  return ok(res, { data: row });
});

exports.getPaste = handler(async (req, res) => {
  const row = await db.one(
    'SELECT title,mark,content,uid,time,isPublic FROM pastes WHERE mark=?',
    [req.body.mark]
  );
  if (!row) return fail(res, '未找到');
  if (!req.can('paste.edit.any') && !row.isPublic && row.uid !== req.session.uid) {
    return fail(res, '无权限查看');
  }
  row.time = Format(row.time);
  const author = await db.one('SELECT name FROM userInfo WHERE uid=?', [row.uid]);
  row.paster = author ? author.name : null;
  return ok(res, { data: row });
});

exports.addPaste = handler(async (req, res) => {
  const mark = getMark();
  const result = await db.query(
    'INSERT INTO pastes(mark,title,content,uid,time,isPublic) VALUES (?,?,?,?,?,?)',
    [mark, '请输入标题', '请输入内容', req.session.uid, new Date(), 0]
  );
  if (!result.affectedRows) return fail(res, 'error');
  return ok(res, { mark });
});

exports.updatePaste = handler(async (req, res) => {
  const { paste } = req.body;
  const { content, title } = paste;
  if (title.length > 20) return fail(res, '标题长度不可大于20');
  if (paste.length > 10000) return fail(res, '内容长度不可大于10000');

  const owner = await db.one('SELECT uid FROM pastes WHERE mark=?', [paste.mark]);
  if (!owner) return fail(res, '未找到');
  if (!req.can('paste.edit.any') && req.session.uid !== owner.uid) {
    return fail(res, '你只能修改自己的paste');
  }

  const result = await db.query(
    'UPDATE pastes SET title=?,content=?,isPublic=?,time=? WHERE mark=?',
    [title, content, paste.isPublic, new Date(), paste.mark]
  );
  if (!result.affectedRows) return fail(res, 'failed');
  return ok(res);
});

exports.delPaste = handler(async (req, res) => {
  const { mark } = req.body;
  const owner = await db.one('SELECT uid FROM pastes WHERE mark=?', [mark]);
  if (!owner) return fail(res, '未找到');
  if (!req.can('paste.edit.any') && req.session.uid !== owner.uid) {
    return fail(res, '你只能删除自己的paste');
  }
  const result = await db.query('DELETE FROM pastes WHERE mark=?', [mark]);
  if (!result.affectedRows) return fail(res, 'failed');
  return ok(res);
});

exports.getPasteList = handler(async (req, res) => {
  const { offset, limit } = paginate(req);
  let uid = req.body.uid || null;
  if (!req.can('paste.edit.any')) uid = req.session.uid;

  const cond = [['p.uid=?', uid]];
  const { where, params } = buildWhere(cond);

  const list = await db.query(
    'SELECT p.id,p.mark,p.title,p.uid,p.time,p.isPublic,u.name as publisher ' +
      'FROM pastes p INNER JOIN userInfo u ON u.uid = p.uid' +
      `${where} ORDER BY p.id DESC LIMIT ?,?`,
    [...params, offset, limit]
  );
  for (const r of list) r.time = Format(r.time);

  const cntRow = await db.one(
    `SELECT COUNT(*) as total FROM pastes p${where}`,
    params
  );
  return ok(res, { total: cntRow.total, data: list });
});

const hitokoto = require('../../hitokoto/hitokoto.json');
const hitokotoLen = hitokoto.length;

exports.getHitokoto = (req, res) => {
  return res.status(200).send(hitokoto[randomInt(hitokotoLen)]);
};

exports._home = {
  ensureSettingSchema,
  normalizeHomeConfig,
  readHomeConfig,
};
