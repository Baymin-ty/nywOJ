const fs = require('fs');
const path = require('path');
const multer = require('multer');
const yauzl = require('yauzl');
const compressing = require('compressing');
const { problemAuth } = require('./problem');

const CASE_MAX_TOTAL_SIZE = 200 * 1024 * 1024; // 200MB limit
const DATA_ROOT = path.resolve(__dirname, '..', 'data');
const CASE_TMP_DIR = path.resolve(__dirname, '..', 'tmp', 'caseUpload');

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
        if (isZipSymlink(entry)) {
          zipfile.close();
          return finish({ ok: false, err: 'ZIP包含符号链接' });
        }
        totalSize += entry.uncompressedSize;
        if (!unlimited && totalSize > maxTotalSize) {
          zipfile.close();
          return finish({ ok: false, err: 'Total uncompressed size exceeds 200MB limit' });
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

const processUploadedFiles = async (files, destination) => {
  let cases = [];
  for (const file of files) {
    if (file.endsWith('.in')) {
      const name = file.slice(0, -3);
      if (fs.existsSync(path.join(destination, `${name}.out`))) {
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

const handleCaseUpload = async (req, res) => {
  let workDir = null;
  try {
    const pid = parsePid(req.body.pid);
    if (!pid) {
      removeIfExists(req.file && req.file.path);
      return res.status(202).send({ err: '非法pid参数' });
    }
    if (!req.file || !req.file.path) {
      return res.status(202).send({ err: '未上传文件' });
    }
    if (!(await problemAuth(req, pid)).manage) {
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

    const files = await fs.promises.readdir(workDir);
    const uniqueCases = await processUploadedFiles(files, workDir);
    const config = {
      cases: uniqueCases,
      subtask: [{
        index: 1,
        score: 100,
        option: 0,
        skip: false
      }]
    };
    await fs.promises.writeFile(path.join(workDir, 'config.json'), JSON.stringify(config));

    fs.mkdirSync(DATA_ROOT, { recursive: true });
    const destination = path.join(DATA_ROOT, String(pid));
    const backupDir = fs.existsSync(destination)
      ? path.join(DATA_ROOT, `.${pid}.backup-${randomSuffix()}`)
      : null;
    if (backupDir) fs.renameSync(destination, backupDir);
    try {
      fs.renameSync(workDir, destination);
      workDir = null;
      removeIfExists(backupDir);
    } catch (err) {
      if (backupDir && fs.existsSync(backupDir) && !fs.existsSync(destination)) {
        fs.renameSync(backupDir, destination);
      }
      throw err;
    }

    res.json({ file: { ...req.file, destination: `./data/${pid}` } });
  } catch (error) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      removeIfExists(req.file.path);
    }
    removeIfExists(workDir);
    res.status(202).send({ err: error.message });
  }
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
  handleCaseUpload,
  answerUpload: answerUpload(),
  ANSWER_TMP_DIR,
};
