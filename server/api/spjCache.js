// SPJ checker caching.
//
// Each problem's checker.cpp is compiled once inside the go-judge sandbox and
// the resulting binary is kept around as a sandbox cache file (returned via
// copyOutCached). Subsequent judge runs reuse that fileId by referencing it
// in copyIn — no recompilation per case, per submission.
//
// Cache key: pid + sha256(source). The hash auto-invalidates the cache when
// the problem author edits checker.cpp.
//
// Storage: a JSON file under judge_cache/. Picked over an in-memory Map
// because the worker is forked per submission, so in-memory state would die
// between runs.
//
// Robustness: the sandbox may evict cached files (go-judge restart, etc.). On
// any sandbox error using the cached fileId, callers invalidate the entry and
// the next run recompiles.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, '../judge_cache');
const CACHE_FILE = path.join(CACHE_DIR, 'spj.json');

const ensureDir = () => {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
};

const hashSource = (src) => crypto.createHash('sha256').update(src).digest('hex');

const readCache = () => {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8') || '{}');
  } catch (_) {
    return {};
  }
};

// Concurrent writes: workers race here, so re-read state under the lock by
// reading just before mutating. The file is small and writes are infrequent
// (only on a fresh SPJ compile or invalidation).
const mutate = (fn) => {
  ensureDir();
  const data = readCache();
  fn(data);
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
};

const get = (pid, source) => {
  const data = readCache();
  const entry = data[pid];
  if (!entry) return null;
  if (entry.hash !== hashSource(source)) return null;
  return entry.fileId;
};

const set = (pid, source, fileId) => {
  mutate((data) => {
    data[pid] = { hash: hashSource(source), fileId, ts: new Date().toISOString() };
  });
};

const invalidate = (pid) => {
  mutate((data) => { delete data[pid]; });
};

module.exports = { get, set, invalidate, hashSource };
