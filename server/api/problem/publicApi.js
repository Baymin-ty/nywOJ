const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const db = require('../../db');
const { handler, ok, fail } = require('../../db/util');
const config = require('../../config.json');
const policy = require('../../auth/policy');
const { syncPermissionCatalog } = require('../../auth/sync');
const { ensureGroupSchema } = require('../../groupSchema');
const storage = require('../../storage');
const { recordEvent } = require('../../static');
const problemApi = require('./core');
const judgeProfileApi = require('./judgeProfile');
const { ensureContestRatingStorageSchema, latestRatingJoin, effectiveRatingExpr } = require('../contest/ratingStorage');

const DEFAULT_LOCALE = 'zh-CN';
const MAX_QUERY_TAKE = 100;
const PROBLEM_FILE_TMP_DIR = path.resolve(__dirname, '..', '..', 'tmp', 'problemFileUpload');
const DATA_CONTROL_FILES = new Set(['config.json', 'preview.json', 'profile.json', 'profile.yaml', 'profile.yml']);
const SAFE_FILE_RE = /^[A-Za-z0-9._-]{1,64}$/;

const STATUS_BY_RESULT = {
  0: 'Pending',
  1: 'Pending',
  2: 'Pending',
  3: 'CompilationError',
  4: 'Accepted',
  5: 'WrongAnswer',
  6: 'TimeLimitExceeded',
  7: 'MemoryLimitExceeded',
  8: 'RuntimeError',
  9: 'RuntimeError',
  10: 'OutputLimitExceeded',
  11: 'RuntimeError',
  12: 'SystemError',
  13: 'Canceled',
  14: 'Pending',
  15: 'PartiallyCorrect',
  16: 'JudgementFailed',
};

let compatSchemaReady = null;
let permissionCatalogReady = null;

const uidOf = (req) => (req.session && req.session.uid) || 0;

const queryLimitNumber = (key, fallback) => {
  const section = config.queryLimit || config.QUERY_LIMIT || {};
  const value = section[key];
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const positiveInt = (value) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const dataDir = (pid) => path.join(__dirname, '..', '..', 'data', String(pid));
const assetsDir = (pid) => path.join(dataDir(pid), 'assets');

const ensureCompatSchema = () => {
  if (!compatSchemaReady) {
    compatSchemaReady = (async () => {
      await problemApi.ensureProblemTagSchema();
      await ensureProblemSampleSchema();
      await ensureUserMetaColumns();
      await db.query(`
        CREATE TABLE IF NOT EXISTS problemCompatMeta (
          pid INT NOT NULL PRIMARY KEY,
          defaultLocale VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
          judgeInfo MEDIUMTEXT NULL,
          submittable TINYINT NOT NULL DEFAULT 1,
          updateTime DATETIME NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })();
  }
  return compatSchemaReady;
};

const ensurePermissionCatalog = () => {
  if (!permissionCatalogReady) permissionCatalogReady = syncPermissionCatalog();
  return permissionCatalogReady;
};

const ensureProblemSampleSchema = () => db.query(`
  CREATE TABLE IF NOT EXISTS problemSample (
    pid INT NOT NULL,
    samples MEDIUMTEXT NOT NULL,
    updateTime DATETIME NOT NULL,
    PRIMARY KEY (pid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

const ensureUserMetaColumns = async () => {
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
};

const normalizeLocale = (locale) => {
  const value = String(locale || '').trim();
  if (!value) return DEFAULT_LOCALE;
  if (!/^[A-Za-z]{2,8}([-_][A-Za-z0-9]{2,8})?$/.test(value)) return DEFAULT_LOCALE;
  const [head, tail] = value.replace('_', '-').split('-');
  return tail ? `${head.toLowerCase()}-${tail.toUpperCase()}` : head.toLowerCase();
};

const parseJsonArray = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
};

const parseJsonObject = (value, fallback = null) => {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value || 'null');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
};

const parseAvatar = (row) => {
  const info = String(row.avatarInfo || '').trim();
  const pos = info.indexOf(':');
  if (pos > 0) return { type: info.slice(0, pos), key: info.slice(pos + 1) };
  if (row.qq) return { type: 'qq', key: String(row.qq) };
  return { type: 'qq', key: '' };
};

const canViewUserEmail = (req, row) =>
  !!(row && row.publicEmail) ||
  Number(row && row.uid) === Number(uidOf(req)) ||
  !!(req.can && (req.can('user.manage') || req.can('user.role.admin')));

const userMeta = async (req, uid) => {
  if (!uid) return null;
  await ensureUserMetaColumns();
  const row = await db.one(
    `SELECT u.uid,u.name,u.email,u.publicEmail,u.qq,u.avatarInfo,u.nickname,u.bio,${effectiveRatingExpr('u')} AS rating,u.reg_time,
            (SELECT COUNT(DISTINCT s.pid) FROM submission s WHERE s.uid=u.uid AND s.judgeResult=4) AS acceptedProblemCount,
            (SELECT COUNT(*) FROM submission s2 WHERE s2.uid=u.uid) AS submissionCount
       FROM userInfo u ${latestRatingJoin('u')} WHERE u.uid=?`,
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

const groupMeta = async (gid) => {
  await ensureGroupSchema();
  const row = await db.one('SELECT gid,name,memberCnt,createTime FROM user_groups WHERE gid=?', [gid]);
  if (!row) return null;
  return {
    id: row.gid,
    gid: row.gid,
    name: row.name,
    memberCount: Number(row.memberCnt || 0),
    memberCnt: Number(row.memberCnt || 0),
    createTime: row.createTime,
  };
};

const tagLocales = (row) => {
  const parsed = parseJsonArray(row && row.locales, []);
  return parsed.map((item) => ({
    locale: normalizeLocale(item && item.locale),
    name: String(item && item.name || '').trim(),
  })).filter((item) => item.name);
};

const tagNameForLocale = (localizedNames, locale) => {
  const desired = normalizeLocale(locale);
  const base = desired.split('-')[0];
  const exact = localizedNames.find((item) => item.locale === desired);
  const baseMatch = base && localizedNames.find((item) => item.locale === base);
  const defaultMatch = localizedNames.find((item) => item.locale === DEFAULT_LOCALE);
  return (exact || baseMatch || defaultMatch || localizedNames[0] || {}).name || '';
};

const listCatalogTags = async () => {
  await problemApi.ensureProblemTagSchema();
  const rows = await db.query('SELECT id,color,locales,createTime,updateTime FROM problemTag ORDER BY id');
  return rows.map((row) => ({ ...row, localizedNames: tagLocales(row) }));
};

const catalogTagForName = (catalog, name) => {
  const key = String(name || '').trim().toLowerCase();
  return catalog.find((row) => row.localizedNames.some((item) => item.name.toLowerCase() === key)) || null;
};

const localizedTagDto = (tag, locale, fallbackName = '') => ({
  id: tag ? tag.id : 0,
  color: tag ? tag.color : '#909399',
  locale: normalizeLocale(locale),
  name: tag ? tagNameForLocale(tag.localizedNames, locale) : fallbackName,
});

const localizedTagDtosForNames = (names, locale, catalog) =>
  names.map((name) => localizedTagDto(catalogTagForName(catalog, name), locale, name));

const tagNamesForIds = async (ids) => {
  const catalog = await listCatalogTags();
  return (ids || [])
    .map((id) => catalog.find((tag) => Number(tag.id) === Number(id)))
    .filter(Boolean)
    .map((tag) => [...new Set(tag.localizedNames.map((item) => item.name).filter(Boolean))]);
};

const defaultLocaleOf = async (pid) => {
  const meta = await db.one('SELECT defaultLocale FROM problemCompatMeta WHERE pid=?', [pid]);
  return normalizeLocale(meta && meta.defaultLocale);
};

const descriptionToSections = (description) => {
  const parsed = parseJsonArray(description, null);
  if (parsed && parsed.every((item) => item && item.sectionTitle && item.type)) return parsed;
  return [{
    sectionTitle: 'Statement',
    type: 'Text',
    text: String(description || ''),
  }];
};

const sectionsToDescription = (sections) => {
  if (!Array.isArray(sections)) return '';
  if (sections.length === 1 && String(sections[0].type || 'Text') === 'Text') {
    return String(sections[0].text || '');
  }
  return sections.map((section) => {
    const title = String(section && section.sectionTitle || 'Statement').trim() || 'Statement';
    const text = String(section && section.text || '');
    if (section && section.type === 'Sample') {
      const sampleId = section.sampleId == null ? '' : ` #${section.sampleId}`;
      return `### ${title}\n\nSample${sampleId}\n\n${text}`.trim();
    }
    return `### ${title}\n\n${text}`.trim();
  }).filter(Boolean).join('\n\n');
};

const loadLocalizedContents = async (row) => {
  await ensureCompatSchema();
  const defaultLocale = await defaultLocaleOf(row.pid);
  return [
    {
      locale: defaultLocale,
      title: row.title || '',
      description: row.description || '',
      tags: parseJsonArray(row.tags, []),
      contentSections: descriptionToSections(row.description),
    },
  ];
};

const chooseLocalizedContent = (contents, desired) => {
  return contents[0] || null;
};

const localesOfProblem = async () => [DEFAULT_LOCALE];

const profileFromRow = (row) => {
  if (row && row.judgeProfile) {
    const profile = parseJsonObject(row.judgeProfile);
    if (profile) return profile;
  }
  return judgeProfileApi.profileForType(row ? row.type : 0);
};

const problemTypeOf = (row) => {
  const profile = profileFromRow(row);
  const preset = String(profile && profile.preset || '');
  if (preset === 'interactive' || preset === 'communication') return 'Interaction';
  return [2, 3].includes(Number(row && row.type)) ? 'SubmitAnswer' : 'Traditional';
};

const problemMeta = async (row, includeStatistics = false) => {
  const meta = {
    id: row.pid,
    pid: row.pid,
    type: problemTypeOf(row),
    isPublic: !!row.isPublic,
    publicTime: row.time || null,
    ownerId: row.publisher,
    locales: await localesOfProblem(row),
  };
  if (includeStatistics) {
    meta.submissionCount = Number(row.submitCnt || 0);
    meta.acceptedSubmissionCount = Number(row.acCnt || 0);
  }
  return meta;
};

const loadProblemRow = async (pid) => {
  await ensureCompatSchema();
  return db.one(
    `SELECT p.pid,p.title,p.description,p.tags,p.type,p.judgeProfile,p.publisher,
            p.time,p.timeLimit,p.memoryLimit,p.isPublic,p.submitCnt,p.acCnt,u.name AS publisherName
       FROM problem p LEFT JOIN userInfo u ON u.uid=p.publisher
      WHERE p.pid=?`,
    [pid]
  );
};

const resolveProblemId = async (body) => {
  const id = positiveInt(body && (body.id || body.pid || body.problemId));
  if (id) return id;
  return null;
};

const scopedProblemIds = (req) => {
  const ids = new Set();
  for (const key of ['problem.manage.any', 'problem.view.any']) {
    const bucket = req.perms && req.perms.scoped && req.perms.scoped.get(key);
    if (!bucket) continue;
    for (const tag of bucket) {
      const match = /^problem:(\d+)$/.exec(tag);
      if (match) ids.add(Number(match[1]));
    }
  }
  return [...ids];
};

const canViewProblemRow = async (req, row) => {
  if (!row) return false;
  return !!(await problemApi.problemAuth(req, row.pid)).view;
};

const problemSecurityPreference = (key, fallback) => {
  const preference =
    (config.preference && config.preference.security) ||
    (config.PREFERENCE && config.PREFERENCE.security) ||
    (config.PREFERENCE && config.PREFERENCE.SECURITY) ||
    {};
  if (Object.prototype.hasOwnProperty.call(preference, key)) return !!preference[key];
  return fallback;
};

const allowEditPublicProblem = (row) =>
  !row.isPublic || problemSecurityPreference('allowNonPrivilegedUserEditPublicProblem', true);

const problemScope = (row) => ({ type: 'problem', id: Number(row.pid) });

const hasGlobalProblemManage = (req) =>
  !!(req.can && req.can('problem.manage.any'));

const canCreateProblem = (req) => !!uidOf(req) && (
  problemSecurityPreference('allowEveryoneCreateProblem', true) ||
  (req.can && (req.can('problem.create') || req.can('problem.manage.any')))
);

const isProblemOwner = (req, row) =>
  !!(row && uidOf(req) && Number(row.publisher) === uidOf(req));

const canModifyProblem = async (req, row) => {
  if (!row || !uidOf(req)) return false;
  if (hasGlobalProblemManage(req)) return true;
  if (isProblemOwner(req, row) && allowEditPublicProblem(row)) return true;
  return !!(req.can && req.can('problem.manage.any', problemScope(row)) && allowEditPublicProblem(row));
};

const canManageProblemPermissions = (req, row) => {
  if (!row || !uidOf(req)) return false;
  if (hasGlobalProblemManage(req)) return true;
  return isProblemOwner(req, row) &&
    problemSecurityPreference('allowOwnerManageProblemPermission', false) &&
    allowEditPublicProblem(row);
};

const canManageProblemPublicness = (req, row) =>
  !!(row && uidOf(req) && hasGlobalProblemManage(req));

const canDeleteProblemCompat = (req, row) => {
  if (!row || !uidOf(req)) return false;
  if (hasGlobalProblemManage(req)) return true;
  return isProblemOwner(req, row) &&
    problemSecurityPreference('allowOwnerDeleteProblem', true) &&
    allowEditPublicProblem(row);
};

const submissionBasicMeta = (row) => row && ({
  id: row.sid,
  sid: row.sid,
  isPublic: !!row.isPublic,
  codeLanguage: row.langKey || row.langName || '',
  answerSize: Number(row.codeLength || row.codelength || 0),
  score: row.score == null ? null : Number(row.score),
  status: STATUS_BY_RESULT[Number(row.judgeResult)] || 'Pending',
  submitTime: row.submitTime,
  timeUsed: row.time == null ? null : Number(row.time),
  memoryUsed: row.memory == null ? null : Number(row.memory),
});

const latestSubmissionsByProblem = async (uid, pids) => {
  const result = new Map();
  if (!uid || !pids.length) return result;
  const rows = await db.query(
    `SELECT s.sid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.isPublic,
            l.name AS langName,l.lang AS langKey
       FROM submission s LEFT JOIN languages l ON l.id=s.lang
      WHERE s.uid=? AND s.pid IN (?)
      ORDER BY s.sid DESC`,
    [uid, pids]
  );
  const latest = new Map();
  const accepted = new Map();
  for (const row of rows) {
    if (!latest.has(row.pid)) latest.set(row.pid, row);
    if (Number(row.judgeResult) === 4 && !accepted.has(row.pid)) accepted.set(row.pid, row);
  }
  for (const pid of pids) result.set(pid, submissionBasicMeta(accepted.get(pid) || latest.get(pid)));
  return result;
};

const tagFilterCondition = (names) => {
  const parts = [];
  const params = [];
  for (const name of names) {
    parts.push('JSON_CONTAINS(p.tags, ?)');
    params.push(JSON.stringify(name));
  }
  return parts.length ? [`(${parts.join(' OR ')})`, ...params] : null;
};

const buildProblemSetWhere = async (req) => {
  const body = req.body || {};
  const where = [];
  const params = [];
  const uid = uidOf(req);
  const hasPrivilege = !!(req.can && req.can('problem.manage.any'));
  const requestedOwnerId = positiveInt(body.ownerId);

  if ((requestedOwnerId || body.nonpublic) && !hasPrivilege && (!uid || uid !== requestedOwnerId)) {
    return { denied: true };
  }

  const ownerId = requestedOwnerId && (await db.exists('SELECT uid FROM userInfo WHERE uid=?', [requestedOwnerId]))
    ? requestedOwnerId
    : null;

  if (!hasPrivilege && !(uid && ownerId === uid)) {
    const parts = ['p.isPublic=1'];
    if (uid) {
      parts.push('p.publisher=?');
      params.push(uid);
    }
    const scoped = scopedProblemIds(req);
    if (scoped.length) {
      parts.push(`p.pid IN (${scoped.map(() => '?').join(',')})`);
      params.push(...scoped);
    }
    where.push(`(${parts.join(' OR ')})`);
  } else if (body.nonpublic) {
    where.push('p.isPublic=0');
  }

  if (ownerId) {
    where.push('p.publisher=?');
    params.push(ownerId);
  }

  const keyword = String(body.keyword || '').trim();
  if (keyword) {
    where.push('(p.title LIKE ? OR p.description LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const tagGroups = await tagNamesForIds(Array.isArray(body.tagIds) ? body.tagIds : []);
  for (const names of tagGroups) {
    const condition = tagFilterCondition(names);
    if (!condition) continue;
    const [clause, ...values] = condition;
    where.push(clause);
    params.push(...values);
  }

  return {
    denied: false,
    clause: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
    hasPrivilege,
    ownerId,
    tagGroups,
  };
};

const queryProblemRows = async (clause, params, skipCount, takeCount) => {
  const rows = await db.query(
    `SELECT p.pid,p.title,p.description,p.tags,p.type,p.judgeProfile,p.publisher,
            p.time,p.isPublic,p.submitCnt,p.acCnt,u.name AS publisherName
       FROM problem p LEFT JOIN userInfo u ON u.uid=p.publisher
       ${clause}
      ORDER BY p.pid
      LIMIT ?,?`,
    [...params, skipCount, takeCount]
  );
  const count = await db.one(`SELECT COUNT(*) AS count FROM problem p ${clause}`, params);
  return [rows, Number(count && count.count || 0)];
};

const maybeAddKeywordIdMatch = async (req, rows, takeCount) => {
  const body = req.body || {};
  const keyword = String(body.keyword || '').trim();
  if (!keyword || !body.keywordMatchesId) return rows;
  const safeInt = (value) => {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  };
  const matchId = keyword.slice(0, 1).toUpperCase() === 'P' ? safeInt(keyword.slice(1)) : 0;
  const matchNumericId = safeInt(keyword);
  const wantedPid = matchId || matchNumericId;
  const already = rows.some((row) => row.pid === wantedPid);
  if (already || !wantedPid) return rows;
  const row = await loadProblemRow(wantedPid);
  if (!row || !(await canViewProblemRow(req, row))) return rows;
  const next = [row, ...rows];
  return next.length > takeCount ? next.slice(0, takeCount) : next;
};

exports.queryProblemSet = handler(async (req, res) => {
  await ensureCompatSchema();
  const takeCount = Number(req.body.takeCount || req.body.pageSize || 20);
  if (!Number.isSafeInteger(takeCount) || takeCount <= 0 || takeCount > queryLimitNumber('problemSet', MAX_QUERY_TAKE)) {
    return ok(res, { error: 'TAKE_TOO_MANY' });
  }
  const skipCount = Math.max(Number(req.body.skipCount || 0) || 0, 0);
  const where = await buildProblemSetWhere(req);
  if (where.denied) return ok(res, { error: 'PERMISSION_DENIED' });

  let [rows, count] = await queryProblemRows(where.clause, where.params, skipCount, takeCount);
  rows = await maybeAddKeywordIdMatch(req, rows, takeCount);

  const locale = normalizeLocale(req.body.locale);
  const catalog = req.body.titleOnly ? [] : await listCatalogTags();
  const submissions = req.body.titleOnly
    ? new Map()
    : await latestSubmissionsByProblem(uidOf(req), rows.map((row) => row.pid));

  const result = await Promise.all(rows.map(async (row) => {
    const contents = await loadLocalizedContents(row);
    const localized = chooseLocalizedContent(contents, locale);
    const tags = localized ? localized.tags : parseJsonArray(row.tags, []);
    return {
      meta: await problemMeta(row, true),
      title: localized ? localized.title : row.title,
      tags: !req.body.titleOnly ? localizedTagDtosForNames(tags, locale, catalog) : undefined,
      resultLocale: localized ? localized.locale : DEFAULT_LOCALE,
      submission: !req.body.titleOnly ? submissions.get(row.pid) || undefined : undefined,
    };
  }));

  const response = { count, result };
  if (!req.body.titleOnly) {
    response.permissions = {
      createProblem: canCreateProblem(req),
      manageTags: where.hasPrivilege,
      filterByOwner: where.hasPrivilege,
      filterNonpublic: where.hasPrivilege,
    };
    if (Array.isArray(req.body.tagIds) && req.body.tagIds.length) {
      const catalog = await listCatalogTags();
      response.filterTags = req.body.tagIds
        .map((id) => catalog.find((tag) => Number(tag.id) === Number(id)))
        .filter(Boolean)
        .map((tag) => localizedTagDto(tag, locale));
    }
    if (where.ownerId) response.filterOwner = await userMeta(req, where.ownerId);
  }
  return ok(res, response);
});

const normalizeCreateStatement = (body) => {
  const statement = body.statement && typeof body.statement === 'object' ? body.statement : null;
  if (!statement) return null;
  return {
    localizedContents: Array.isArray(statement.localizedContents) ? statement.localizedContents : [],
    samples: Array.isArray(statement.samples) ? statement.samples : [],
    problemTagIds: Array.isArray(statement.problemTagIds) ? statement.problemTagIds : [],
  };
};

exports.createProblem = handler(async (req, res) => {
  await ensureCompatSchema();
  if (!canCreateProblem(req)) return ok(res, { error: 'PERMISSION_DENIED' });

  const statement = normalizeCreateStatement(req.body || {});
  const nextType = problemTypeToLocal(req.body && req.body.type);
  if (!statement) {
    const result = await db.tx(async (tx) => {
      const inserted = await tx.query(
        'INSERT INTO problem(title,description,publisher,time,tags,type,judgeProfile) VALUES (?,?,?,?,?,?,?)',
        [
          '请输入题目标题',
          '请输入题目描述',
          uidOf(req),
          new Date(),
          JSON.stringify(['请修改题目标签']),
          nextType.typeId,
          JSON.stringify(nextType.profile),
        ]
      );
      await saveSamples(tx, inserted.insertId, []);
      await tx.query(
        `INSERT INTO problemCompatMeta(pid,defaultLocale,updateTime)
         VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE defaultLocale=VALUES(defaultLocale),updateTime=VALUES(updateTime)`,
        [inserted.insertId, DEFAULT_LOCALE, new Date()]
      );
      return inserted;
    });
    if (!result.affectedRows) return ok(res, { error: 'FAILED' });
    recordEvent(req, 'problem.create', { pid: result.insertId, type: req.body && req.body.type || 'Traditional' });
    return ok(res, { id: result.insertId, pid: result.insertId });
  }

  if (!statement.localizedContents.length) return ok(res, { error: 'FAILED' });
  const catalog = await listCatalogTags();
  const tagRows = statement.problemTagIds.map((id) => catalog.find((tag) => Number(tag.id) === Number(id)));
  if (tagRows.some((tag) => !tag)) return ok(res, { error: 'NO_SUCH_PROBLEM_TAG' });

  const defaultContent = statement.localizedContents[0];
  const defaultLocale = normalizeLocale(defaultContent.locale);
  const now = new Date();
  const result = await db.tx(async (tx) => {
    const inserted = await tx.query(
      'INSERT INTO problem(title,description,publisher,time,tags,type,judgeProfile) VALUES (?,?,?,?,?,?,?)',
      [
        String(defaultContent.title || '').slice(0, 120),
        sectionsToDescription(defaultContent.contentSections),
        uidOf(req),
        now,
        JSON.stringify(tagRows.map((tag) => tagNameForLocale(tag.localizedNames, defaultLocale)).filter(Boolean)),
        nextType.typeId,
        JSON.stringify(nextType.profile),
      ]
    );
    await saveSamples(tx, inserted.insertId, statement.samples);
    await tx.query(
      `INSERT INTO problemCompatMeta(pid,defaultLocale,updateTime)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE defaultLocale=VALUES(defaultLocale),updateTime=VALUES(updateTime)`,
      [inserted.insertId, defaultLocale, now]
    );
    return inserted;
  });
  if (!result.affectedRows) return ok(res, { error: 'FAILED' });
  recordEvent(req, 'problem.create', {
    pid: result.insertId,
    type: req.body.type,
  });
  return ok(res, { id: result.insertId, pid: result.insertId });
});
exports.createProblem.permissionKey = ['problem.create', 'problem.manage.any'];

const saveSamples = async (tx, pid, samples) => {
  if (!Array.isArray(samples)) return;
  const normalized = samples.map((sample) => ({
    inputData: String(sample && sample.inputData != null ? sample.inputData : '').replace(/\r\n/g, '\n'),
    outputData: String(sample && sample.outputData != null ? sample.outputData : '').replace(/\r\n/g, '\n'),
  }));
  await tx.query(
    'INSERT INTO problemSample(pid,samples,updateTime) VALUES (?,?,?) ON DUPLICATE KEY UPDATE samples=VALUES(samples),updateTime=VALUES(updateTime)',
    [pid, JSON.stringify(normalized), new Date()]
  );
};

exports.updateStatement = handler(async (req, res) => {
  await ensureCompatSchema();
  const pid = positiveInt(req.body.problemId || req.body.pid);
  const row = pid && await loadProblemRow(pid);
  if (!row) return ok(res, { error: 'NO_SUCH_PROBLEM' });
  if (!(await canModifyProblem(req, row))) return ok(res, { error: 'PERMISSION_DENIED' });

  const localizedContents = Array.isArray(req.body.localizedContents) ? req.body.localizedContents : [];
  if (!localizedContents.length) return ok(res, { error: 'FAILED' });

  const catalog = await listCatalogTags();
  const ids = Array.isArray(req.body.problemTagIds) ? req.body.problemTagIds : [];
  const tagRows = ids.map((id) => catalog.find((tag) => Number(tag.id) === Number(id)));
  if (tagRows.some((tag) => !tag)) return ok(res, { error: 'NO_SUCH_PROBLEM_TAG' });

  const defaultContent = localizedContents[0];
  const defaultLocale = normalizeLocale(defaultContent.locale);
  await db.tx(async (tx) => {
    await tx.query(
      `UPDATE problem
          SET title=?,description=?,tags=?
        WHERE pid=?`,
      [
        String(defaultContent.title || '').slice(0, 120),
        sectionsToDescription(defaultContent.contentSections),
        JSON.stringify(tagRows.map((tag) => tagNameForLocale(tag.localizedNames, defaultLocale)).filter(Boolean)),
        pid,
      ]
    );
    await saveSamples(tx, pid, req.body.samples);
    await tx.query(
      `INSERT INTO problemCompatMeta(pid,defaultLocale,updateTime)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE defaultLocale=VALUES(defaultLocale),updateTime=VALUES(updateTime)`,
      [pid, defaultLocale, new Date()]
    );
  });
  recordEvent(req, 'problem.updateStatement', { pid });
  return ok(res, {});
});

const loadSamples = async (pid) => {
  const row = await db.one('SELECT samples FROM problemSample WHERE pid=?', [pid]);
  return parseJsonArray(row && row.samples, []);
};

const permissionTypesOf = async (req, row) => {
  const auth = await problemApi.problemAuth(req, row.pid);
  const result = [];
  if (auth.view) result.push('View');
  if (await canModifyProblem(req, row)) result.push('Modify');
  if (canManageProblemPermissions(req, row)) result.push('ManagePermission');
  if (canManageProblemPublicness(req, row)) result.push('ManagePublicness');
  if (canDeleteProblemCompat(req, row)) result.push('Delete');
  return result;
};

const permissionLevelToKey = (level) => Number(level) >= 2 ? 'problem.manage.any' : 'problem.view.any';
const keyToPermissionLevel = (key) => key === 'problem.manage.any' ? 2 : 1;
const normalizePermissionLevel = (value) => {
  const n = Number(value);
  return n === 1 || n === 2 ? n : 0;
};

const readProblemPermissions = async (req, pid) => {
  await ensurePermissionCatalog();
  await ensureGroupSchema();
  const keys = ['problem.manage.any', 'problem.view.any'];
  const userRows = await db.query(
    `SELECT up.uid,p.\`key\` AS permissionKey
      FROM user_permissions up JOIN permissions p ON p.id=up.permission_id
      WHERE up.resource_type='problem' AND up.resource_id=? AND up.effect='allow' AND p.\`key\` IN (?)
        AND (up.expires_at IS NULL OR up.expires_at>NOW())`,
    [pid, keys]
  );
  const groupRows = await db.query(
    `SELECT gp.gid,p.\`key\` AS permissionKey
       FROM group_permissions gp JOIN permissions p ON p.id=gp.permission_id
      WHERE gp.resource_type='problem' AND gp.resource_id=? AND gp.effect='allow' AND p.\`key\` IN (?)
        AND (gp.expires_at IS NULL OR gp.expires_at>NOW())`,
    [pid, keys]
  );
  const users = new Map();
  const groups = new Map();
  for (const row of userRows) users.set(row.uid, Math.max(users.get(row.uid) || 0, keyToPermissionLevel(row.permissionKey)));
  for (const row of groupRows) groups.set(row.gid, Math.max(groups.get(row.gid) || 0, keyToPermissionLevel(row.permissionKey)));
  return {
    userPermissions: await Promise.all([...users.entries()].map(async ([uid, permissionLevel]) => ({
      user: await userMeta(req, uid),
      permissionLevel,
    }))),
    groupPermissions: await Promise.all([...groups.entries()].map(async ([gid, permissionLevel]) => ({
      group: await groupMeta(gid),
      permissionLevel,
    }))),
  };
};

const latestSubmissionForProblem = async (uid, pid, acceptedOnly = false) => {
  if (!uid) return null;
  const row = await db.one(
    `SELECT s.sid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.isPublic,s.code,
            l.name AS langName,l.lang AS langKey
       FROM submission s LEFT JOIN languages l ON l.id=s.lang
      WHERE s.uid=? AND s.pid=? ${acceptedOnly ? 'AND s.judgeResult=4' : ''}
      ORDER BY s.sid DESC LIMIT 1`,
    [uid, pid]
  );
  return row || null;
};

const listProblemFiles = (pid, type) => {
  const bucket = normalizeProblemFileType(type);
  if (!bucket) return [];
  const dir = bucket === 'testdata' ? dataDir(pid) : assetsDir(pid);
  const out = [];
  if (bucket === 'additional') {
    const checker = path.join(dataDir(pid), 'checker.cpp');
    if (fs.existsSync(checker) && fs.statSync(checker).isFile()) {
      const stat = fs.statSync(checker);
      out.push({ filename: 'checker.cpp', uuid: fileUuid(pid, type, 'checker.cpp'), size: stat.size });
    }
  }
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (!isSafeFileName(name) || DATA_CONTROL_FILES.has(name)) continue;
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) continue;
    const stat = fs.statSync(full);
    out.push({ filename: name, uuid: fileUuid(pid, type, name), size: stat.size });
  }
  return out;
};

const loadCompatJudgeInfo = async (row) => {
  const compat = await db.one('SELECT judgeInfo,submittable FROM problemCompatMeta WHERE pid=?', [row.pid]);
  const judgeInfo = parseJsonObject(compat && compat.judgeInfo, null) || profileFromRow(row);
  return [judgeInfo, compat ? !!compat.submittable : true];
};

exports.getProblem = handler(async (req, res) => {
  await ensureCompatSchema();
  const pid = await resolveProblemId(req.body || {});
  const row = pid && await loadProblemRow(pid);
  if (!row) return ok(res, { error: 'NO_SUCH_PROBLEM' });
  if (!(await canViewProblemRow(req, row))) return ok(res, { error: 'PERMISSION_DENIED' });

  const body = req.body || {};
  const result = {
    meta: await problemMeta(row, !!body.statistics),
  };
  const contents = await loadLocalizedContents(row);
  const catalog = (body.tagsOfLocale || body.tagsOfAllLocales) ? await listCatalogTags() : [];

  if (body.owner) result.owner = await userMeta(req, row.publisher);
  if (body.localizedContentsOfLocale != null) {
    const localized = chooseLocalizedContent(contents, body.localizedContentsOfLocale);
    result.localizedContentsOfLocale = {
      locale: localized.locale,
      title: localized.title,
      contentSections: body.localizedContentsTitleOnly ? null : localized.contentSections,
    };
  }
  if (body.localizedContentsOfAllLocales) {
    result.localizedContentsOfAllLocales = contents.map((item) => ({
      locale: item.locale,
      title: item.title,
      contentSections: item.contentSections,
    }));
  }
  if (body.tagsOfLocale) {
    const localized = chooseLocalizedContent(contents, body.tagsOfLocale);
    result.tagsOfLocale = localizedTagDtosForNames(localized ? localized.tags : parseJsonArray(row.tags, []), body.tagsOfLocale, catalog);
  }
  if (body.tagsOfAllLocales) {
    const names = [...new Set(contents.flatMap((item) => item.tags))];
    result.tagsOfAllLocales = names.map((name) => {
      const tag = catalogTagForName(catalog, name);
      return tag ? {
        id: tag.id,
        color: tag.color,
        localizedNames: tag.localizedNames,
      } : {
        id: 0,
        color: '#909399',
        localizedNames: [{ locale: DEFAULT_LOCALE, name }],
      };
    });
  }
  if (body.samples) result.samples = await loadSamples(row.pid);
  if (body.judgeInfo) {
    const [judgeInfo, submittable] = await loadCompatJudgeInfo(row);
    result.judgeInfo = judgeInfo;
    result.submittable = submittable;
  }
  if (body.testData) result.testData = listProblemFiles(row.pid, 'TestData');
  if (body.additionalFiles) result.additionalFiles = listProblemFiles(row.pid, 'AdditionalFile');
  if (body.discussionCount) {
    const count = await db.one('SELECT COUNT(*) AS count FROM discussion WHERE pid=?', [row.pid]).catch(() => ({ count: 0 }));
    result.discussionCount = Number(count && count.count || 0);
  }
  if (body.permissionOfCurrentUser) result.permissionOfCurrentUser = await permissionTypesOf(req, row);
  if (body.permissions) result.permissions = await readProblemPermissions(req, row.pid);
  if (body.lastSubmissionAndLastAcceptedSubmission) {
    const latest = await latestSubmissionForProblem(uidOf(req), row.pid);
    const accepted = latest && Number(latest.judgeResult) === 4 ? latest : await latestSubmissionForProblem(uidOf(req), row.pid, true);
    result.lastSubmission = {
      lastSubmission: submissionBasicMeta(latest),
      lastAcceptedSubmission: submissionBasicMeta(accepted),
      lastSubmissionContent: latest ? { code: latest.code || '', language: latest.langKey || latest.langName || '' } : undefined,
    };
  }
  return ok(res, result);
});

exports.setProblemPermissions = handler(async (req, res) => {
  await ensureCompatSchema();
  await ensurePermissionCatalog();
  await ensureGroupSchema();
  const pid = positiveInt(req.body.problemId || req.body.pid);
  const row = pid && await loadProblemRow(pid);
  if (!row) return ok(res, { error: 'NO_SUCH_PROBLEM', errorObjectId: pid || null });
  if (!canManageProblemPermissions(req, row)) return ok(res, { error: 'PERMISSION_DENIED' });

  const userPermissions = Array.isArray(req.body.userPermissions) ? req.body.userPermissions : [];
  const groupPermissions = Array.isArray(req.body.groupPermissions) ? req.body.groupPermissions : [];
  const userIds = userPermissions.map((item) => positiveInt(item && (item.userId || item.uid || item.id)));
  const groupIds = groupPermissions.map((item) => positiveInt(item && (item.groupId || item.gid || item.id)));
  for (const uid of userIds) {
    if (!uid || !(await db.exists('SELECT 1 FROM userInfo WHERE uid=?', [uid]))) {
      return ok(res, { error: 'NO_SUCH_USER', errorObjectId: uid || null });
    }
  }
  for (const gid of groupIds) {
    if (!gid || !(await db.exists('SELECT 1 FROM user_groups WHERE gid=?', [gid]))) {
      return ok(res, { error: 'NO_SUCH_GROUP', errorObjectId: gid || null });
    }
  }

  const permRows = await db.query(
    "SELECT id,`key` FROM permissions WHERE `key` IN ('problem.manage.any','problem.view.any')"
  );
  const permByKey = new Map(permRows.map((item) => [item.key, item.id]));
  if (!permByKey.has('problem.manage.any') || !permByKey.has('problem.view.any')) {
    return ok(res, { error: 'PERMISSION_DENIED' });
  }
  const permissionIds = permRows.map((item) => item.id);
  const userLevels = new Map();
  for (const item of userPermissions) {
    const userId = positiveInt(item.userId || item.uid || item.id);
    const level = normalizePermissionLevel(item.permissionLevel ?? item.level);
    if (!level) return ok(res, { error: 'PERMISSION_DENIED' });
    userLevels.set(userId, Math.max(userLevels.get(userId) || 0, level));
  }
  const groupLevels = new Map();
  for (const item of groupPermissions) {
    const groupId = positiveInt(item.groupId || item.gid || item.id);
    const level = normalizePermissionLevel(item.permissionLevel ?? item.level);
    if (!level) return ok(res, { error: 'PERMISSION_DENIED' });
    groupLevels.set(groupId, Math.max(groupLevels.get(groupId) || 0, level));
  }
  await db.tx(async (tx) => {
    if (permissionIds.length) {
      await tx.query('DELETE FROM user_permissions WHERE resource_type=? AND resource_id=? AND permission_id IN (?)', [
        'problem',
        pid,
        permissionIds,
      ]);
      await tx.query('DELETE FROM group_permissions WHERE resource_type=? AND resource_id=? AND permission_id IN (?)', [
        'problem',
        pid,
        permissionIds,
      ]);
    }
    const userValues = [...userLevels.entries()]
      .map(([userId, level]) => [userId, permByKey.get(permissionLevelToKey(level)), 'allow', 'problem', pid, uidOf(req) || null])
      .filter((item) => item[0] && item[1]);
    const groupValues = [...groupLevels.entries()]
      .map(([groupId, level]) => [groupId, permByKey.get(permissionLevelToKey(level)), 'allow', 'problem', pid, uidOf(req) || null])
      .filter((item) => item[0] && item[1]);
    if (userValues.length) {
      await tx.query(
        'INSERT INTO user_permissions(uid,permission_id,effect,resource_type,resource_id,granted_by) VALUES ?',
        [userValues]
      );
    }
    if (groupValues.length) {
      await tx.query(
        'INSERT INTO group_permissions(gid,permission_id,effect,resource_type,resource_id,granted_by) VALUES ?',
        [groupValues]
      );
    }
  });
  userIds.forEach((uid) => policy.invalidate(uid));
  await Promise.all(groupIds.map((gid) => policy.invalidateGroup(gid)));
  recordEvent(req, 'problem.setPermissions', { pid, users: userIds, groups: groupIds });
  return ok(res, {});
});

const normalizeProblemFileType = (type) => {
  const value = String(type || '').trim();
  if (value === 'TestData' || value === 'testdata' || value === 'testData') return 'testdata';
  if (value === 'AdditionalFile' || value === 'additional' || value === 'asset') return 'additional';
  return null;
};

const isSafeFileName = (name) => typeof name === 'string' && SAFE_FILE_RE.test(name) && !name.includes('..');

const problemFileAbs = (pid, type, filename) => {
  const bucket = normalizeProblemFileType(type);
  if (!bucket || !isSafeFileName(filename)) return null;
  if (bucket === 'testdata') return path.join(dataDir(pid), filename);
  return filename === 'checker.cpp' ? path.join(dataDir(pid), 'checker.cpp') : path.join(assetsDir(pid), filename);
};

const fileUuid = (pid, type, filename) => {
  const hex = crypto.createHash('sha1').update(`${pid}:${normalizeProblemFileType(type)}:${filename}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const directUploadBuffer = (body) => {
  const uploadInfo = body.uploadInfo || {};
  const raw = body.content != null ? body.content
    : uploadInfo.content != null ? uploadInfo.content
      : body.data != null ? body.data
        : uploadInfo.data;
  if (raw == null && !body.base64 && !uploadInfo.base64) return null;
  if (body.base64 || uploadInfo.base64) return Buffer.from(String(raw || body.base64 || uploadInfo.base64), 'base64');
  return Buffer.from(String(raw), 'utf-8');
};

const writeProblemFile = async (pid, type, filename, buffer) => {
  const target = problemFileAbs(pid, type, filename);
  if (!target) return false;
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, buffer);
  await storage.mirrorProblemData(pid, dataDir(pid));
  return true;
};

const signedProblemFileUrl = (action, payload) => {
  const token = storage.signToken({ action, ...payload });
  const route = action === 'downloadProblemFile' ? 'signedDownloadProblemFile' : 'signedUploadProblemFile';
  return `/api/problem/${route}?token=${encodeURIComponent(token)}`;
};

exports.addProblemFile = handler(async (req, res) => {
  await ensureCompatSchema();
  const pid = positiveInt(req.body.problemId || req.body.pid);
  const row = pid && await loadProblemRow(pid);
  if (!row) return ok(res, { error: 'NO_SUCH_PROBLEM' });
  if (!(await canModifyProblem(req, row))) return ok(res, { error: 'PERMISSION_DENIED' });
  const type = req.body.type;
  const filename = String(req.body.filename || '').trim();
  const target = problemFileAbs(pid, type, filename);
  if (!target) return ok(res, { error: 'FILE_NOT_UPLOADED' });

  const direct = directUploadBuffer(req.body || {});
  if (direct) {
    await writeProblemFile(pid, type, filename, direct);
    recordEvent(req, 'problem.addFile', { pid, type, filename });
    return ok(res, {});
  }

  const uploadInfo = req.body.uploadInfo || {};
  if (uploadInfo.uuid) {
    if (fs.existsSync(target)) return ok(res, {});
    return ok(res, { error: 'FILE_NOT_UPLOADED' });
  }

  const uuid = crypto.randomUUID ? crypto.randomUUID() : fileUuid(pid, type, `${filename}:${Date.now()}`);
  return ok(res, {
    signedUploadRequest: {
      uuid,
      method: 'POST',
      url: signedProblemFileUrl('uploadProblemFile', {
        pid,
        type,
        filename,
        uuid,
        size: Number(uploadInfo.size || 0) || 0,
        uid: uidOf(req),
      }),
      fileFieldName: 'file',
    },
  });
});

exports.removeProblemFiles = handler(async (req, res) => {
  await ensureCompatSchema();
  const pid = positiveInt(req.body.problemId || req.body.pid);
  const row = pid && await loadProblemRow(pid);
  if (!row) return ok(res, { error: 'NO_SUCH_PROBLEM' });
  if (!(await canModifyProblem(req, row))) return ok(res, { error: 'PERMISSION_DENIED' });
  const filenames = Array.isArray(req.body.filenames) ? req.body.filenames : [];
  for (const filename of filenames) {
    const target = problemFileAbs(pid, req.body.type, String(filename || '').trim());
    if (target && fs.existsSync(target)) await fs.promises.rm(target, { force: true });
  }
  await storage.mirrorProblemData(pid, dataDir(pid));
  recordEvent(req, 'problem.removeFiles', { pid, type: req.body.type, filenames });
  return ok(res, {});
});

exports.downloadProblemFiles = handler(async (req, res) => {
  await ensureCompatSchema();
  const pid = positiveInt(req.body.problemId || req.body.pid);
  const row = pid && await loadProblemRow(pid);
  if (!row) return ok(res, { error: 'NO_SUCH_PROBLEM' });
  if (!(await canViewProblemRow(req, row))) return ok(res, { error: 'PERMISSION_DENIED' });
  const wanted = Array.isArray(req.body.filenameList) ? new Set(req.body.filenameList) : new Set();
  const files = listProblemFiles(pid, req.body.type)
    .filter((file) => !wanted.size || wanted.has(file.filename));
  return ok(res, {
    downloadInfo: files.map((file) => ({
      filename: file.filename,
      downloadUrl: signedProblemFileUrl('downloadProblemFile', {
        pid,
        type: req.body.type,
        filename: file.filename,
        uid: uidOf(req),
      }),
    })),
  });
});

exports.renameProblemFile = handler(async (req, res) => {
  await ensureCompatSchema();
  const pid = positiveInt(req.body.problemId || req.body.pid);
  const row = pid && await loadProblemRow(pid);
  if (!row) return ok(res, { error: 'NO_SUCH_PROBLEM' });
  if (!(await canModifyProblem(req, row))) return ok(res, { error: 'PERMISSION_DENIED' });
  const oldTarget = problemFileAbs(pid, req.body.type, String(req.body.filename || '').trim());
  const newTarget = problemFileAbs(pid, req.body.type, String(req.body.newFilename || '').trim());
  if (!oldTarget || !newTarget || !fs.existsSync(oldTarget) || fs.existsSync(newTarget)) {
    return ok(res, { error: 'NO_SUCH_FILE' });
  }
  await fs.promises.mkdir(path.dirname(newTarget), { recursive: true });
  await fs.promises.rename(oldTarget, newTarget);
  await storage.mirrorProblemData(pid, dataDir(pid));
  recordEvent(req, 'problem.renameFile', {
    pid,
    type: req.body.type,
    oldFilename: req.body.filename,
    newFilename: req.body.newFilename,
  });
  return ok(res, {});
});

const problemTypeToLocal = (type) => {
  const value = String(type || '').trim();
  if (value === 'SubmitAnswer') return { typeId: 2, profile: judgeProfileApi.profileForType(2) };
  if (value === 'Interaction') return { typeId: 1, profile: judgeProfileApi.buildPreset('interactive') };
  return { typeId: 0, profile: judgeProfileApi.profileForType(0) };
};

exports.updateProblemJudgeInfo = handler(async (req, res) => {
  await ensureCompatSchema();
  const pid = positiveInt(req.body.problemId || req.body.pid);
  const row = pid && await loadProblemRow(pid);
  if (!row) return ok(res, { error: 'NO_SUCH_PROBLEM' });
  if (!(await canModifyProblem(req, row))) return ok(res, { error: 'PERMISSION_DENIED' });
  const judgeInfo = req.body.judgeInfo;
  if (!judgeInfo || typeof judgeInfo !== 'object') return ok(res, { error: 'INVALID_JUDGE_INFO', judgeInfoError: ['INVALID_JUDGE_INFO'] });

  let profileToSave = null;
  if (judgeInfo.version && judgeInfo.submit && judgeInfo.run) {
    const validation = judgeProfileApi.validateProfile(judgeInfo);
    if (!validation.ok) return ok(res, { error: 'INVALID_JUDGE_INFO', judgeInfoError: validation.errors });
    profileToSave = judgeInfo;
  }

  await db.tx(async (tx) => {
    if (Number.isFinite(Number(judgeInfo.timeLimit))) {
      await tx.query('UPDATE problem SET timeLimit=? WHERE pid=?', [Number(judgeInfo.timeLimit), pid]);
    }
    if (Number.isFinite(Number(judgeInfo.memoryLimit))) {
      await tx.query('UPDATE problem SET memoryLimit=? WHERE pid=?', [Number(judgeInfo.memoryLimit), pid]);
    }
    if (profileToSave) {
      await tx.query('UPDATE problem SET judgeProfile=?,type=? WHERE pid=?', [
        JSON.stringify(profileToSave),
        judgeProfileApi.presetToType(profileToSave),
        pid,
      ]);
    }
    await tx.query(
      `INSERT INTO problemCompatMeta(pid,judgeInfo,submittable,updateTime)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE judgeInfo=VALUES(judgeInfo),submittable=VALUES(submittable),updateTime=VALUES(updateTime)`,
      [pid, JSON.stringify(judgeInfo), req.body.submittable === false ? 0 : 1, new Date()]
    );
  });
  recordEvent(req, 'problem.updateJudgeInfo', { pid });
  return ok(res, {});
});

exports.changeProblemType = handler(async (req, res) => {
  await ensureCompatSchema();
  const pid = positiveInt(req.body.problemId || req.body.pid);
  const row = pid && await loadProblemRow(pid);
  if (!row) return ok(res, { error: 'NO_SUCH_PROBLEM' });
  if (!canDeleteProblemCompat(req, row)) return ok(res, { error: 'PERMISSION_DENIED' });
  const hasSubmission = await db.exists('SELECT 1 FROM submission WHERE pid=? LIMIT 1', [pid]);
  if (hasSubmission) return ok(res, { error: 'PROBLEM_HAS_SUBMISSION' });
  const next = problemTypeToLocal(req.body.type);
  await db.tx(async (tx) => {
    await tx.query('UPDATE problem SET type=?,judgeProfile=? WHERE pid=?', [
      next.typeId,
      JSON.stringify(next.profile),
      pid,
    ]);
    await tx.query(
      `INSERT INTO problemCompatMeta(pid,judgeInfo,submittable,updateTime)
       VALUES (?,?,1,?)
       ON DUPLICATE KEY UPDATE judgeInfo=VALUES(judgeInfo),submittable=1,updateTime=VALUES(updateTime)`,
      [pid, JSON.stringify(next.profile), new Date()]
    );
  });
  recordEvent(req, 'problem.changeType', { pid, type: req.body.type });
  return ok(res, {});
});

const problemFileUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(PROBLEM_FILE_TMP_DIR, { recursive: true });
    cb(null, PROBLEM_FILE_TMP_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`);
  },
});

exports.problemFileUpload = multer({ storage: problemFileUploadStorage });

exports.verifySignedProblemFileUpload = (req, res, next) => {
  const access = storage.verifyToken(req.query.token || (req.body && req.body.token), 'uploadProblemFile');
  if (!access || !access.pid || !access.filename || !access.uuid || !problemFileAbs(access.pid, access.type, access.filename)) {
    return res.status(403).end('403 Forbidden');
  }
  req.signedProblemFileAccess = access;
  return next();
};

exports.signedUploadProblemFile = handler(async (req, res) => {
  const access = req.signedProblemFileAccess;
  if (!access || !req.file || !req.file.path) return fail(res, '未上传文件');
  const target = problemFileAbs(access.pid, access.type, access.filename);
  if (!target) {
    await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
    return res.status(403).end('403 Forbidden');
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.copyFile(req.file.path, target);
  await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
  await storage.mirrorProblemData(access.pid, dataDir(access.pid));
  recordEvent(req, 'problem.signedUploadFile', {
    pid: access.pid,
    type: access.type,
    filename: access.filename,
  }, access.uid);
  return ok(res, { uuid: access.uuid, filename: access.filename });
});

exports.signedDownloadProblemFile = handler(async (req, res) => {
  const access = storage.verifyToken(req.query.token, 'downloadProblemFile');
  if (!access || !access.pid || !access.filename) return res.status(403).end('403 Forbidden');
  const target = problemFileAbs(access.pid, access.type, access.filename);
  if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) return fail(res, '资产不存在', 404);
  recordEvent(req, 'problem.signedDownloadFile', {
    pid: access.pid,
    type: access.type,
    filename: access.filename,
  }, access.uid);
  return res.download(target, access.filename);
});
