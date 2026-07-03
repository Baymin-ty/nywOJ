require('express-zip');
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { handler, fail, ok, paginate, buildWhere } = require('../../db/util');
const config = require('../../config.json');
const { requirePermission } = require('../../auth/middleware');
const { getFile, setFile } = require('../../file');
const storage = require('../../storage');
const { briefFormat, Format, bFormat, recordEvent, kbFormat } = require('../../static');
const { judgeRes, ptype } = require('../../db/format');
const {
  DATA_CONFIG_FILE,
  PROFILE_CONFIG_FILE,
  PROFILE_YAML_FILE,
  buildProfileConfigJson,
  dumpProfileYaml,
  listFilesRecursive,
  normalizeRelPath,
  safeResolve,
} = require('./archive');

// ---- shared helpers ----
// view           = public OR owner OR problem.view.any (global or scoped to this pid) OR canManage
// manage         = (owner AND problem.manage.self) OR problem.manage.any (scoped or global)
// solutionManage = manage OR (view AND problem.solmanage)
//   problem.manage.self lets a user edit their own problems; without it, even
//   the original creator can no longer manage the problem after creation.
//   problem.view.any can now be granted scoped to a single pid as a
//   "view-only collaborator" perm — see RESOURCE_GRANTABLE.problem.
//   problem.solmanage is deliberately separate: it only manages problemSolution
//   bindings and does not grant paste.edit.any or any problem editing rights.
const problemAuth = async (req, pid) => {
  const row = await db.one('SELECT isPublic,publisher FROM problem WHERE pid=?', [pid]);
  if (!row) return { view: false, manage: false, solutionManage: false };
  const scope = { type: 'problem', id: Number(pid) };
  const isOwner = row.publisher === req.session.uid;
  const canManage = (isOwner && req.can('problem.manage.self')) || req.can('problem.manage.any', scope);
  const canView = !!row.isPublic || isOwner || req.can('problem.view.any', scope) || canManage;
  return {
    view: canView,
    manage: canManage,
    solutionManage: canManage || (canView && req.can('problem.solmanage')),
  };
};
exports.problemAuth = problemAuth;

const canViewPaste = (req, paste) => {
  return !!paste.isPublic || paste.uid === (req.session && req.session.uid) || req.can('paste.edit.any');
};

const getMark = () => {
  const time = Date.now().toString(36);
  const str = Math.random().toString(36).slice(2, 7);
  return `${time}-${str}`;
};

const removePathIfExists = (target) => {
  if (target && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
};

const dataDirOf = (pid) => path.join(__dirname, '..', '..', 'data', String(pid));
const dataFileAbs = (pid, rel) => safeResolve(dataDirOf(pid), rel);
const answerSubmitDirOf = (sid) => path.join(__dirname, '..', '..', 'answerSubmissions', String(sid));
const answerCaseNameOf = (c) => {
  const raw = c && c.input ? path.basename(String(c.input)) : String(c && c.index || '');
  const name = raw.endsWith('.in') ? raw.slice(0, -3) : raw.endsWith('.out') ? raw.slice(0, -4) : raw;
  return name && !/[\/\\]/.test(name) && name !== '.' && name !== '..' && !name.includes('\0')
    ? name
    : String(c && c.index || '');
};
const judgeLogPathOf = (sid) => path.join(__dirname, '..', '..', 'judge_logs', `${sid}.log`);
const normalizeBool = (value) => value === true || value === 1 || value === '1';
const DEFAULT_PROBLEM_LOCALE = 'zh-CN';
const MAX_PROBLEM_SAMPLES = 20;
const MAX_PROBLEM_SAMPLES_BYTES = 2 * 1024 * 1024;

const preferenceSecurityFlag = (key, fallback) => {
  const security =
    (config.preference && config.preference.security) ||
    (config.PREFERENCE && config.PREFERENCE.security) ||
    (config.PREFERENCE && config.PREFERENCE.SECURITY) ||
    {};
  if (Object.prototype.hasOwnProperty.call(security, key)) return !!security[key];
  return fallback;
};

const enumError = (res, error, message = error) => ok(res, { error, message });

const hasGlobalProblemManage = (req) => !!(req.can && req.can('problem.manage.any'));

const canDeleteProblemByPolicy = (req, row) => {
  if (!row || !req.session || !req.session.uid) return false;
  if (hasGlobalProblemManage(req)) return true;
  return Number(row.publisher) === Number(req.session.uid) &&
    preferenceSecurityFlag('allowOwnerDeleteProblem', true) &&
    (!row.isPublic || preferenceSecurityFlag('allowNonPrivilegedUserEditPublicProblem', true));
};

let problemTagSchemaReady = null;
const ensureProblemTagSchema = () => {
  if (!problemTagSchemaReady) {
    problemTagSchemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS problemTag (
        id INT NOT NULL AUTO_INCREMENT,
        color VARCHAR(20) NOT NULL DEFAULT '#909399',
        locales TEXT NOT NULL,
        createTime DATETIME NOT NULL,
        updateTime DATETIME NOT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
  return problemTagSchemaReady;
};
exports.ensureProblemTagSchema = ensureProblemTagSchema;

let problemSampleSchemaReady = null;
const ensureProblemSampleSchema = () => {
  if (!problemSampleSchemaReady) {
    problemSampleSchemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS problemSample (
        pid INT NOT NULL,
        samples MEDIUMTEXT NOT NULL,
        updateTime DATETIME NOT NULL,
        PRIMARY KEY (pid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
  return problemSampleSchemaReady;
};
exports.ensureProblemSampleSchema = ensureProblemSampleSchema;

const normalizePid = (value) => {
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
};

const resolveProblemPid = async (payload) => {
  const directPid = normalizePid(payload && (payload.pid || payload.problemId));
  if (directPid) return directPid;
  return null;
};

const normalizeLocale = (locale) => {
  const value = String(locale || '').trim();
  if (!value || value === DEFAULT_PROBLEM_LOCALE) return DEFAULT_PROBLEM_LOCALE;
  if (!/^[A-Za-z]{2,8}([-_][A-Za-z0-9]{2,8})?$/.test(value)) return DEFAULT_PROBLEM_LOCALE;
  const [head, tail] = value.replace('_', '-').split('-');
  return tail ? `${head.toLowerCase()}-${tail.toUpperCase()}` : head.toLowerCase();
};

const preferredProblemLocale = (req) =>
  normalizeLocale(req.body.locale || req.headers['x-nywoj-locale']);

const parseJsonArray = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
};

const normalizeProblemSamples = (samples) => {
  if (!Array.isArray(samples)) return { error: '样例数据格式错误' };
  const out = [];
  let bytes = 0;
  for (const sample of samples) {
    const inputData = String(sample && sample.inputData != null ? sample.inputData : '').replace(/\r\n/g, '\n');
    const outputData = String(sample && sample.outputData != null ? sample.outputData : '').replace(/\r\n/g, '\n');
    if (!inputData.trim() && !outputData.trim()) continue;
    bytes += Buffer.byteLength(inputData) + Buffer.byteLength(outputData);
    if (bytes > MAX_PROBLEM_SAMPLES_BYTES) return { error: '样例总大小不能超过 2MB' };
    out.push({ inputData, outputData });
    if (out.length > MAX_PROBLEM_SAMPLES) return { error: `样例最多设置 ${MAX_PROBLEM_SAMPLES} 组` };
  }
  return { data: out };
};

const loadProblemSamples = async (pid) => {
  await ensureProblemSampleSchema();
  const row = await db.one('SELECT samples FROM problemSample WHERE pid=?', [pid]);
  return parseJsonArray(row && row.samples, []);
};
exports.loadProblemSamples = loadProblemSamples;

const saveProblemSamples = async (tx, pid, samples) => {
  await tx.query(
    'INSERT INTO problemSample(pid,samples,updateTime) VALUES (?,?,?) ON DUPLICATE KEY UPDATE samples=VALUES(samples),updateTime=VALUES(updateTime)',
    [pid, JSON.stringify(samples), new Date()]
  );
};

const validateTags = (res, tags, strictLimit) => {
  if (!Array.isArray(tags)) return '题目标签格式错误';
  if (strictLimit && tags.length > 5) return '题目标签最多设置5个';
  for (const t of tags) {
    if (String(t).length > 30) return '单个标签长度不能大于30';
    if (strictLimit && String(t).length > 10) return '单个标签长度不能大于10';
  }
  return null;
};

const normalizeTagLocale = (locale) => {
  const value = String(locale || '').trim();
  if (!value) return DEFAULT_PROBLEM_LOCALE;
  if (!/^[A-Za-z]{2,8}([-_][A-Za-z0-9]{2,8})?$/.test(value)) return null;
  return normalizeLocale(value);
};

const normalizeTagColor = (color) => {
  const value = String(color || '#909399').trim();
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return null;
  return value.toLowerCase();
};

const parseTagLocales = (value) => {
  const parsed = parseJsonArray(value, []);
  const seen = new Set();
  const out = [];
  for (const item of parsed) {
    const locale = normalizeTagLocale(item && item.locale);
    const name = String(item && item.name || '').trim();
    if (!locale || !name || seen.has(locale)) continue;
    seen.add(locale);
    out.push({ locale, name });
  }
  return out;
};

const normalizeTagLocalizedNames = (localizedNames) => {
  const raw = Array.isArray(localizedNames)
    ? localizedNames
    : Object.entries(localizedNames || {}).map(([locale, name]) => ({ locale, name }));
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const locale = normalizeTagLocale(item && item.locale);
    const name = String(item && item.name || '').trim();
    if (!locale) return { error: '标签语言格式错误' };
    if (!name) continue;
    if (name.length > 30) return { error: '单个标签长度不能大于30' };
    if (seen.has(locale)) return { error: `${locale} 标签名重复` };
    seen.add(locale);
    out.push({ locale, name });
  }
  if (!out.length) return { error: '请至少填写一个标签名' };
  if (!out.some((item) => item.locale === DEFAULT_PROBLEM_LOCALE)) {
    out.unshift({ locale: DEFAULT_PROBLEM_LOCALE, name: out[0].name });
  }
  return { data: out };
};

const tagNameForLocale = (localizedNames, locale) => {
  const desired = normalizeLocale(locale);
  const base = desired.split('-')[0];
  const exact = localizedNames.find((item) => item.locale === desired);
  const baseMatch = base && localizedNames.find((item) => item.locale === base);
  const defaultMatch = localizedNames.find((item) => item.locale === DEFAULT_PROBLEM_LOCALE);
  return (exact || baseMatch || defaultMatch || localizedNames[0] || {}).name || '';
};

const listProblemTagRows = async () => {
  await ensureProblemTagSchema();
  const rows = await db.query('SELECT id,color,locales,createTime,updateTime FROM problemTag ORDER BY id');
  return rows.map((row) => ({
    ...row,
    localizedNames: parseTagLocales(row.locales),
  }));
};

const localizedTagDto = (row, locale) => ({
  id: row.id,
  color: row.color,
  locale: normalizeLocale(locale),
  name: tagNameForLocale(row.localizedNames, locale),
});

const tagNameKey = (name) => String(name || '').trim().toLowerCase();

const findCatalogNameConflict = async (localizedNames, excludeId = 0) => {
  const wanted = new Map(localizedNames.map((item) => [tagNameKey(item.name), item.name]));
  const rows = await listProblemTagRows();
  for (const row of rows) {
    if (Number(row.id) === Number(excludeId)) continue;
    for (const item of row.localizedNames) {
      const key = tagNameKey(item.name);
      if (wanted.has(key)) return wanted.get(key);
    }
  }
  return null;
};

const distinctProblemTagNames = async () => {
  const data = await db.query(
    `SELECT DISTINCT JSON_UNQUOTE(value) AS tag
       FROM problem,
       JSON_TABLE(tags, '$[*]' COLUMNS (value JSON PATH '$')) AS jt
      WHERE JSON_VALID(tags)`
  );
  return [...new Set(data.map((r) => String(r.tag || '').trim()).filter(Boolean))];
};

const problemTagUsageCounts = async () => {
  const counts = new Map();
  const addTags = (tags) => {
    for (const tag of parseJsonArray(tags, [])) {
      const text = String(tag || '').trim();
      if (text) counts.set(text, (counts.get(text) || 0) + 1);
    }
  };
  const problemRows = await db.query('SELECT tags FROM problem WHERE JSON_VALID(tags)');
  problemRows.forEach((row) => addTags(row.tags));
  return counts;
};

const rewriteTags = (tags, oldNames, replacement) => {
  const next = [];
  const seen = new Set();
  let changed = false;
  for (const tag of parseJsonArray(tags, [])) {
    const text = String(tag || '').trim();
    if (!text) continue;
    const value = oldNames.has(text) ? replacement : text;
    if (oldNames.has(text)) changed = true;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return { changed, tags: next };
};

const syncProblemTagNames = async (tx, oldLocalizedNames, newLocalizedNames = null) => {
  const oldNames = new Set(oldLocalizedNames.map((item) => item.name).filter(Boolean));
  if (!oldNames.size) return { problem: 0 };
  let problemChanged = 0;

  const defaultReplacement = newLocalizedNames ? tagNameForLocale(newLocalizedNames, DEFAULT_PROBLEM_LOCALE) : '';
  const problemRows = await tx.query('SELECT pid,tags FROM problem WHERE JSON_VALID(tags)');
  for (const row of problemRows) {
    const result = rewriteTags(row.tags, oldNames, defaultReplacement);
    if (!result.changed) continue;
    await tx.query('UPDATE problem SET tags=? WHERE pid=?', [JSON.stringify(result.tags), row.pid]);
    problemChanged++;
  }
  return { problem: problemChanged };
};

const pushZipFile = (files, seen, filePath, name) => {
  const zipName = normalizeRelPath(name);
  if (!zipName) throw new Error('ZIP 文件名非法');
  if (seen.has(zipName)) throw new Error(`ZIP 文件名重复: ${zipName}`);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile())
    throw new Error(`文件不存在: ${zipName}`);
  seen.add(zipName);
  files.push({ path: filePath, name: zipName });
};

const effectiveJudgeProfile = (problem) => {
  const { profileForType } = require('./judgeProfile');
  if (problem && problem.judgeProfile) {
    try {
      const profile = JSON.parse(problem.judgeProfile);
      if (profile && typeof profile === 'object') return profile;
    } catch (_) { /* fall through to type-derived profile */ }
  }
  return profileForType(problem ? problem.type : 0);
};

const ASSET_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const validAssetName = (name) => typeof name === 'string' && ASSET_NAME_RE.test(name) && !name.includes('..');
const assetAbsForDownload = (pid, name) =>
  name === 'checker.cpp'
    ? path.join(dataDirOf(pid), 'checker.cpp')
    : path.join(dataDirOf(pid), 'assets', name);

const caseIndexFrom = (value) => {
  const index = Number(value || 0);
  return Number.isInteger(index) && index >= 0 ? index : null;
};

const problemFileUrl = (pathName, token) => `${pathName}?token=${encodeURIComponent(token)}`;

const serveCaseDownload = async (req, res, opts) => {
  const pid = opts.pid;
  const caseIndex = caseIndexFrom(opts.index);
  if (caseIndex == null) return fail(res, '测试点编号非法');

  const problem = await db.one('SELECT publisher,type,judgeProfile FROM problem WHERE pid=?', [pid]);
  const configPath = dataFileAbs(pid, DATA_CONFIG_FILE);
  if (!problem || !configPath || !fs.existsSync(configPath)) return fail(res, 'Not Found Error');

  const { cases } = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
  const files = [];
  const seen = new Set();
  const fullDownload = caseIndex === 0;
  for (const i in cases) {
    if (fullDownload || cases[i].index === caseIndex) {
      pushZipFile(files, seen, dataFileAbs(pid, cases[i].input), cases[i].input);
      pushZipFile(files, seen, dataFileAbs(pid, cases[i].output), cases[i].output);
    }
  }
  if (!files.length) return fail(res, '未找到指定测试点');

  let tmpDir = null;
  if (fullDownload) {
    pushZipFile(files, seen, configPath, DATA_CONFIG_FILE);
    const checkerPath = dataFileAbs(pid, 'checker.cpp');
    if (checkerPath && fs.existsSync(checkerPath)) pushZipFile(files, seen, checkerPath, 'checker.cpp');

    const assetsRoot = path.join(dataDirOf(pid), 'assets');
    for (const rel of listFilesRecursive(assetsRoot)) {
      pushZipFile(files, seen, path.join(assetsRoot, rel), path.posix.join('assets', rel));
    }

    const profile = effectiveJudgeProfile(problem);
    tmpDir = path.join(__dirname, '..', '..', 'tmp', 'problemDownload', getMark());
    fs.mkdirSync(tmpDir, { recursive: true });
    const yamlPath = path.join(tmpDir, PROFILE_YAML_FILE);
    const configExportPath = path.join(tmpDir, PROFILE_CONFIG_FILE);
    await fs.promises.writeFile(yamlPath, dumpProfileYaml(profile));
    await fs.promises.writeFile(configExportPath, buildProfileConfigJson(profile));
    pushZipFile(files, seen, yamlPath, PROFILE_YAML_FILE);
    pushZipFile(files, seen, configExportPath, PROFILE_CONFIG_FILE);

    recordEvent(req, 'problem.downloadCase', { pid }, opts.auditUid);
  } else {
    recordEvent(req, 'problem.downloadCase', { pid, index: caseIndex }, opts.auditUid);
  }
  const fileName = (!fullDownload ? `nywoj_Testdata_#${pid}_case#${caseIndex}` : `nywoj_Testdata_#${pid}`) + '.zip';
  const cleanup = () => removePathIfExists(tmpDir);
  if (tmpDir) {
    res.once('finish', cleanup);
    res.once('close', cleanup);
  }
  return res.zip(files, fileName, (err) => {
    if (err) cleanup();
  });
};

const serveAnswerInputsDownload = async (req, res, opts) => {
  const pid = opts.pid;
  const problem = await db.one('SELECT type FROM problem WHERE pid=?', [pid]);
  if (!problem || !fs.existsSync(`./data/${pid}/config.json`)) return fail(res, 'Not Found Error');
  if (problem.type !== 2 && problem.type !== 3) return fail(res, '该题不是提交答案题');

  const { cases } = JSON.parse(await getFile(`./data/${pid}/config.json`));
  const files = [];
  for (const i in cases) {
    if (cases[i].input) {
      const inputPath = dataFileAbs(pid, cases[i].input);
      if (!inputPath || !fs.existsSync(inputPath)) return fail(res, '测试点配置含非法输入文件路径');
      files.push({ path: inputPath, name: normalizeRelPath(cases[i].input) });
    }
  }
  if (opts.auditUid) recordEvent(req, 'problem.downloadAnswerInputs', { pid }, opts.auditUid);
  return res.zip(files, `nywoj_Inputs_#${pid}.zip`);
};

const hasAcceptedProblem = (uid, pid) => {
  if (!uid) return false;
  return db.exists('SELECT 1 FROM submission WHERE uid=? AND pid=? AND judgeResult=4 LIMIT 1', [uid, pid]);
};

const getProblemLang = async (pid) => {
  const row = await db.one('SELECT lang FROM problem WHERE pid=?', [pid]);
  return row ? row.lang : null;
};
exports.getProblemLang = getProblemLang;

const updateProblemStat = async (pid) => {
  const stat = await db.query(
    'SELECT score,judgeResult,COUNT(*) as cnt FROM submission WHERE pid=? GROUP BY score,judgeResult ORDER BY score,judgeResult',
    [pid]
  );
  for (const i of stat) i.judgeResult = judgeRes[i.judgeResult];
  await db.query('UPDATE problem SET stat=? WHERE pid=?', [JSON.stringify(stat), pid]);
  return stat;
};
exports.updateProblemStat = updateProblemStat;

// ---- handlers ----
exports.createProblem = [
  requirePermission('problem.create'),
  handler(async (req, res) => {
    await ensureProblemSampleSchema();
    // New problems always carry the default traditional profile. Lazy require
    // avoids the circular import.
    const { profileForType } = require('./judgeProfile');
    const r = await db.query(
      'INSERT INTO problem(title,description,publisher,time,tags,type,judgeProfile) VALUES (?,?,?,?,?,0,?)',
      ['请输入题目标题', '请输入题目描述', req.session.uid, new Date(), JSON.stringify(['请修改题目标签']),
        JSON.stringify(profileForType(0))]
    );
    if (!r.affectedRows) return fail(res, 'error');
    await db.query('INSERT INTO problemSample(pid,samples,updateTime) VALUES (?,?,?)', [
      r.insertId,
      JSON.stringify([]),
      new Date(),
    ]);
    return ok(res, { pid: r.insertId });
  }),
];

exports.updateProblem = [
  handler(async (req, res) => {
    const { pid } = req.body;
    const info = req.body.info || {};
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    if (!info.title || !info.description || !info.timeLimit || !info.memoryLimit || !pid)
      return fail(res, '请确认信息完善');

    // Holders of global problem.manage.any (e.g. moderator+) bypass per-problem limits.
    if (!req.can('problem.manage.any')) {
      if (info.timeLimit > 10000 || info.timeLimit < 0) return fail(res, '时间限制最大为10000ms');
      if (info.memoryLimit > 512 || info.memoryLimit < 0) return fail(res, '空间限制最大为512MB');
    }
    const tagError = validateTags(res, info.tags, !req.can('problem.manage.any'));
    if (tagError) return fail(res, tagError);
    if (info.isPublic !== false && info.isPublic !== true) return fail(res, 'isPublic格式错误');
    if (info.level < 0 || info.level > 5) return fail(res, '难度评级格式错误');

    info.isPublic = info.isPublic ? 1 : 0;
    const currentProblem = await db.one('SELECT isPublic FROM problem WHERE pid=?', [pid]);
    if (!currentProblem) return fail(res, '题目不存在');
    // 题型 / 评测方式（type）已由统一评测流程（judgeProfile / saveJudgeProfile）独占，
    // 题面编辑不再改动 type，避免互相覆盖。
    const normalizedSamples = Array.isArray(info.samples) ? normalizeProblemSamples(info.samples) : null;
    if (normalizedSamples && normalizedSamples.error) return fail(res, normalizedSamples.error);
    if (normalizedSamples) await ensureProblemSampleSchema();

    const r = await db.tx(async (t) => {
      const updated = await t.query(
        'UPDATE problem SET title=?,description=?,timeLimit=?,memoryLimit=?,isPublic=?,tags=?,level=?,lang=? WHERE pid=?',
        [info.title, info.description, info.timeLimit, info.memoryLimit, info.isPublic, JSON.stringify(info.tags), info.level, info.lang, pid]
      );
      if (Number(currentProblem.isPublic) !== info.isPublic) {
        await t.query('UPDATE submission SET isPublic=? WHERE pid=? AND cid=0', [info.isPublic, pid]).catch(() => {});
      }
      if (normalizedSamples) await saveProblemSamples(t, pid, normalizedSamples.data);
      return updated;
    });
    if (!r.affectedRows) return fail(res, 'error');
    return ok(res);
  }),
];

exports.getProblemList = handler(async (req, res) => {
  const { offset, limit } = paginate(req);
  const filter = req.body.filter || {};
  if (filter.level === 6) filter.level = null;

  // Visibility filtering for lists:
  // - With global problem.view.any or global problem.manage.any: see all problems
  // - With scoped problem.{manage,view}.any (collaborator on specific problems):
  //   include those pids in the visibility set so collaborators — including
  //   view-only collaborators — can find non-public problems they have access to
  // - Otherwise: see public problems + own problems
  const canViewAny = req.can('problem.view.any');
  const canManageAny = req.can('problem.manage.any');
  let visibilityCond = null;
  if (!canViewAny && !canManageAny) {
    // Pull pids the caller has any scoped problem-level grant on (manage OR
    // view), so both manage- and view-collaborators see their problems here.
    const scopedPids = new Set();
    for (const key of ['problem.manage.any', 'problem.view.any']) {
      const bucket = req.perms?.scoped?.get(key);
      if (!bucket) continue;
      for (const tag of bucket) {
        const m = /^problem:(\d+)$/.exec(tag);
        if (m) scopedPids.add(Number(m[1]));
      }
    }
    const parts = ['isPublic=1'];
    const params = [];
    if (req.session.uid) {
      parts.push('publisher=?');
      params.push(req.session.uid);
    }
    if (scopedPids.size) {
      const ids = [...scopedPids];
      parts.push(`pid IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
    visibilityCond = [`(${parts.join(' OR ')})`, ...params];
  }
  const tagsParam = filter.tags?.length ? JSON.stringify(filter.tags) : null;

  // 注意：原实现里 list 用 (title LIKE ? OR description LIKE ?)，而 count 只看 title — 这里统一用同一份条件以避免漂移
  const cond = [
    visibilityCond,
    ['publisher=?', filter.publisherUid],
    ['level=?', filter.level],
    filter.name ? ['(title LIKE ? OR description LIKE ?)', `%${filter.name}%`, `%${filter.name}%`] : null,
    ['JSON_CONTAINS(tags, ?)', tagsParam],
  ];
  const { where, params } = buildWhere(cond);

  const list = await db.query(
    'SELECT p.pid,p.title,p.acCnt,p.submitCnt,p.time,p.level,p.tags,p.publisher as publisherUid,u.name as publisher,p.isPublic ' +
      'FROM problem p INNER JOIN userInfo u ON u.uid = p.publisher' +
      `${where} ORDER BY p.pid LIMIT ?,?`,
    [...params, offset, limit]
  );
  for (const r of list) {
    r.time = briefFormat(r.time);
    r.tags = JSON.parse(r.tags);
  }
  const cnt = await db.one(`SELECT COUNT(*) as total FROM problem${where}`, params);
  return ok(res, { total: cnt.total, data: list });
});

exports.getProblemInfo = handler(async (req, res) => {
  const pid = await resolveProblemPid(req.body);
  if (!pid) return fail(res, '无权限查看或未找到此题目');
  // problemAuth is the single source of truth for view/manage rights:
  //   view = public OR owner OR problem.view.any (scoped or global) OR canManage
  //   canManage = (owner AND problem.manage.self) OR problem.manage.any (scoped or global)
  // Scoped collaborators (manage OR view) on a private problem get view=true,
  // so this single auth.view check covers them without an extra SQL filter.
  const auth = await problemAuth(req, pid);
  if (!auth.view) return fail(res, '无权限查看或未找到此题目');

  const row = await db.one(
    'SELECT p.pid,p.title,p.acCnt,p.submitCnt,p.description,p.time,p.timeLimit,p.memoryLimit,p.isPublic,p.type,p.judgeProfile,p.tags,p.level,p.lang,p.publisher as publisherUid,u.`name` as publisher ' +
      'FROM problem p INNER JOIN userInfo u ON u.uid = p.publisher WHERE pid=?',
    [pid]
  );
  if (!row) return fail(res, '无权限查看或未找到此题目');
  // typeId = raw integer (frontend uses this for branching answer-problem UI);
  // type = localized label (existing displays read this).
  row.typeId = row.type;
  row.type = ptype[row.type];
  // judgeSummary = contestant-facing "how is this judged + what to submit".
  // Lazy require avoids the problem.js <-> judgeProfile.js circular import.
  // Drop the raw profile so internal step/command/asset detail isn't leaked.
  const { summarizeJudge } = require('./judgeProfile');
  row.judgeSummary = summarizeJudge(row.typeId, row.judgeProfile);
  delete row.judgeProfile;
  row.tags = JSON.parse(row.tags);
  row.samples = await loadProblemSamples(pid);
  row.time = briefFormat(row.time);
  return ok(res, { data: row });
});

exports.getProblemSamples = handler(async (req, res) => {
  const pid = await resolveProblemPid(req.body);
  if (!pid) return fail(res, '题目不存在');
  if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
  return ok(res, { samples: await loadProblemSamples(pid) });
});

exports.updateProblemSamples = handler(async (req, res) => {
  const pid = await resolveProblemPid(req.body);
  if (!pid) return fail(res, '题目不存在');
  if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
  const normalized = normalizeProblemSamples(req.body.samples);
  if (normalized.error) return fail(res, normalized.error);
  await ensureProblemSampleSchema();
  await db.tx((t) => saveProblemSamples(t, pid, normalized.data));
  recordEvent(req, 'problem.updateSamples', { pid, count: normalized.data.length });
  return ok(res, { samples: normalized.data });
});

exports.setProblemPublic = handler(async (req, res) => {
  const pid = await resolveProblemPid(req.body);
  if (!pid) return enumError(res, 'NO_SUCH_PROBLEM', '题目不存在');
  if (![true, false, 1, 0, '1', '0'].includes(req.body.isPublic)) return fail(res, 'isPublic格式错误');

  const isPublic = normalizeBool(req.body.isPublic) ? 1 : 0;
  const problem = await db.one('SELECT pid,isPublic,publisher FROM problem WHERE pid=?', [pid]);
  if (!problem) return enumError(res, 'NO_SUCH_PROBLEM', '题目不存在');
  if (!(await problemAuth(req, pid)).manage) return enumError(res, 'PERMISSION_DENIED', '权限不足');

  await db.query('UPDATE problem SET isPublic=? WHERE pid=?', [isPublic, pid]);
  await db.query('UPDATE submission SET isPublic=? WHERE pid=? AND cid=0', [isPublic, pid]).catch(() => {});
  recordEvent(req, isPublic ? 'problem.setPublic' : 'problem.setHidden', { pid });
  return ok(res, { pid, isPublic: !!isPublic });
});

exports.deleteProblem = handler(async (req, res) => {
  const pid = await resolveProblemPid(req.body);
  if (!pid) return enumError(res, 'NO_SUCH_PROBLEM', '题目不存在');

  const problem = await db.one('SELECT pid,title,isPublic,publisher FROM problem WHERE pid=?', [pid]);
  if (!problem) return enumError(res, 'NO_SUCH_PROBLEM', '题目不存在');
  if (!canDeleteProblemByPolicy(req, problem)) return enumError(res, 'PERMISSION_DENIED', '权限不足');
  const submissions = await db.query('SELECT sid FROM submission WHERE pid=?', [pid]).catch(() => []);
  const sids = submissions.map((row) => Number(row.sid)).filter((sid) => Number.isSafeInteger(sid) && sid > 0);

  await db.tx(async (t) => {
    const tryQuery = (sql, params) => t.query(sql, params).catch(() => {});
    for (let i = 0; i < sids.length; i += 500) {
      const part = sids.slice(i, i + 500);
      await tryQuery('DELETE FROM submissionDetail WHERE sid IN (?)', [part]);
      await tryQuery('DELETE FROM submissionFile WHERE sid IN (?)', [part]);
      await tryQuery('DELETE FROM contestLastSubmission WHERE sid IN (?)', [part]);
      await tryQuery('DELETE FROM submission WHERE sid IN (?)', [part]);
    }
    await tryQuery('DELETE FROM contestProblem WHERE pid=?', [pid]);
    await tryQuery('DELETE FROM problemSolution WHERE pid=?', [pid]);
    await tryQuery('DELETE FROM problemSample WHERE pid=?', [pid]);
    await tryQuery('UPDATE discussion SET pid=NULL WHERE pid=?', [pid]);
    await t.query('DELETE FROM problem WHERE pid=?', [pid]);
  });

  removePathIfExists(dataDirOf(pid));
  await storage.deleteProblemDataArchive(pid).catch(() => {});
  for (const sid of sids) {
    await fs.promises.rm(answerSubmitDirOf(sid), { recursive: true, force: true }).catch(() => {});
    await fs.promises.unlink(judgeLogPathOf(sid)).catch(() => {});
  }
  recordEvent(req, 'problem.delete', { pid, title: problem.title, submissions: sids.length });
  return ok(res, { pid });
});

// For answer-submission problems, the submitter needs to know how many
// test cases there are and their `name`s to map textareas / zip entries.
// Returns the case names only — no input/output content — gated on auth.view.
exports.getAnswerCaseList = handler(async (req, res) => {
  const { pid } = req.body;
  if (!(await problemAuth(req, pid)).view) return res.status(403).end('403 Forbidden');
  const cfgRaw = await getFile(`./data/${pid}/config.json`);
  if (!cfgRaw) return ok(res, { data: [] });
  const cfg = JSON.parse(cfgRaw);
  const cases = (cfg.cases || []).map((c) => ({
    index: c.index,
    name: answerCaseNameOf(c),
    subtaskId: c.subtaskId,
  }));
  return ok(res, { data: cases });
});

exports.getProblemCasePreview = [
  handler(async (req, res) => {
    const { pid } = req.body;
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    // typeId lets the data-config page split the stored `type` integer into the
    // 题目类型 (传统/提交答案) + 对比原则 (文本/SPJ) selectors and decide whether
    // to surface the in-browser checker editor.
    const problem = await db.one('SELECT type FROM problem WHERE pid=?', [pid]);
    const typeId = problem ? problem.type : 0;
    const cfgRaw = await getFile(`./data/${pid}/config.json`);
    const data = cfgRaw ? JSON.parse(cfgRaw) : null;

    let spj = '';
    if (fs.existsSync(`./data/${pid}/checker.cpp`)) {
      spj = await getFile(`./data/${pid}/checker.cpp`);
    }
    if (!data) return res.status(202).send({ data: [], spj, subtask: [], typeId });

    const cases = data.cases;
    let previewList = [];
    if (fs.existsSync(`./data/${pid}/preview.json`)) {
      previewList = JSON.parse(await getFile(`./data/${pid}/preview.json`));
    } else {
      for (const i in cases) {
        const inputPath = dataFileAbs(pid, cases[i].input);
        const outputPath = dataFileAbs(pid, cases[i].output);
        if (!inputPath || !outputPath || !fs.existsSync(inputPath) || !fs.existsSync(outputPath)) {
          return fail(res, `测试点 #${cases[i].index} 文件不存在或路径非法`);
        }
        const inputFile = await fs.promises.readFile(inputPath, 'utf-8');
        const inputStat = fs.statSync(inputPath);
        const outputFile = await fs.promises.readFile(outputPath, 'utf-8');
        const outputStat = fs.statSync(outputPath);
        previewList[i] = {
          index: cases[i].index,
          inName: cases[i].input,
          outName: cases[i].output,
          subtaskId: cases[i].subtaskId,
          input: {
            content: inputFile.substring(0, 255) + (inputFile.length > 255 ? '......\n' : ''),
            size: bFormat(inputStat.size),
            create: Format(inputStat.birthtime),
            modified: Format(inputStat.mtime),
          },
          output: {
            content: outputFile.substring(0, 255) + (outputFile.length > 255 ? '......\n' : ''),
            size: bFormat(outputStat.size),
            create: Format(outputStat.birthtime),
            modified: Format(outputStat.mtime),
          },
          edit: 0,
        };
      }
      await setFile(`./data/${pid}/preview.json`, JSON.stringify(previewList));
    }
    return ok(res, { data: previewList, spj, subtask: data.subtask, typeId });
  }),
];

// Set just the problem `type` integer from the data-config page. The UI splits
// it into 题目类型 × 对比原则; here we only accept the four implemented
// combinations (传统/提交答案 × 文本/SPJ). 交互题/通信题 are reserved and rejected.
exports.setProblemType = [
  handler(async (req, res) => {
    const { pid } = req.body;
    const type = Number(req.body.type);
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    if (![0, 1, 2, 3].includes(type)) return fail(res, '暂不支持该题目类型');
    const r = await db.query('UPDATE problem SET type=? WHERE pid=?', [type, pid]);
    if (!r.affectedRows) return fail(res, '题目不存在或更新失败');
    recordEvent(req, 'problem.setType', { pid, type });
    return ok(res);
  }),
];

// Save the SPJ checker (checker.cpp) edited directly in the browser, so a
// special-judge problem no longer requires bundling checker.cpp inside the
// data ZIP. The data dir is created on demand so the checker can be written
// before any test data exists. The judge keys its compiled-binary cache on
// sha256(source), so overwriting here auto-invalidates the cache.
exports.saveChecker = [
  handler(async (req, res) => {
    const { pid } = req.body;
    const source = req.body.source;
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    if (typeof source !== 'string') return fail(res, 'checker 内容非法');
    if (source.length > 1024 * 1024) return fail(res, 'checker 内容过大（上限 1MB）');
    const dir = path.join(__dirname, '..', '..', 'data', String(pid));
    fs.mkdirSync(dir, { recursive: true });
    await setFile(`./data/${pid}/checker.cpp`, source);
    await storage.mirrorProblemData(pid, dataDirOf(pid));
    recordEvent(req, 'problem.saveChecker', { pid });
    return ok(res);
  }),
];

const healthCheck = (checks, level, title, detail, extra = {}) => {
  checks.push({ level, title, detail, ...extra });
};

exports.getProblemCaseHealth = handler(async (req, res) => {
  const { pid } = req.body;
  if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');

  const problem = await db.one('SELECT type, judgeProfile FROM problem WHERE pid=?', [pid]);
  if (!problem) return fail(res, '题目不存在');

  // Judging behaviour comes from judgeProfile; type-only rows are converted to
  // an equivalent preset by summarizeJudge/profileHealth.
  const { summarizeJudge, profileHealth, listAssetsOf } = require('./judgeProfile');
  let profile = null;
  if (problem.judgeProfile) {
    try { profile = JSON.parse(problem.judgeProfile); } catch (_) { profile = null; }
  }
  const typeLabel = summarizeJudge(problem.type, problem.judgeProfile).label || ptype[problem.type];

  const checks = [];
  const dir = path.join(__dirname, '..', '..', 'data', String(pid));
  const cfgPath = path.join(dir, 'config.json');
  const previewPath = path.join(dir, 'preview.json');
  const checkerPath = path.join(dir, 'checker.cpp');

  if (!fs.existsSync(dir)) {
    healthCheck(checks, 'error', '数据目录不存在', `未找到 ./data/${pid}，请先上传测试数据。`);
    return ok(res, { data: { problemType: typeLabel, checks, summary: { error: 1, warn: 0, ok: 0 } } });
  }

  if (!fs.existsSync(cfgPath)) {
    healthCheck(checks, 'error', '缺少 config.json', '测试点配置不存在，评测会失败。');
    return ok(res, { data: { problemType: typeLabel, checks, summary: { error: 1, warn: 0, ok: 0 } } });
  }

  let cfg = null;
  try {
    cfg = JSON.parse(await fs.promises.readFile(cfgPath, 'utf-8'));
    healthCheck(checks, 'ok', '配置文件可解析', 'config.json JSON 格式正常。');
  } catch (err) {
    healthCheck(checks, 'error', 'config.json 格式错误', err.message || '无法解析 JSON。');
    return ok(res, { data: { problemType: typeLabel, checks, summary: { error: 1, warn: 0, ok: 0 } } });
  }

  const cases = Array.isArray(cfg.cases) ? cfg.cases : [];
  const subtasks = Array.isArray(cfg.subtask) ? cfg.subtask : [];
  if (!cases.length) healthCheck(checks, 'error', '没有测试点', 'config.json 中 cases 为空。');
  else healthCheck(checks, 'ok', '测试点数量', `共 ${cases.length} 个测试点。`);

  if (!subtasks.length) healthCheck(checks, 'error', '没有子任务', 'config.json 中 subtask 为空。');

  const subtaskIds = new Set();
  let totalScore = 0;
  let lastSubtask = 0;
  for (const s of subtasks) {
    const id = Number(s.index);
    if (!Number.isInteger(id) || id !== lastSubtask + 1) {
      healthCheck(checks, 'error', '子任务编号不连续', `子任务编号应从 1 连续递增，当前遇到 ${s.index}。`);
    }
    lastSubtask = Number.isInteger(id) ? id : lastSubtask;
    if (subtaskIds.has(id)) healthCheck(checks, 'error', '子任务编号重复', `子任务 #${id} 出现多次。`);
    subtaskIds.add(id);

    const score = Number(s.score);
    if (!Number.isInteger(score) || score < 1 || score > 100) {
      healthCheck(checks, 'error', '子任务分数非法', `子任务 #${s.index} 的分数应为 1 到 100 的整数。`);
    } else {
      totalScore += score;
    }

    if (s.option !== 0 && s.option !== 1) {
      healthCheck(checks, 'error', '记分方式非法', `子任务 #${s.index} option 应为 0 或 1。`);
    }
    const deps = Array.isArray(s.dependencies) ? s.dependencies.map(Number) : [];
    for (const dep of deps) {
      if (!subtaskIds.has(dep) || dep >= id) {
        healthCheck(checks, 'error', '子任务依赖非法', `子任务 #${id} 依赖了不存在或不在前面的子任务 #${dep}。`);
      }
    }
    if (s.option === 0 && (s.skip || deps.length)) {
      healthCheck(checks, 'warn', '等分子任务含额外设置', `子任务 #${id} 是等分模式，skip/dependencies 不会生效。`);
    }
  }
  if (subtasks.length) {
    healthCheck(
      checks,
      totalScore === 100 ? 'ok' : 'error',
      '子任务总分',
      `当前总分 ${totalScore}，应为 100。`
    );
  }

  const caseSubtaskUse = new Map();
  const fileNames = new Set();
  let expectedIndex = 1;
  let newestDataMtime = fs.statSync(cfgPath).mtimeMs;
  for (const c of cases) {
    const idx = Number(c.index);
    if (idx !== expectedIndex) {
      healthCheck(checks, 'warn', '测试点编号不连续', `期望 Case #${expectedIndex}，实际为 #${c.index}。`);
    }
    expectedIndex += 1;

    const sid = Number(c.subtaskId);
    if (!subtaskIds.has(sid)) {
      healthCheck(checks, 'error', '测试点子任务不存在', `Case #${c.index} 绑定到未定义的子任务 #${c.subtaskId}。`);
    } else {
      caseSubtaskUse.set(sid, (caseSubtaskUse.get(sid) || 0) + 1);
    }

    for (const [label, file] of [['输入', c.input], ['输出', c.output]]) {
      if (!file) {
        healthCheck(checks, 'error', `Case #${c.index} 缺少${label}文件名`, '请检查 config.json。');
        continue;
      }
      if (fileNames.has(file)) {
        healthCheck(checks, 'warn', '测试数据文件名重复', `${file} 被多个位置引用。`);
      }
      fileNames.add(file);
      const full = dataFileAbs(pid, file);
      if (!full) {
        healthCheck(checks, 'error', `${label}文件路径非法`, `Case #${c.index}: ${file}`);
        continue;
      }
      if (!fs.existsSync(full)) {
        healthCheck(checks, 'error', `${label}文件不存在`, `Case #${c.index}: ${file}`);
        continue;
      }
      const st = fs.statSync(full);
      newestDataMtime = Math.max(newestDataMtime, st.mtimeMs);
      if (st.size === 0) healthCheck(checks, 'warn', `${label}文件为空`, `Case #${c.index}: ${file}`);
    }
  }
  for (const s of subtasks) {
    if (!caseSubtaskUse.has(Number(s.index))) {
      healthCheck(checks, 'error', '子任务没有测试点', `子任务 #${s.index} 没有关联任何 Case。`);
    }
  }

  const hasChecker = fs.existsSync(checkerPath);
  if (profile) {
    // Profile-driven checks: the profile decides which assets are needed
    // (checker / interactor / grader / ...), not problem.type.
    const assetNames = listAssetsOf(pid).map((a) => a.name);
    const ph = profileHealth(profile, assetNames);
    for (const e of ph.errors) healthCheck(checks, 'error', '评测流程配置错误', e);
    for (const w of ph.warnings) healthCheck(checks, 'warn', '评测流程提示', w);
    if (ph.ok) healthCheck(checks, 'ok', '评测流程配置正常', `${typeLabel}：流程校验通过，引用的资产齐全。`);
    const steps = (profile.run && profile.run.perCase) || [];
    const usesChecker = steps.some((s) => s && s.kind === 'check' && s.checker === 'asset:checker.cpp')
      || (Array.isArray(profile.compile) ? profile.compile : []).some((c) => Array.isArray(c && c.inputs) && c.inputs.includes('checker.cpp'));
    if (hasChecker && !usesChecker) {
      healthCheck(checks, 'warn', '存在未使用的 checker.cpp', '当前评测流程没有引用 checker.cpp。');
    }
  } else {
    const needsChecker = problem.type === 1 || problem.type === 3;
    if (needsChecker && !hasChecker) {
      healthCheck(checks, 'error', '缺少 SPJ checker.cpp', `${ptype[problem.type]} 需要 checker.cpp。`);
    } else if (needsChecker) {
      const checker = await fs.promises.readFile(checkerPath, 'utf-8');
      if (!checker.trim()) {
        healthCheck(checks, 'error', 'checker.cpp 为空', 'SPJ checker 没有内容。');
      } else if (!/registerTestlibCmd|registerTestlibCmdArgs|quit[fpa]?/.test(checker)) {
        healthCheck(checks, 'warn', 'checker.cpp 可能不完整', '没有看到常见 testlib 注册或 quit 调用，请确认 checker 可独立编译运行。');
      } else {
        healthCheck(checks, 'ok', 'SPJ checker 已配置', '已找到 checker.cpp。');
      }
    } else if (hasChecker) {
      healthCheck(checks, 'warn', '存在未使用的 checker.cpp', `${ptype[problem.type]} 不会使用 SPJ checker。`);
    }
  }

  if (fs.existsSync(previewPath)) {
    const previewMtime = fs.statSync(previewPath).mtimeMs;
    if (previewMtime < newestDataMtime) {
      healthCheck(checks, 'warn', '预览缓存可能过期', 'preview.json 早于配置或测试数据修改时间，刷新预览后会自动重建。');
    } else {
      healthCheck(checks, 'ok', '预览缓存正常', 'preview.json 未早于当前数据。');
    }
  }

  const summary = checks.reduce((acc, c) => {
    acc[c.level] = (acc[c.level] || 0) + 1;
    return acc;
  }, { error: 0, warn: 0, ok: 0 });
  return ok(res, { data: { problemType: typeLabel, checks, summary } });
});

exports.clearCase = [
  handler(async (req, res) => {
    const { pid } = req.body;
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    const dir = path.join(__dirname, '..', '..', 'data', String(pid));
    recordEvent(req, 'problem.delAllCases', { pid });
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    await storage.deleteProblemDataArchive(pid);
    return ok(res);
  }),
];

exports.updateSubtaskId = [
  handler(async (req, res) => {
    const { pid, cases, subtask } = req.body;
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');

    const subtaskMap = new Map();
    const normalizedSubtask = [];
    let totalScore = 0;
    for (let i = 0; i < subtask.length; i++) {
      const s = subtask[i];
      const index = Number(s.index);
      const score = Number(s.score);
      const option = Number(s.option);
      const dependencies = Array.isArray(s.dependencies) ? s.dependencies.map(Number) : [];
      const skip = normalizeBool(s.skip);
      if (!Number.isInteger(index) || index !== i + 1)
        return fail(res, `子任务 #${s.index} 编号非法或不连续`);
      if (!Number.isInteger(score) || score < 1 || score > 100)
        return fail(res, `子任务 #${index} 分数应为[1,100]之间的整数`);
      if (option !== 0 && option !== 1) return fail(res, `子任务 #${index} 记分方式非法`);
      if (subtaskMap.has(index)) return fail(res, `子任务 #${index} 编号重复`);
      if (index < 1 || index > 100) return fail(res, `子任务 #${index} 应在[1,100]之间`);
      if (!option && skip) return fail(res, `测试点等分的子任务 #${index} 无法设置遇TLE止测`);
      if (!option && dependencies.length)
        return fail(res, `测试点等分的子任务 #${index} 无法设置子任务依赖`);
      for (const id of dependencies) {
        if (!Number.isInteger(id) || id < 1 || id >= index)
          return fail(res, `子任务 #${index} 依赖了非法子任务 #${id}`);
      }
      subtaskMap.set(index, score);
      normalizedSubtask.push({ index, score, option, skip, dependencies });
      totalScore += score;
    }
    if (totalScore !== 100) return fail(res, '子任务分数之和应等于100分');

    const newCases = [];
    const subtaskVis = new Map();
    for (const i in cases) {
      const c = cases[i];
      const inName = normalizeRelPath(c.inName);
      const outName = normalizeRelPath(c.outName);
      const inputPath = dataFileAbs(pid, inName);
      const outputPath = dataFileAbs(pid, outName);
      if (!inputPath || !outputPath || !fs.existsSync(inputPath) || !fs.existsSync(outputPath))
        return fail(res, `找不到数据点 ${c.inName}/${c.outName}`);
      if (!subtaskMap.has(Number(c.subtaskId)))
        return fail(res, `测试点 #${c.index} 所属子任务 #${Number(c.subtaskId)} 未定义`);
      newCases.push({
        index: Number(i) + 1,
        input: inName,
        output: outName,
        subtaskId: Number(c.subtaskId),
      });
      subtaskVis.set(Number(c.subtaskId), true);
    }
    for (const s of normalizedSubtask) {
      if (!subtaskVis.has(s.index)) return fail(res, `子任务 #${s.index} 中没有测试点`);
    }
    newCases.sort((a, b) => a.index - b.index);

    await setFile(`./data/${pid}/config.json`, JSON.stringify({ cases: newCases, subtask: normalizedSubtask }));
    recordEvent(req, 'problem.updateConfig', { pid });
    if (fs.existsSync(`./data/${pid}/preview.json`)) {
      fs.rmSync(`./data/${pid}/preview.json`);
    }
    await storage.mirrorProblemData(pid, dataDirOf(pid));
    return ok(res);
  }),
];

exports.getCase = [
  handler(async (req, res) => {
    const { pid, caseInfo } = req.body;
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    const inputPath = dataFileAbs(pid, caseInfo.inName);
    const outputPath = dataFileAbs(pid, caseInfo.outName);
    if (!inputPath || !outputPath || !fs.existsSync(inputPath) || !fs.existsSync(outputPath))
      return fail(res, '未找到测试点');

    const inputFile = await fs.promises.readFile(inputPath, 'utf-8');
    const inputStat = fs.statSync(inputPath);
    const outputFile = await fs.promises.readFile(outputPath, 'utf-8');
    const outputStat = fs.statSync(outputPath);
    if (inputStat.size + outputStat.size > 5 * 1024 * 1024) return fail(res, '超过编辑大小限制 5MB');
    return ok(res, { input: inputFile, output: outputFile });
  }),
];

exports.updateCase = [
  handler(async (req, res) => {
    const { pid, caseInfo } = req.body;
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    const inputPath = dataFileAbs(pid, caseInfo.inName);
    const outputPath = dataFileAbs(pid, caseInfo.outName);
    if (!inputPath || !outputPath || !fs.existsSync(inputPath) || !fs.existsSync(outputPath))
      return fail(res, '未找到测试点');

    await fs.promises.writeFile(inputPath, caseInfo.input.content);
    await fs.promises.writeFile(outputPath, caseInfo.output.content);
    recordEvent(req, 'problem.updateCase', { pid, index: caseInfo.index });
    if (fs.existsSync(`./data/${pid}/preview.json`)) {
      fs.rmSync(`./data/${pid}/preview.json`);
    }
    await storage.mirrorProblemData(pid, dataDirOf(pid));
    return ok(res, {
      inputM: Format(fs.statSync(inputPath).mtime),
      outputM: Format(fs.statSync(outputPath).mtime),
      message: 'ok',
    });
  }),
];

exports.downloadCase = [
  handler(async (req, res) => {
    const { pid, index } = req.query;
    const caseIndex = Number(index || 0);
    if (typeof index !== 'undefined' && (!Number.isInteger(caseIndex) || caseIndex < 0))
      return fail(res, '测试点编号非法');
    if (!(await problemAuth(req, pid)).manage) return fail(res, '你只能下载自己题目的测试点');
    return serveCaseDownload(req, res, { pid, index: caseIndex, auditUid: req.session.uid });
  }),
];

// Answer-submission problems (type ∈ {2,3}): the input (.in) files ARE the
// problem — solvers need them to compute the answers they upload. So unlike
// downloadCase (manage-only), this is gated on view and serves only inputs.
exports.downloadAnswerInputs = [
  handler(async (req, res) => {
    const { pid } = req.query;
    const problem = await db.one('SELECT type FROM problem WHERE pid=?', [pid]);
    if (!problem || !fs.existsSync(`./data/${pid}/config.json`)) return fail(res, 'Not Found Error');
    if (problem.type !== 2 && problem.type !== 3) return fail(res, '该题不是提交答案题');
    if (!(await problemAuth(req, pid)).view) return fail(res, '权限不足');
    return serveAnswerInputsDownload(req, res, { pid, auditUid: req.session.uid });
  }),
];

exports.createFileAccess = handler(async (req, res) => {
  const action = String(req.body.action || '').trim();
  const pid = Number(req.body.pid);
  const ttl = req.body.ttlSeconds || req.body.ttl;
  if (!Number.isSafeInteger(pid) || pid <= 0 || !action) return fail(res, '请确认信息完善');

  const payload = { action, pid, uid: req.session.uid || 0 };
  let url = '';
  let method = 'GET';

  if (action === 'uploadData') {
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    method = 'POST';
    url = '/api/problem/signedUploadData';
  } else if (action === 'downloadCase') {
    const index = caseIndexFrom(req.body.index);
    if (index == null) return fail(res, '测试点编号非法');
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    payload.index = index;
    url = '/api/problem/signedDownloadCase';
  } else if (action === 'downloadAnswerInputs') {
    const problem = await db.one('SELECT type FROM problem WHERE pid=?', [pid]);
    if (!problem || (problem.type !== 2 && problem.type !== 3)) return fail(res, '该题不是提交答案题');
    if (!(await problemAuth(req, pid)).view) return res.status(403).end('403 Forbidden');
    url = '/api/problem/signedDownloadAnswerInputs';
  } else if (action === 'downloadAsset') {
    const name = String(req.body.name || '').trim();
    if (!validAssetName(name)) return fail(res, '资产名非法');
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    const abs = assetAbsForDownload(pid, name);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return fail(res, '资产不存在', 404);
    payload.name = name;
    url = '/api/problem/signedDownloadAsset';
  } else {
    return fail(res, '未知文件访问类型');
  }

  const token = storage.signToken(payload, ttl);
  const decoded = storage.verifyToken(token, action);
  return ok(res, {
    action,
    method,
    url: problemFileUrl(url, token),
    expiresAt: decoded ? new Date(decoded.exp * 1000) : null,
    storage: storage.info(),
  });
});

exports.signedDownloadCase = [
  handler(async (req, res) => {
    const token = storage.verifyToken(req.query.token, 'downloadCase');
    if (!token) return res.status(403).end('403 Forbidden');
    return serveCaseDownload(req, res, { pid: token.pid, index: token.index, auditUid: token.uid });
  }),
];

exports.signedDownloadAnswerInputs = [
  handler(async (req, res) => {
    const token = storage.verifyToken(req.query.token, 'downloadAnswerInputs');
    if (!token) return res.status(403).end('403 Forbidden');
    return serveAnswerInputsDownload(req, res, { pid: token.pid, auditUid: token.uid });
  }),
];

exports.signedDownloadAsset = [
  handler(async (req, res) => {
    const token = storage.verifyToken(req.query.token, 'downloadAsset');
    if (!token || !validAssetName(token.name)) return res.status(403).end('403 Forbidden');
    const abs = assetAbsForDownload(token.pid, token.name);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return fail(res, '资产不存在', 404);
    recordEvent(req, 'problem.downloadAsset', { pid: token.pid, name: token.name }, token.uid);
    return res.download(abs, token.name);
  }),
];

exports.getProblemTags = handler(async (req, res) => {
  await ensureProblemTagSchema();
  const names = new Set(await distinctProblemTagNames());
  const rows = await listProblemTagRows();
  const catalogByName = new Map();
  for (const row of rows) {
    const name = tagNameForLocale(row.localizedNames, preferredProblemLocale(req));
    if (name) {
      names.add(name);
      catalogByName.set(name, { name, color: row.color, id: row.id, catalog: true });
    }
  }
  if (req.body && req.body.detail) {
    const tags = [...names].sort((a, b) => a.localeCompare(b, 'zh-CN')).map((name) => (
      catalogByName.get(name) || { name, color: null, catalog: false }
    ));
    return ok(res, { tags });
  }
  return res.status(200).send([...names].sort((a, b) => a.localeCompare(b, 'zh-CN')));
});

exports.getAllProblemTags = handler(async (req, res) => {
  const rows = await listProblemTagRows();
  const tags = rows
    .map((row) => localizedTagDto(row, preferredProblemLocale(req)))
    .filter((tag) => tag.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return ok(res, { tags });
});

exports.getAllProblemTagsOfAllLocales = handler(async (req, res) => {
  if (!req.can('problem.manage.any')) return res.status(403).end('403 Forbidden');
  const rows = await listProblemTagRows();
  const usage = await problemTagUsageCounts();
  const catalogNames = new Set();
  const tags = rows.map((row) => {
    row.localizedNames.forEach((item) => catalogNames.add(item.name));
    const count = row.localizedNames.reduce((sum, item) => sum + (usage.get(item.name) || 0), 0);
    return {
      id: row.id,
      color: row.color,
      localizedNames: row.localizedNames,
      usage: count,
      createTime: Format(row.createTime),
      updateTime: Format(row.updateTime),
    };
  });
  const uncataloguedTags = [...usage.keys()]
    .filter((name) => !catalogNames.has(name))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((name) => ({ name, usage: usage.get(name) || 0 }));
  return ok(res, { tags, uncataloguedTags });
});

exports.getProblemTagDetail = handler(async (req, res) => {
  const id = Number(req.body.id);
  if (!Number.isSafeInteger(id) || id <= 0) return ok(res, { error: 'NO_SUCH_PROBLEM_TAG', message: '标签编号非法' });
  const row = (await listProblemTagRows()).find((item) => Number(item.id) === id);
  if (!row) return ok(res, { error: 'NO_SUCH_PROBLEM_TAG', message: '标签不存在' });
  return ok(res, {
    id: row.id,
    color: row.color,
    localizedNames: row.localizedNames,
    tag: {
      id: row.id,
      color: row.color,
      localizedNames: row.localizedNames,
      createTime: Format(row.createTime),
      updateTime: Format(row.updateTime),
    },
  });
});

exports.createProblemTag = handler(async (req, res) => {
  if (!req.can('problem.manage.any')) return ok(res, { error: 'PERMISSION_DENIED', message: '权限不足' });
  const color = normalizeTagColor(req.body.color);
  if (!color) return fail(res, '标签颜色格式错误');
  const normalized = normalizeTagLocalizedNames(req.body.localizedNames || req.body.names);
  if (normalized.error) return fail(res, normalized.error);
  const conflict = await findCatalogNameConflict(normalized.data);
  if (conflict) return fail(res, `标签名已存在：${conflict}`);

  const now = new Date();
  const result = await db.query(
    'INSERT INTO problemTag(color,locales,createTime,updateTime) VALUES (?,?,?,?)',
    [color, JSON.stringify(normalized.data), now, now]
  );
  recordEvent(req, 'problemTag.create', { id: result.insertId, color, localizedNames: normalized.data });
  return ok(res, { id: result.insertId });
});

exports.updateProblemTag = handler(async (req, res) => {
  if (!req.can('problem.manage.any')) return ok(res, { error: 'PERMISSION_DENIED', message: '权限不足' });
  const id = Number(req.body.id);
  if (!Number.isSafeInteger(id) || id <= 0) return ok(res, { error: 'NO_SUCH_PROBLEM_TAG', message: '标签编号非法' });
  const color = normalizeTagColor(req.body.color);
  if (!color) return fail(res, '标签颜色格式错误');
  const normalized = normalizeTagLocalizedNames(req.body.localizedNames || req.body.names);
  if (normalized.error) return fail(res, normalized.error);
  const rows = await listProblemTagRows();
  const row = rows.find((item) => Number(item.id) === id);
  if (!row) return ok(res, { error: 'NO_SUCH_PROBLEM_TAG', message: '标签不存在' });
  const conflict = await findCatalogNameConflict(normalized.data, id);
  if (conflict) return fail(res, `标签名已存在：${conflict}`);

  const synced = await db.tx(async (tx) => {
    await tx.query('UPDATE problemTag SET color=?,locales=?,updateTime=? WHERE id=?', [
      color,
      JSON.stringify(normalized.data),
      new Date(),
      id,
    ]);
    return syncProblemTagNames(tx, row.localizedNames, normalized.data);
  });
  recordEvent(req, 'problemTag.update', {
    id,
    oldColor: row.color,
    color,
    oldLocalizedNames: row.localizedNames,
    localizedNames: normalized.data,
    synced,
  });
  return ok(res, { synced });
});

exports.deleteProblemTag = handler(async (req, res) => {
  if (!req.can('problem.manage.any')) return ok(res, { error: 'PERMISSION_DENIED', message: '权限不足' });
  const id = Number(req.body.id);
  if (!Number.isSafeInteger(id) || id <= 0) return ok(res, { error: 'NO_SUCH_PROBLEM_TAG', message: '标签编号非法' });
  const row = (await listProblemTagRows()).find((item) => Number(item.id) === id);
  if (!row) return ok(res, { error: 'NO_SUCH_PROBLEM_TAG', message: '标签不存在' });
  const synced = await db.tx(async (tx) => {
    await tx.query('DELETE FROM problemTag WHERE id=?', [id]);
    return syncProblemTagNames(tx, row.localizedNames, null);
  });
  recordEvent(req, 'problemTag.delete', { id, color: row.color, localizedNames: row.localizedNames, synced });
  return ok(res, { synced });
});

exports.getProblemPublishers = handler(async (req, res) => {
  const data = await db.query(
    'SELECT DISTINCT(p.publisher),u.name FROM problem p INNER JOIN userInfo u WHERE p.publisher=u.uid'
  );
  return res.status(200).send(data);
});

exports.getProblemStat = handler(async (req, res) => {
  const { pid } = req.body;
  if (!pid) return fail(res, 'expect pid');
  if (!(await problemAuth(req, pid)).view) return fail(res, '权限不足');

  const row = await db.one('SELECT stat FROM problem WHERE pid=?', [pid]);
  if (!row || !row.stat) return ok(res, { stat: await updateProblemStat(pid) });
  return ok(res, { stat: JSON.parse(row.stat) });
});

exports.getProblemFastestSubmission = handler(async (req, res) => {
  const { pid } = req.body;
  if (!pid) return fail(res, 'expect pid');
  if (!(await problemAuth(req, pid)).view) return fail(res, '权限不足');

  const data = await db.query(
    'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.cid,s.machine,s.lang,u.name,p.title,p.isPublic ' +
      'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid ' +
      'WHERE p.pid=? AND score=100 ORDER BY s.time LIMIT 10',
    [pid]
  );
  for (const r of data) r.memory = kbFormat(r.memory);
  return ok(res, { data });
});

exports.bindPaste2Problem = handler(async (req, res) => {
  const { pid, mark } = req.body;
  if (!pid || !mark) return fail(res, 'expect pid && mark');
  if (!(await problemAuth(req, pid)).solutionManage) return fail(res, '权限不足');

  const paste = await db.one('SELECT uid,isPublic FROM pastes WHERE mark=?', [mark]);
  if (!paste) return fail(res, `未找到mark为${mark}的剪贴板`);
  if (!canViewPaste(req, paste)) return fail(res, '只能绑定你有权查看的剪贴板');
  const active = await db.exists('SELECT 1 FROM problemSolution WHERE pid=? AND mark=? AND `show`=1', [pid, mark]);
  if (active) return fail(res, '该题解已绑定');
  const hidden = await db.one('SELECT id FROM problemSolution WHERE pid=? AND mark=? ORDER BY id DESC LIMIT 1', [pid, mark]);
  if (hidden) {
    await db.query('UPDATE problemSolution SET `show`=0 WHERE pid=? AND mark=?', [pid, mark]);
    await db.query('UPDATE problemSolution SET `show`=1 WHERE id=?', [hidden.id]);
    return ok(res);
  }
  await db.query('INSERT INTO problemSolution(pid,mark) VALUES (?,?)', [pid, mark]);
  return ok(res);
});

exports.getProblemSol = handler(async (req, res) => {
  const { pid } = req.body;
  if (!pid) return fail(res, 'expect pid');
  const auth = await problemAuth(req, pid);
  if (!auth.view) return fail(res, '权限不足');

  // solVisible 控制题解可见性模式：0 = 任何有 view 权限的人都能看（默认）；
  // 1 = 仅通过本题的用户可见。题目管理者（solutionManage）与拥有 submission.view.any
  // 的账号始终能看，不受该开关影响。
  const prow = await db.one('SELECT solVisible FROM problem WHERE pid=?', [pid]);
  const requireAc = !!(prow && prow.solVisible);
  const accepted = await hasAcceptedProblem(req.session.uid, pid);
  const canWrite = !!req.session.uid && (accepted || auth.solutionManage);
  const unlocked = !requireAc || auth.solutionManage || req.can('submission.view.any') || accepted;
  if (!unlocked) {
    return ok(res, {
      data: [],
      locked: true,
      accepted: false,
      canWrite,
      solVisible: requireAc ? 1 : 0,
      message: '通过本题后可查看题解',
    });
  }

  const params = [pid];
  const pasteVisibleCond = req.can('paste.edit.any') ? '' : ' AND (p.isPublic=1 OR p.uid=?)';
  if (pasteVisibleCond) params.push(req.session.uid || 0);
  const data = await db.query(
    'SELECT s.id,s.mark,p.uid,p.title,u.name,p.time,p.isPublic ' +
      'FROM problemSolution s INNER JOIN (SELECT MIN(id) AS id FROM problemSolution WHERE `show`=1 AND pid=? GROUP BY mark) one ON one.id=s.id ' +
      'INNER JOIN pastes p ON s.mark=p.mark INNER JOIN userInfo u ON p.uid=u.uid ' +
      `WHERE s.show=1${pasteVisibleCond} ORDER BY p.time`,
    params
  );
  for (const r of data) r.time = briefFormat(r.time);
  return ok(res, {
    data,
    locked: false,
    accepted,
    canWrite,
    solVisible: requireAc ? 1 : 0,
  });
});

// 题目管理者切换题解可见性模式（0 = 所有人可见，1 = 通过后可见）。
exports.setSolutionVisibility = handler(async (req, res) => {
  const { pid } = req.body;
  if (!pid) return fail(res, 'expect pid');
  // problemAuth 对不存在的题目返回全 false，因此通过此校验即说明题目存在。
  if (!(await problemAuth(req, pid)).solutionManage) return fail(res, '权限不足');
  const mode = Number(req.body.mode);
  if (mode !== 0 && mode !== 1) return fail(res, '未知可见性模式');
  await db.query('UPDATE problem SET solVisible=? WHERE pid=?', [mode, pid]);
  return ok(res);
});

exports.createSolutionDraft = handler(async (req, res) => {
  const { pid } = req.body;
  if (!pid) return fail(res, 'expect pid');
  const auth = await problemAuth(req, pid);
  if (!auth.view) return fail(res, '权限不足');
  const accepted = await hasAcceptedProblem(req.session.uid, pid);
  if (!accepted && !auth.solutionManage) return fail(res, '通过本题后才能发布题解');

  const problem = await db.one('SELECT title FROM problem WHERE pid=?', [pid]);
  if (!problem) return fail(res, '题目不存在');
  const mark = getMark();
  const title = `P${pid} 题解`;
  const content = [
    `# ${problem.title} 题解`,
    '',
    '## 思路',
    '',
    '## 复杂度',
    '',
    '## 代码',
    '',
    '```cpp',
    '',
    '```',
    '',
    '> 默认创建为私有草稿。编辑完成后可在剪贴板页面设为公开，其他已通过本题的用户即可看到。',
    '',
  ].join('\n');
  // 两条插入放进同一事务：避免 paste 已建但 problemSolution 绑定失败时留下孤儿草稿。
  try {
    await db.tx(async (t) => {
      const r = await t.query(
        'INSERT INTO pastes(mark,title,content,uid,time,isPublic) VALUES (?,?,?,?,?,0)',
        [mark, title.slice(0, 20), content, req.session.uid, new Date()]
      );
      if (!r.affectedRows) throw new Error('insert paste failed');
      await t.query('INSERT INTO problemSolution(pid,mark) VALUES (?,?)', [pid, mark]);
    });
  } catch (e) {
    return fail(res, '创建题解草稿失败');
  }
  return ok(res, { mark });
});

exports.unbindSol = handler(async (req, res) => {
  const { id } = req.body;
  const sol = await db.one('SELECT pid,mark FROM problemSolution WHERE id=?', [id]);
  if (!sol) return fail(res, '记录不存在');
  if (!(await problemAuth(req, sol.pid)).solutionManage) return fail(res, '权限不足');
  await db.query('UPDATE problemSolution SET `show`=0 WHERE pid=? AND mark=?', [sol.pid, sol.mark]);
  return ok(res);
});

exports.getProblemAuth = handler(async (req, res) => {
  const pid = await resolveProblemPid(req.body);
  return ok(res, { data: pid ? await problemAuth(req, pid) : { view: false, manage: false, solutionManage: false } });
});
