const fs = require('fs');
const path = require('path');
const multer = require('multer');
const yauzl = require('yauzl');
const compressing = require('compressing');
const db = require('../../db');
const { recordEvent } = require('../../static');
const storage = require('../../storage');
const { problemAuth } = require('./core');
const {
  DATA_CONFIG_FILE,
  PROFILE_JSON_IMPORT_FILES,
  PROFILE_YAML_IMPORT_FILES,
  isArchiveControlFile,
  listFilesRecursive,
  normalizeRelPath,
  readImportedProfile,
  safeResolve,
} = require('./archive');

const CASE_MAX_TOTAL_SIZE = 200 * 1024 * 1024; // 200MB limit
const PROFILE_MAX_BYTES = 256 * 1024;
const DATA_ROOT = path.resolve(__dirname, '..', '..', 'data');
const CASE_TMP_DIR = path.resolve(__dirname, '..', '..', 'tmp', 'caseUpload');

const removeIfExists = (target) => {
  if (target && fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
};

const randomSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const parsePid = (value) => {
  const raw = String(value == null ? '' : value).trim();
  if (!/^\d+$/.test(raw)) return null;
  const pid = Number(raw);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
};

const hasUnsafeZipEntry = (fileName) => {
  const normalized = path.posix.normalize(String(fileName || '').replace(/\\/g, '/'));
  return normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized);
};

const isZipSymlink = (entry) => {
  const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
  return mode === 0o120000;
};

// Validate zip paths and total extracted size before extraction.
// `unlimited=true` skips the size cap (super-admin equivalent), but never path safety.
const validateZip = (zipPath, unlimited, maxTotalSize) => {
  return new Promise((resolve, reject) => {
    let settled = false;
    let totalSize = 0;
    const entryNames = new Set();
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      zipfile.on('entry', (entry) => {
        if (hasUnsafeZipEntry(entry.fileName)) {
          zipfile.close();
          return finish({ ok: false, err: 'ZIP包含非法路径' });
        }
        const entryName = normalizeRelPath(entry.fileName).replace(/\/$/, '');
        if (entryNames.has(entryName)) {
          zipfile.close();
          return finish({ ok: false, err: `ZIP包含重复路径: ${entryName}` });
        }
        entryNames.add(entryName);
        if (isZipSymlink(entry)) {
          zipfile.close();
          return finish({ ok: false, err: 'ZIP包含符号链接' });
        }
        totalSize += entry.uncompressedSize;
        if (!unlimited && totalSize > maxTotalSize) {
          zipfile.close();
          const limitMB = Math.round(maxTotalSize / 1024 / 1024);
          return finish({ ok: false, err: `ZIP 解压后总大小超过 ${limitMB}MB 限制` });
        }
        zipfile.readEntry();
      });

      zipfile.on('end', () => {
        finish({ ok: true });
      });

      zipfile.on('error', (err) => {
        reject(err);
      });

      zipfile.readEntry();
    });
  });
};

const caseUpload = () => {
  return multer({
    fileFilter: (req, file, cb) => {
      cb(null, true);
    },
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        fs.mkdirSync(CASE_TMP_DIR, { recursive: true });
        cb(null, CASE_TMP_DIR);
      },
      filename: (req, file, cb) => {
        cb(null, `${randomSuffix()}.zip`);
      }
    })
  });
};

const removeArchiveNoise = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === '__MACOSX' || entry.name === '.DS_Store') {
      removeIfExists(full);
    } else if (entry.isDirectory()) {
      removeArchiveNoise(full);
    }
  }
};

const normalizeSingleRootFolder = (dir) => {
  removeArchiveNoise(dir);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) return;

  const inner = path.join(dir, entries[0].name);
  for (const child of fs.readdirSync(inner)) {
    fs.renameSync(path.join(inner, child), path.join(dir, child));
  }
  removeIfExists(inner);
  removeArchiveNoise(dir);
};

const copyMissingFiles = (source, target) => {
  if (!fs.existsSync(source)) return;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyMissingFiles(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  if (stat.isFile() && !fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
};

const carryExistingAssets = (destination, workDir) => {
  const existingChecker = path.join(destination, 'checker.cpp');
  if (!fs.existsSync(path.join(workDir, 'checker.cpp')) && fs.existsSync(existingChecker)) {
    fs.copyFileSync(existingChecker, path.join(workDir, 'checker.cpp'));
  }
  copyMissingFiles(path.join(destination, 'assets'), path.join(workDir, 'assets'));
};

const processUploadedFiles = (files) => {
  const fileSet = new Set(files);
  let cases = [];
  for (const file of files) {
    if (file.startsWith('assets/') || isArchiveControlFile(file) || file === DATA_CONFIG_FILE) continue;
    if (file.endsWith('.in')) {
      const name = file.slice(0, -3);
      if (fileSet.has(`${name}.out`)) {
        cases.push({
          name: name,
          input: file,
          output: `${name}.out`,
        });
      }
    }
  }

  cases.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return cases.map((c, index) => ({
    index: index + 1,
    input: c.input,
    output: c.output,
    subtaskId: 1
  }));
};

const normalizeDependencies = (dependencies, subtaskIndex) => {
  if (!Array.isArray(dependencies)) return [];
  return dependencies.map(Number).map((dep) => {
    if (!Number.isInteger(dep) || dep < 1 || dep >= subtaskIndex) {
      throw new Error(`子任务 #${subtaskIndex} 依赖了非法子任务 #${dep}`);
    }
    return dep;
  });
};

const normalizeBool = (value) => value === true || value === 1 || value === '1';

const validateAndNormalizeCaseConfig = (config, root) => {
  if (!config || typeof config !== 'object') throw new Error('config.json 不是对象');
  const rawCases = Array.isArray(config.cases) ? config.cases : [];
  const rawSubtasks = Array.isArray(config.subtask) ? config.subtask : [];
  if (!rawCases.length) throw new Error('config.json 中 cases 为空');
  if (!rawSubtasks.length) throw new Error('config.json 中 subtask 为空');

  const subtaskIds = new Set();
  let totalScore = 0;
  const subtask = rawSubtasks.map((s, i) => {
    const index = Number(s && s.index);
    if (!Number.isInteger(index) || index !== i + 1) throw new Error(`子任务 #${s && s.index} 编号非法或不连续`);
    if (subtaskIds.has(index)) throw new Error(`子任务 #${index} 编号重复`);
    subtaskIds.add(index);

    const score = Number(s.score);
    if (!Number.isInteger(score) || score < 1 || score > 100) throw new Error(`子任务 #${index} 分数非法`);
    totalScore += score;

    const option = Number(s.option);
    if (option !== 0 && option !== 1) throw new Error(`子任务 #${index} 记分方式非法`);

    const dependencies = normalizeDependencies(s.dependencies, index);
    const skip = normalizeBool(s.skip);
    if (option === 0 && (skip || dependencies.length)) {
      throw new Error(`等分子任务 #${index} 不能设置 skip/dependencies`);
    }
    return { index, score, option, skip, dependencies };
  });
  if (totalScore !== 100) throw new Error(`子任务分数之和应等于100分，当前为 ${totalScore}`);

  const caseIndices = new Set();
  const cases = rawCases.map((c) => {
    const index = Number(c && c.index);
    if (!Number.isInteger(index) || index < 1) throw new Error(`测试点 #${c && c.index} 编号非法`);
    if (caseIndices.has(index)) throw new Error(`测试点 #${index} 编号重复`);
    caseIndices.add(index);

    const input = normalizeRelPath(c.input);
    const output = normalizeRelPath(c.output);
    const inputPath = safeResolve(root, input);
    const outputPath = safeResolve(root, output);
    if (!inputPath || !fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile())
      throw new Error(`测试点 #${index} 输入文件不存在或路径非法: ${c.input}`);
    if (!outputPath || !fs.existsSync(outputPath) || !fs.statSync(outputPath).isFile())
      throw new Error(`测试点 #${index} 输出文件不存在或路径非法: ${c.output}`);

    const subtaskId = Number(c.subtaskId);
    if (!subtaskIds.has(subtaskId)) throw new Error(`测试点 #${index} 所属子任务 #${c.subtaskId} 未定义`);
    return { index, input, output, subtaskId };
  }).sort((a, b) => a.index - b.index);

  for (let i = 0; i < cases.length; i++) {
    if (cases[i].index !== i + 1) throw new Error(`测试点编号应从 1 连续递增，当前缺少 #${i + 1}`);
  }

  const usedSubtasks = new Set(cases.map((c) => c.subtaskId));
  for (const s of subtask) {
    if (!usedSubtasks.has(s.index)) throw new Error(`子任务 #${s.index} 中没有测试点`);
  }

  return { cases, subtask };
};

const loadOrBuildCaseConfig = async (root) => {
  const configPath = path.join(root, DATA_CONFIG_FILE);
  let configImported = false;
  let config = null;

  if (fs.existsSync(configPath)) {
    config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    configImported = true;
  } else {
    const files = listFilesRecursive(root);
    const uniqueCases = processUploadedFiles(files);
    config = {
      cases: uniqueCases,
      subtask: [{
        index: 1,
        score: 100,
        option: 0,
        skip: false,
        dependencies: [],
      }]
    };
  }

  const normalized = validateAndNormalizeCaseConfig(config, root);
  await fs.promises.writeFile(configPath, JSON.stringify(normalized));
  return { config: normalized, configImported };
};

const removeProfileControlFiles = (root) => {
  for (const name of [...PROFILE_YAML_IMPORT_FILES, ...PROFILE_JSON_IMPORT_FILES]) {
    const full = path.join(root, name);
    if (fs.existsSync(full)) fs.rmSync(full, { force: true });
  }
};

const parseJudgeProfileImport = (root) => {
  const imported = readImportedProfile(root);
  if (!imported) return null;

  const { presetToType, validateProfile } = require('./judgeProfile');
  const { ok, errors } = validateProfile(imported.profile);
  if (!ok) throw new Error('评测流程配置校验失败: ' + errors.slice(0, 5).join('；'));

  const serialized = JSON.stringify(imported.profile);
  if (Buffer.byteLength(serialized, 'utf-8') > PROFILE_MAX_BYTES) throw new Error('评测流程配置过大');
  return {
    profile: imported.profile,
    serialized,
    source: imported.source,
    type: presetToType(imported.profile),
  };
};

const handleCaseUpload = async (req, res) => {
  let workDir = null;
  try {
    const signedAccess = req.signedProblemAccess;
    const pid = parsePid(signedAccess ? signedAccess.pid : req.body.pid);
    if (!pid) {
      removeIfExists(req.file && req.file.path);
      return res.status(202).send({ err: '非法pid参数' });
    }
    if (!req.file || !req.file.path) {
      return res.status(202).send({ err: '未上传文件' });
    }
    const signedUpload = signedAccess && signedAccess.action === 'uploadData' && Number(signedAccess.pid) === pid;
    if (!signedUpload && !(await problemAuth(req, pid)).manage) {
      removeIfExists(req.file.path);
      return res.status(403).end('403 Forbidden');
    }

    const validation = await validateZip(req.file.path, req.can('problem.manage.any'), CASE_MAX_TOTAL_SIZE);
    if (!validation.ok) {
      removeIfExists(req.file.path);
      return res.status(202).send({ err: validation.err });
    }

    workDir = path.join(CASE_TMP_DIR, `extract-${randomSuffix()}`);
    fs.mkdirSync(workDir, { recursive: true });
    await compressing.zip.uncompress(req.file.path, workDir);
    removeIfExists(req.file.path);

    normalizeSingleRootFolder(workDir);
    const profileImport = parseJudgeProfileImport(workDir);
    const { config, configImported } = await loadOrBuildCaseConfig(workDir);
    removeProfileControlFiles(workDir);

    fs.mkdirSync(DATA_ROOT, { recursive: true });
    const destination = path.join(DATA_ROOT, String(pid));
    // The upload replaces the whole data dir. Preserve online-edited assets
    // that are not bundled in this ZIP, so re-uploading data does not silently
    // wipe checker/grader/interactor files.
    carryExistingAssets(destination, workDir);

    const backupDir = fs.existsSync(destination)
      ? path.join(DATA_ROOT, `.${pid}.backup-${randomSuffix()}`)
      : null;
    if (backupDir) fs.renameSync(destination, backupDir);
    let installed = false;
    try {
      fs.renameSync(workDir, destination);
      workDir = null;
      installed = true;
      if (profileImport) {
        const r = await db.query('UPDATE problem SET judgeProfile=?, type=? WHERE pid=?', [
          profileImport.serialized,
          profileImport.type,
          pid,
        ]);
        if (!r.affectedRows) throw new Error('题目不存在或评测流程导入失败');
        recordEvent(req, 'problem.saveJudgeProfile', {
          pid,
          preset: profileImport.profile.preset,
          source: profileImport.source,
        }, signedAccess && signedAccess.uid);
      }
      await storage.mirrorProblemData(pid, destination);
      recordEvent(req, 'problem.uploadData', {
        pid,
        cases: config.cases.length,
        configImported,
        profileImported: !!profileImport,
      }, signedAccess && signedAccess.uid);
      removeIfExists(backupDir);
    } catch (err) {
      if (installed && fs.existsSync(destination)) removeIfExists(destination);
      if (backupDir && fs.existsSync(backupDir)) {
        fs.renameSync(backupDir, destination);
      }
      throw err;
    }

    res.json({
      file: { ...req.file, destination: `./data/${pid}` },
      cases: config.cases.length,
      configImported,
      profileImported: !!profileImport,
      profileSource: profileImport && profileImport.source,
    });
  } catch (error) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      removeIfExists(req.file.path);
    }
    removeIfExists(workDir);
    res.status(202).send({ err: error.message });
  }
};

const verifySignedCaseUpload = (req, res, next) => {
  const access = storage.verifyToken(req.query.token || (req.body && req.body.token), 'uploadData');
  if (!access || !access.pid || !access.uid) return res.status(403).end('403 Forbidden');
  req.signedProblemAccess = access;
  return next();
};

// Submit-answer uploads (problem.type ∈ {2,3}). User drops a ZIP of `.out`
// files. We accept the upload to a temp path and the submitAnswer handler
// extracts / matches case names. Single in-flight upload per request — no
// per-pid directory collision possible because the temp filename is
// uuid-tagged on the request.
const ANSWER_TMP_DIR = './tmp/answerUpload';

const answerUpload = () => {
  if (!fs.existsSync(ANSWER_TMP_DIR)) fs.mkdirSync(ANSWER_TMP_DIR, { recursive: true });
  return multer({
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB hard cap on the zip itself
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        if (!fs.existsSync(ANSWER_TMP_DIR)) fs.mkdirSync(ANSWER_TMP_DIR, { recursive: true });
        cb(null, ANSWER_TMP_DIR);
      },
      filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.zip`);
      },
    }),
  });
};

module.exports = {
  caseUpload: caseUpload(),
  verifySignedCaseUpload,
  handleCaseUpload,
  answerUpload: answerUpload(),
  ANSWER_TMP_DIR,
  loadOrBuildCaseConfig,
  normalizeSingleRootFolder,
  parseJudgeProfileImport,
  removeArchiveNoise,
  removeIfExists,
  removeProfileControlFiles,
  validateZip,
};
