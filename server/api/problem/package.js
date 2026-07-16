require('express-zip');

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const compressing = require('compressing');
const multer = require('multer');

const db = require('../../db');
const storage = require('../../storage');
const { handler, fail, ok } = require('../../db/util');
const { recordEvent } = require('../../static');
const {
  ensureProblemSampleSchema,
  loadProblemSamples,
  problemAuth,
} = require('./core');
const {
  DATA_CONFIG_FILE,
  FULL_ARCHIVE_FORMAT,
  PROBLEM_JSON_FILE,
  PROFILE_CONFIG_FILE,
  PROFILE_YAML_FILE,
  buildFullProblemManifest,
  buildProfileConfigJson,
  dumpProfileYaml,
  isArchiveControlFile,
  listFilesRecursive,
  normalizeFullProblemManifest,
  normalizeRelPath,
} = require('./archive');
const {
  loadOrBuildCaseConfig,
  normalizeSingleRootFolder,
  parseJudgeProfileImport,
  removeIfExists,
  removeProfileControlFiles,
  validateZip,
} = require('./upload');

const PACKAGE_MAX_FILE_SIZE = 256 * 1024 * 1024;
const PACKAGE_MAX_TOTAL_SIZE = 512 * 1024 * 1024;
const MANIFEST_MAX_BYTES = 1024 * 1024;
const IMPORT_TTL_MS = 60 * 60 * 1000;
const DATA_ROOT = path.resolve(__dirname, '..', '..', 'data');
const PACKAGE_TMP_DIR = path.resolve(__dirname, '..', '..', 'tmp', 'problemPackage');
const IMPORT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
};

const dataDirOf = (pid) => path.join(DATA_ROOT, String(pid));
const sessionDirOf = (importId) => path.join(PACKAGE_TMP_DIR, importId);
const payloadDirOf = (importId) => path.join(sessionDirOf(importId), 'payload');
const metaPathOf = (importId) => path.join(sessionDirOf(importId), 'meta.json');

const cleanupExpiredImports = () => {
  if (!fs.existsSync(PACKAGE_TMP_DIR)) return;
  const now = Date.now();
  for (const entry of fs.readdirSync(PACKAGE_TMP_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !IMPORT_ID_RE.test(entry.name)) continue;
    const full = sessionDirOf(entry.name);
    try {
      if (now - fs.statSync(full).mtimeMs > IMPORT_TTL_MS) removeIfExists(full);
    } catch (_) { /* another request may have removed it */ }
  }
};

const packageUpload = multer({
  limits: { fileSize: PACKAGE_MAX_FILE_SIZE, files: 1 },
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(PACKAGE_TMP_DIR, { recursive: true });
      cb(null, PACKAGE_TMP_DIR);
    },
    filename: (req, file, cb) => cb(null, `upload-${crypto.randomUUID()}.zip`),
  }),
});

const effectiveJudgeProfile = (problem) => {
  const { profileForType } = require('./judgeProfile');
  if (problem && problem.judgeProfile) {
    try {
      const profile = JSON.parse(problem.judgeProfile);
      if (profile && typeof profile === 'object') return profile;
    } catch (_) { /* use the type-derived profile */ }
  }
  return profileForType(problem ? problem.type : 0);
};

const addZipFile = (files, seen, filePath, name) => {
  const zipName = normalizeRelPath(name);
  if (!zipName || seen.has(zipName)) throw new Error(`题目包文件名非法或重复: ${zipName || name}`);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`题目包文件不存在: ${zipName}`);
  seen.add(zipName);
  files.push({ path: filePath, name: zipName });
};

const restoreRemoteDataIfNeeded = async (pid, target) => {
  if (fs.existsSync(target) || !storage.isRemote()) return;
  try {
    await storage.restoreProblemData(pid, target);
  } catch (err) {
    if (!(err && err.response && err.response.status === 404)) throw err;
  }
};

const serveProblemExport = async (req, res, pid, auditUid) => {
  const problem = await db.one(
    'SELECT pid,title,description,timeLimit,memoryLimit,tags,level,lang,type,judgeProfile FROM problem WHERE pid=?',
    [pid]
  );
  if (!problem) return fail(res, '题目不存在', 404);

  const dataDir = dataDirOf(pid);
  await restoreRemoteDataIfNeeded(pid, dataDir);
  const profile = effectiveJudgeProfile(problem);
  const samples = await loadProblemSamples(pid);
  const manifest = buildFullProblemManifest({
    title: problem.title,
    description: problem.description,
    samples: samples.map((sample) => ({ input: sample.inputData, output: sample.outputData })),
    tags: parseJsonArray(problem.tags),
    difficulty: problem.level,
    timeLimit: problem.timeLimit,
    memoryLimit: problem.memoryLimit,
    langMask: problem.lang,
  }, {
    version: 2,
    exportedAt: new Date().toISOString(),
    sourcePid: Number(pid),
  });

  const tmpDir = path.join(PACKAGE_TMP_DIR, `export-${crypto.randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const manifestPath = path.join(tmpDir, PROBLEM_JSON_FILE);
  const yamlPath = path.join(tmpDir, PROFILE_YAML_FILE);
  const profileConfigPath = path.join(tmpDir, PROFILE_CONFIG_FILE);
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await fs.promises.writeFile(yamlPath, dumpProfileYaml(profile));
  await fs.promises.writeFile(profileConfigPath, buildProfileConfigJson(profile));

  const files = [];
  const seen = new Set();
  addZipFile(files, seen, manifestPath, PROBLEM_JSON_FILE);
  addZipFile(files, seen, yamlPath, PROFILE_YAML_FILE);
  addZipFile(files, seen, profileConfigPath, PROFILE_CONFIG_FILE);
  for (const rel of listFilesRecursive(dataDir)) {
    if (rel === 'preview.json' || isArchiveControlFile(rel)) continue;
    addZipFile(files, seen, path.join(dataDir, rel), rel);
  }

  recordEvent(req, 'problem.export', { pid, files: files.length }, auditUid);
  const cleanup = () => removeIfExists(tmpDir);
  res.once('finish', cleanup);
  res.once('close', cleanup);
  return res.zip(files, `nywoj_Problem_#${pid}.zip`, (err) => {
    if (err) cleanup();
  });
};

const directExport = handler(async (req, res) => {
  const pid = Number(req.query.pid || (req.body && req.body.pid));
  if (!Number.isSafeInteger(pid) || pid <= 0) return fail(res, '非法 pid 参数');
  if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
  return serveProblemExport(req, res, pid, req.session.uid);
});

const signedExport = handler(async (req, res) => {
  const access = storage.verifyToken(req.query.token, 'exportProblem');
  if (!access || !access.pid || !access.uid) return res.status(403).end('403 Forbidden');
  return serveProblemExport(req, res, Number(access.pid), Number(access.uid));
});

const listImportedAssets = (root) => {
  const names = [];
  const checker = path.join(root, 'checker.cpp');
  if (fs.existsSync(checker) && fs.statSync(checker).isFile()) names.push('checker.cpp');
  const assetsDir = path.join(root, 'assets');
  if (fs.existsSync(assetsDir)) {
    for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
      if (entry.isFile()) names.push(entry.name);
    }
  }
  return names;
};

const shouldLoadCaseConfig = (root, files) => {
  if (fs.existsSync(path.join(root, DATA_CONFIG_FILE))) return true;
  return files.some((rel) => !rel.startsWith('assets/') && /\.(in|out)$/i.test(rel));
};

const inspectImportPayload = async (root) => {
  const manifestPath = path.join(root, PROBLEM_JSON_FILE);
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    throw new Error(`题目包缺少 ${PROBLEM_JSON_FILE}；纯测试数据包请在已有题目的数据页导入`);
  }
  if (fs.statSync(manifestPath).size > MANIFEST_MAX_BYTES) throw new Error('problem.json 过大');
  const manifest = normalizeFullProblemManifest(JSON.parse(await fs.promises.readFile(manifestPath, 'utf-8')));

  let profileImport = parseJudgeProfileImport(root);
  if (!profileImport) {
    const { buildPreset, presetToType } = require('./judgeProfile');
    const profile = buildPreset('traditional');
    profileImport = {
      profile,
      serialized: JSON.stringify(profile),
      source: '默认传统评测流程',
      type: presetToType(profile),
    };
  }

  const files = listFilesRecursive(root);
  const caseResult = shouldLoadCaseConfig(root, files) ? await loadOrBuildCaseConfig(root) : null;
  const assets = listImportedAssets(root);
  const { profileHealth } = require('./judgeProfile');
  const health = profileHealth(profileImport.profile, assets);
  const inventory = listFilesRecursive(root)
    .filter((rel) => rel !== 'preview.json' && !isArchiveControlFile(rel))
    .map((rel) => ({
      name: rel,
      size: fs.statSync(path.join(root, rel)).size,
    }));

  return {
    manifest,
    profileImport,
    config: caseResult && caseResult.config,
    configImported: !!(caseResult && caseResult.configImported),
    assets,
    health,
    inventory,
  };
};

const previewDto = (inspection) => ({
  format: FULL_ARCHIVE_FORMAT,
  title: inspection.manifest.statement.title,
  tags: inspection.manifest.statement.tags,
  difficulty: inspection.manifest.statement.difficulty,
  timeLimit: inspection.manifest.statement.timeLimit,
  memoryLimit: inspection.manifest.statement.memoryLimit,
  samples: inspection.manifest.statement.samples.length,
  cases: inspection.config ? inspection.config.cases.length : 0,
  subtasks: inspection.config ? inspection.config.subtask.length : 0,
  assets: inspection.assets,
  files: inspection.inventory.slice(0, 100),
  fileCount: inspection.inventory.length,
  profile: inspection.profileImport.profile.preset || 'custom',
  profileSource: inspection.profileImport.source,
  profileHealth: inspection.health,
});

const previewProblemImport = handler(async (req, res) => {
  cleanupExpiredImports();
  if (!req.can('problem.create')) {
    removeIfExists(req.file && req.file.path);
    return res.status(403).end('403 Forbidden');
  }
  if (!req.file || !req.file.path) return fail(res, '请选择题目 ZIP 包');

  const uploadPath = req.file.path;
  const importId = crypto.randomUUID();
  const sessionDir = sessionDirOf(importId);
  const payloadDir = payloadDirOf(importId);
  try {
    const validation = await validateZip(uploadPath, false, PACKAGE_MAX_TOTAL_SIZE);
    if (!validation.ok) return fail(res, validation.err);

    fs.mkdirSync(payloadDir, { recursive: true });
    await compressing.zip.uncompress(uploadPath, payloadDir);
    normalizeSingleRootFolder(payloadDir);
    const inspection = await inspectImportPayload(payloadDir);
    await fs.promises.writeFile(metaPathOf(importId), JSON.stringify({
      uid: Number(req.session.uid),
      createdAt: Date.now(),
      originalName: String(req.file.originalname || '').slice(0, 255),
    }));
    const token = storage.signToken({
      action: 'importProblem',
      importId,
      uid: Number(req.session.uid),
    }, Math.floor(IMPORT_TTL_MS / 1000));
    return ok(res, { token, preview: previewDto(inspection) });
  } finally {
    removeIfExists(uploadPath);
    if (!fs.existsSync(metaPathOf(importId))) removeIfExists(sessionDir);
  }
});

const readImportSession = async (req) => {
  const access = storage.verifyToken(req.body && req.body.token, 'importProblem');
  const uid = Number(req.session.uid);
  if (!access || !IMPORT_ID_RE.test(String(access.importId || '')) || Number(access.uid) !== uid) return null;
  const importId = String(access.importId);
  const metaPath = metaPathOf(importId);
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));
  if (Number(meta.uid) !== uid || Date.now() - Number(meta.createdAt) > IMPORT_TTL_MS) return null;
  return { importId, payloadDir: payloadDirOf(importId), meta };
};

const preparePayloadForInstall = (root) => {
  removeProfileControlFiles(root);
  removeIfExists(path.join(root, PROBLEM_JSON_FILE));
  removeIfExists(path.join(root, 'preview.json'));
};

const restorePayloadControls = (root, inspection) => {
  if (!fs.existsSync(root)) return;
  const manifest = buildFullProblemManifest(inspection.manifest.statement);
  fs.writeFileSync(path.join(root, PROBLEM_JSON_FILE), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(root, PROFILE_YAML_FILE), dumpProfileYaml(inspection.profileImport.profile));
  fs.writeFileSync(path.join(root, PROFILE_CONFIG_FILE), buildProfileConfigJson(inspection.profileImport.profile));
};

const performProblemImport = async (req, res, session) => {
  const inspection = await inspectImportPayload(session.payloadDir);
  if (!inspection.health.ok) {
    return fail(res, `评测流程体检未通过：${inspection.health.errors.slice(0, 5).join('；')}`);
  }
  const statement = inspection.manifest.statement;
  await ensureProblemSampleSchema();

  let pid = null;
  let destination = null;
  let installed = false;
  try {
    await db.tx(async (tx) => {
      const inserted = await tx.query(
        `INSERT INTO problem(title,description,publisher,isPublic,time,timeLimit,memoryLimit,type,tags,level,lang,judgeProfile)
         VALUES (?,?,?,0,?,?,?,?,?,?,?,?)`,
        [
          statement.title,
          statement.description,
          Number(req.session.uid),
          new Date(),
          statement.timeLimit,
          statement.memoryLimit,
          inspection.profileImport.type,
          JSON.stringify(statement.tags),
          statement.difficulty,
          statement.langMask,
          inspection.profileImport.serialized,
        ]
      );
      if (!inserted.affectedRows) throw new Error('创建题目失败');
      pid = Number(inserted.insertId);
      await tx.query('INSERT INTO problemSample(pid,samples,updateTime) VALUES (?,?,?)', [
        pid,
        JSON.stringify(statement.samples),
        new Date(),
      ]);

      preparePayloadForInstall(session.payloadDir);
      const files = listFilesRecursive(session.payloadDir);
      if (files.length) {
        fs.mkdirSync(DATA_ROOT, { recursive: true });
        destination = dataDirOf(pid);
        if (fs.existsSync(destination)) throw new Error(`题目数据目录已存在: ${pid}`);
        fs.renameSync(session.payloadDir, destination);
        installed = true;
        await storage.mirrorProblemData(pid, destination);
      }
    });
  } catch (err) {
    if (installed && destination && fs.existsSync(destination) && !fs.existsSync(session.payloadDir)) {
      fs.mkdirSync(path.dirname(session.payloadDir), { recursive: true });
      fs.renameSync(destination, session.payloadDir);
    }
    restorePayloadControls(session.payloadDir, inspection);
    if (pid) await storage.deleteProblemDataArchive(pid).catch(() => {});
    throw err;
  }

  removeIfExists(sessionDirOf(session.importId));
  recordEvent(req, 'problem.import', {
    pid,
    source: session.meta.originalName,
    cases: inspection.config ? inspection.config.cases.length : 0,
    assets: inspection.assets.length,
  });
  return ok(res, {
    pid,
    isPublic: false,
    cases: inspection.config ? inspection.config.cases.length : 0,
    assets: inspection.assets.length,
  });
};

const importProblem = handler(async (req, res) => {
  cleanupExpiredImports();
  if (!req.can('problem.create')) return res.status(403).end('403 Forbidden');
  const session = await readImportSession(req);
  if (!session || !fs.existsSync(session.payloadDir)) return fail(res, '导入预览已失效，请重新选择题目包');

  const lockPath = path.join(sessionDirOf(session.importId), 'import.lock');
  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, 'wx');
  } catch (err) {
    if (err && err.code === 'EEXIST') return fail(res, '该题目包正在导入，请勿重复提交');
    throw err;
  }

  try {
    return await performProblemImport(req, res, session);
  } finally {
    try { fs.closeSync(lockFd); } catch (_) { /* session cleanup may race with close */ }
    removeIfExists(lockPath);
  }
});

module.exports = {
  directExport,
  importProblem,
  packageUpload,
  previewProblemImport,
  signedExport,
  _test: {
    inspectImportPayload,
    performProblemImport,
    previewDto,
    shouldLoadCaseConfig,
  },
};
