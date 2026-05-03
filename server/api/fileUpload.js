const fs = require('fs');
const path = require('path');
const multer = require('multer');
const yauzl = require('yauzl');
const { setFile } = require('../file');
const compressing = require('compressing');
const { problemAuth } = require('./problem');

const CASE_MAX_TOTAL_SIZE = 200 * 1024 * 1024; // 200MB limit

// Check zip file size before extraction
const checkZipSize = (zipPath, userGid, maxTotalSize) => {
  return new Promise((resolve, reject) => {
    if (userGid >= 3) {
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
    if (req.session.gid < 2 || !((await problemAuth(req, req.body.pid)).manage)) {
      return res.status(403).end('403 Forbidden');
    }

    const isSizeValid = await checkZipSize(req.file.path, req.session.gid, CASE_MAX_TOTAL_SIZE);
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

module.exports = {
  caseUpload: caseUpload(),
  handleCaseUpload
};