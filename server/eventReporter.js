const axios = require('axios');
const crypto = require('crypto');
const config = require('./config.json');

const DEFAULT_TELEGRAM_API_ROOT = 'https://api.telegram.org';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_DEDUPE_WINDOW_MS = 60000;
const MAX_MESSAGE_BYTES = 3600;
const MAX_DOCUMENT_BYTES = 256 * 1024;
const SECRET_KEY_RE = /(authorization|captcha|client[_-]?key|cookie|pass(word)?|pwd|secret|token|verify|code)/i;

const recentReports = new Map();

const escapeTelegramHtml = (text) => String(text || '')
  .split('&').join('&amp;')
  .split('<').join('&lt;')
  .split('>').join('&gt;');

const boolConfig = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  }
  return Boolean(value);
};

const intConfig = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readConfig = () => {
  const lower = config.eventReport || {};
  const upper = config.EVENT_REPORT || {};
  const merged = { ...lower, ...upper };
  const telegramBotToken = merged.telegramBotToken || merged.TELEGRAM_BOT_TOKEN || '';
  const sentTo = merged.sentTo || merged.chatId || merged.SENT_TO || '';
  const enabled = boolConfig(merged.enabled, telegramBotToken && sentTo ? true : false);

  return {
    enabled,
    siteName: merged.siteName || merged.SITE_NAME ||
      (config.preference && config.preference.siteName) ||
      config.SITE_NAME ||
      'nywOJ',
    telegramBotToken,
    sentTo,
    telegramApiRoot: merged.telegramApiRoot || merged.TELEGRAM_API_ROOT || DEFAULT_TELEGRAM_API_ROOT,
    proxyUrl: merged.proxyUrl || merged.PROXY_URL || '',
    timeout: intConfig(merged.timeout || merged.TIMEOUT, DEFAULT_TIMEOUT_MS),
    dedupeWindowMs: intConfig(merged.dedupeWindowMs, DEFAULT_DEDUPE_WINDOW_MS),
    maxDocumentBytes: intConfig(merged.maxDocumentBytes, MAX_DOCUMENT_BYTES),
  };
};

const isEnabled = (cfg = readConfig()) => !!(cfg.enabled && cfg.telegramBotToken && cfg.sentTo);

const truncateByBytes = (value, maxBytes) => {
  const text = String(value == null ? '' : value);
  const buf = Buffer.from(text);
  if (buf.length <= maxBytes) return text;
  const suffix = `\n... truncated, original ${buf.length} bytes ...`;
  return Buffer.concat([
    buf.subarray(0, Math.max(0, maxBytes - Buffer.byteLength(suffix))),
    Buffer.from(suffix),
  ]).toString();
};

const sanitizeValue = (value, key = '', seen = new WeakSet(), depth = 0) => {
  if (SECRET_KEY_RE.test(key)) return '[redacted]';
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) return `[buffer ${value.length} bytes]`;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  if (depth >= 6) return '[truncated]';

  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, key, seen, depth + 1));
  }

  const result = {};
  for (const prop of Object.keys(value).slice(0, 100)) {
    result[prop] = sanitizeValue(value[prop], prop, seen, depth + 1);
  }
  return result;
};

const stringifySafe = (value, maxBytes = MAX_DOCUMENT_BYTES) => {
  try {
    return truncateByBytes(JSON.stringify(sanitizeValue(value), null, 2), maxBytes);
  } catch (err) {
    return truncateByBytes(String(value), maxBytes);
  }
};

const errorToText = (error) => {
  if (!error) return '';
  if (error.stack) return error.stack;
  if (error.message) return `Error: ${error.message}`;
  if (typeof error === 'object') return stringifySafe(error, MAX_MESSAGE_BYTES);
  return String(error);
};

const requestIp = (req) => {
  if (!req) return '';
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  return (req.session && req.session.ip) ||
    (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) ||
    (req.headers && req.headers['x-real-ip']) ||
    req.ip ||
    (req.socket && req.socket.remoteAddress) ||
    '';
};

const requestUser = (req) => {
  if (!req || !req.session || !req.session.uid) return '';
  return `#${req.session.uid}${req.session.name ? ` ${req.session.name}` : ''}`;
};

const collectRequest = (req, cfg) => {
  if (!req) return { lines: [], body: '' };
  const lines = [];
  const method = req.method || '';
  const url = req.originalUrl || req.url || '';
  if (method || url) lines.push(`Request: ${method} ${url}`.trim());
  const ip = requestIp(req);
  if (ip) lines.push(`ClientIP: ${ip}`);
  const user = requestUser(req);
  if (user) lines.push(`User: ${user}`);
  const userAgent = req.headers && req.headers['user-agent'];
  if (userAgent) lines.push(`User-Agent: ${truncateByBytes(userAgent, 300)}`);

  let body = '';
  if (req.body && !(typeof req.body === 'object' && !Object.keys(req.body).length)) {
    body = typeof req.body === 'string'
      ? truncateByBytes(req.body, cfg.maxDocumentBytes)
      : stringifySafe(req.body, cfg.maxDocumentBytes);
  }
  return { lines, body };
};

const eventId = () => crypto.randomInt(10000000, 99999999).toString();

const nowText = () => {
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
};

const fingerprint = ({ type, error, message, req }) => crypto
  .createHash('sha1')
  .update([
    type,
    message || '',
    error && (error.stack || error.message || String(error)),
    req && (req.method || ''),
    req && (req.originalUrl || req.url || ''),
  ].join('\n'))
  .digest('hex');

const shouldSuppress = (fp, windowMs) => {
  const now = Date.now();
  for (const [key, time] of recentReports.entries()) {
    if (now - time > windowMs) recentReports.delete(key);
  }
  const last = recentReports.get(fp);
  if (last && now - last < windowMs) return true;
  recentReports.set(fp, now);
  return false;
};

const axiosOptions = (cfg) => {
  const options = { timeout: cfg.timeout };
  if (!cfg.proxyUrl) return options;

  try {
    const url = new URL(cfg.proxyUrl);
    options.proxy = {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname,
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    };
    if (url.username || url.password) {
      options.proxy.auth = {
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      };
    }
  } catch (err) {
    console.error('event report proxy config invalid:', err && err.message ? err.message : err);
  }
  return options;
};

const telegramUrl = (cfg, method) => {
  const root = String(cfg.telegramApiRoot || DEFAULT_TELEGRAM_API_ROOT).replace(/\/+$/, '');
  return `${root}/bot${cfg.telegramBotToken}/${method}`;
};

const sendDocument = async (cfg, filename, fileContent) => {
  if (!fileContent || typeof FormData !== 'function' || typeof Blob !== 'function') return;
  const form = new FormData();
  form.append('chat_id', cfg.sentTo);
  form.append('document', new Blob([fileContent], { type: 'application/json' }), filename);
  await axios.post(telegramUrl(cfg, 'sendDocument'), form, axiosOptions(cfg));
};

const buildPayload = ({ type = 'Error', error, req, request, message, extra }, cfg) => {
  const id = eventId();
  const actualReq = req || request;
  const requestInfo = collectRequest(actualReq, cfg);
  const lines = [
    `[${cfg.siteName}] Event #${id} (${type}) at ${nowText()}`,
    ...requestInfo.lines,
  ];
  if (message) lines.push('', String(message));
  if (extra !== undefined) lines.push('', stringifySafe(extra, MAX_MESSAGE_BYTES));
  const errorText = errorToText(error);
  if (errorText) lines.push('', errorText);

  return {
    text: truncateByBytes(lines.join('\n'), MAX_MESSAGE_BYTES),
    filename: requestInfo.body ? `RequestBody_${id}.json` : '',
    fileContent: requestInfo.body,
  };
};

const report = async (event) => {
  const cfg = readConfig();
  if (!isEnabled(cfg)) return false;

  const normalized = { ...event, type: event && event.type ? event.type : 'Error' };
  if (shouldSuppress(fingerprint(normalized), cfg.dedupeWindowMs)) return false;

  try {
    const payload = buildPayload(normalized, cfg);
    await axios.post(telegramUrl(cfg, 'sendMessage'), {
      chat_id: cfg.sentTo,
      text: `<pre>${escapeTelegramHtml(payload.text.trim())}</pre>`,
      parse_mode: 'HTML',
    }, axiosOptions(cfg));
    await sendDocument(cfg, payload.filename, payload.fileContent);
    return true;
  } catch (err) {
    console.error('event report failed:', err && err.message ? err.message : err);
    return false;
  }
};

const reportError = (error, req, message, extra) => report({
  type: 'Error',
  error,
  req,
  message,
  extra,
});

module.exports = {
  escapeTelegramHtml,
  isEnabled,
  readConfig,
  report,
  reportError,
};
