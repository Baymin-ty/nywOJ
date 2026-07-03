const fs = require('fs');
const path = require('path');

const config = require('../../config.json');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TMP_RETENTION_MS = Number(process.env.MAINTAINCE_TMP_RETENTION_MS || process.env.MAINTENANCE_TMP_RETENTION_MS) || ONE_DAY_MS;

const configuredKey = () => {
  const security = config.SECURITY || config.security || {};
  return process.env.MAINTAINCE_KEY
    || process.env.MAINTENANCE_KEY
    || security.maintainceKey
    || security.maintenanceKey
    || security.MAINTAINCE_KEY
    || security.MAINTENANCE_KEY
    || null;
};

const tmpRoots = () => [
  path.resolve(__dirname, '..', '..', 'tmp', 'caseUpload'),
  path.resolve(__dirname, '..', '..', 'tmp', 'problemFileUpload'),
  path.resolve(__dirname, '..', '..', 'tmp', 'problemDownload'),
  path.resolve(__dirname, '..', '..', 'tmp', 'answerUpload'),
  path.resolve(process.cwd(), 'tmp', 'answerUpload'),
];

const removeExpired = async (target, now) => {
  let stat;
  try {
    stat = await fs.promises.stat(target);
  } catch (err) {
    if (err && err.code === 'ENOENT') return 0;
    throw err;
  }

  if (!stat.isDirectory()) {
    if (now - stat.mtimeMs < TMP_RETENTION_MS) return 0;
    await fs.promises.rm(target, { force: true });
    return 1;
  }

  let removed = 0;
  const entries = await fs.promises.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    removed += await removeExpired(path.join(target, entry.name), now);
  }

  const refreshed = await fs.promises.readdir(target);
  if (!refreshed.length && now - stat.mtimeMs >= TMP_RETENTION_MS) {
    await fs.promises.rm(target, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
};

const runMaintainceTasks = async () => {
  const now = Date.now();
  const roots = Array.from(new Set(tmpRoots()));
  let removed = 0;
  for (const root of roots) {
    removed += await removeExpired(root, now);
  }
  return { removed };
};

exports.runMaintainceTasks = async (req, res) => {
  const expected = configuredKey();
  const actual = req.get('maintaince-key') || req.get('maintenance-key') || '';

  if (!expected || actual !== expected) {
    res.status(200).send('Wrong maintaince key');
    return;
  }

  try {
    await runMaintainceTasks();
    res.status(200).send('');
  } catch (err) {
    console.error('runMaintainceTasks failed:', err);
    res.status(500).send('Maintaince task failed');
  }
};

exports._private = {
  configuredKey,
  runMaintainceTasks,
  tmpRoots,
};
