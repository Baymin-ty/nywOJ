// Generic judge artifact cache for profile compile steps whose inputs are all
// problem-owned assets (manager/interactor/grader/checker helpers, headers,
// implicit testlib.h). Submission-dependent compile steps are intentionally not
// cached.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, '..', '..', 'judge_cache');
const CACHE_FILE = path.join(CACHE_DIR, 'artifacts.json');
const CACHE_VERSION = 1;

const ensureDir = () => {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
};

const hashText = (value) =>
  crypto.createHash('sha256').update(String(value == null ? '' : value)).digest('hex');

const readCache = () => {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8') || '{}');
  } catch (_) {
    return {};
  }
};

const mutate = (fn) => {
  ensureDir();
  const data = readCache();
  fn(data);
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
};

const keyOf = (pid, stepId) => `${pid}:${stepId}`;

const compileHash = (step, inputs) => {
  const payload = {
    version: CACHE_VERSION,
    id: step && step.id,
    command: step && step.command,
    inputs: [...(inputs || [])]
      .map((input) => ({
        name: input.name,
        source: input.source,
        hash: hashText(input.content),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source)),
  };
  return hashText(JSON.stringify(payload));
};

const get = (pid, stepId, hash) => {
  const entry = readCache()[keyOf(pid, stepId)];
  if (!entry || entry.version !== CACHE_VERSION || entry.hash !== hash) return null;
  return entry.fileId || null;
};

const set = (pid, stepId, hash, fileId) => {
  mutate((data) => {
    data[keyOf(pid, stepId)] = {
      version: CACHE_VERSION,
      hash,
      fileId,
      ts: new Date().toISOString(),
    };
  });
};

const invalidate = (pid, stepId) => {
  mutate((data) => { delete data[keyOf(pid, stepId)]; });
};

module.exports = {
  compileHash,
  get,
  set,
  invalidate,
};
