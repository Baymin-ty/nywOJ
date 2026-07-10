const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'judge_logs');
const MAX_FIELD = 256;

const ensureDir = () => {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
};

const logPath = (sid) => path.join(LOG_DIR, `${sid}.log`);

const buildLine = (payload) =>
  `${JSON.stringify({ ts: new Date().toISOString(), ...payload })}\n`;

const resetJudgeLog = async (sid, meta = {}) => {
  try {
    ensureDir();
    await fs.promises.writeFile(logPath(sid), buildLine({ event: 'start', meta }), 'utf8');
  } catch (err) {
    console.error('judgeLog reset error:', err);
  }
};

const appendJudgeLog = async (sid, event, data = {}) => {
  try {
    ensureDir();
    await fs.promises.appendFile(logPath(sid), buildLine({ event, data }), 'utf8');
  } catch (err) {
    console.error('judgeLog append error:', err);
  }
};

const readJudgeLog = async (sid) => {
  try {
    ensureDir();
    return await fs.promises.readFile(logPath(sid), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return '';
    throw err;
  }
};

const readJudgeLogEntries = async (sid, limit = 200) => {
  const raw = await readJudgeLog(sid);
  if (!raw) return [];
  const lines = raw.split('\n').filter((l) => l.trim().length);
  const entries = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      entries.push({
        ts: entry.ts || '',
        event: entry.event || 'log',
        meta: entry.meta || null,
        data: entry.data || null,
      });
    } catch (_err) {
      entries.push({ ts: '', event: 'raw', meta: null, data: { line } });
    }
  }
  if (entries.length > limit) return entries.slice(entries.length - limit);
  return entries;
};

const truncateText = (value, max = MAX_FIELD) => {
  if (value == null) return value;
  const text = String(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...<truncated ${text.length - max} chars>`;
};

const summarizeSandboxResult = (result) => {
  if (!result || typeof result !== 'object') return result;
  const out = { ...result };
  for (const key of ['outputFiles', 'files']) {
    if (!out[key] || typeof out[key] !== 'object') continue;
    const files = {};
    for (const [name, value] of Object.entries(out[key])) {
      files[name] = typeof value === 'string' ? truncateText(value) : value;
    }
    out[key] = files;
  }
  if (typeof out.message === 'string') out.message = truncateText(out.message);
  return out;
};

const summarizeAxiosError = (err) => {
  if (!err) return null;
  const info = { message: err.message, code: err.code };
  if (err.response) {
    info.status = err.response.status;
    info.data = typeof err.response.data === 'string'
      ? truncateText(err.response.data)
      : err.response.data;
  }
  if (err.config) {
    info.url = err.config.url;
    info.method = err.config.method;
  }
  return info;
};

module.exports = {
  resetJudgeLog,
  appendJudgeLog,
  readJudgeLogEntries,
  truncateText,
  summarizeSandboxResult,
  summarizeAxiosError,
};
