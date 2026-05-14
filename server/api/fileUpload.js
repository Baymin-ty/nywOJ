const fs = require('fs');
const path = require('path');
const multer = require('multer');
const yauzl = require('yauzl');
const { setFile } = require('../file');
const compressing = require('compressing');
const { problemAuth } = require('./problem');

const CASE_MAX_TOTAL_SIZE = 200 * 1024 * 1024; // 200MB limit

// Check zip file size before extraction. `unlimited=true` skips the cap (super-admin equivalent).
const checkZipSize = (zipPath, unlimited, maxTotalSize) => {
  return new Promise((resolve, reject) => {
    if (unlimited) {
      resolve(true);
      return;
    }

    let totalSize = 0;
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) reject(err);

      zipfile.on('entry', (entry) => {
        totalSize += entry.uncompressedSize;
        if (totalSize > maxTotalSize) {
          zipfile.close();
          resolve(false);
        }
        zipfile.readEntry();
      });

      zipfile.on('end', () => {
        resolve(true);
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
        const dir = "./data/" + req.body.pid;
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true });
        }
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        cb(null, 'data.zip');
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
  try {
    if (!(await problemAuth(req, req.body.pid)).manage) {
      return res.status(403).end('403 Forbidden');
    }

    const isSizeValid = await checkZipSize(req.file.path, req.can('problem.manage.any'), CASE_MAX_TOTAL_SIZE);
    if (!isSizeValid) {
      fs.unlinkSync(req.file.path); // delete
      return res.status(202).send({
        err: "Total uncompressed size exceeds 200MB limit"
      });
    }

    await compressing.zip.uncompress(req.file.path, req.file.destination);

    fs.readdir(req.file.destination, async (err, files) => {
      if (err)
        return res.status(202).send({ err: err });
      const uniqueCases = await processUploadedFiles(files, req.file.destination);
      const config = {
        cases: uniqueCases,
        subtask: [{
          index: 1,
          score: 100,
          option: 0,
          skip: false
        }]
      };
      await setFile(`${req.file.destination}/config.json`, JSON.stringify(config));
      res.json({ file: req.file });
    });
  } catch (error) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
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