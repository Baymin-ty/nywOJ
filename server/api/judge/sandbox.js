const axios = require('axios');
const conf = require('../../config.json');

const trimRightSlash = (s) => String(s || '').replace(/\/+$/, '');

const cfg = conf.SANDBOX || {};
const baseUrl = trimRightSlash(
  process.env.NYWOJ_SANDBOX_URL ||
  cfg.url ||
  cfg.httpUrl ||
  'http://127.0.0.1:5050',
);

const streamUrl =
  process.env.NYWOJ_SANDBOX_STREAM_URL ||
  cfg.streamUrl ||
  cfg.wsUrl ||
  `${baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')}/api/stream`;

const run = (commands, extra = {}, options = {}) =>
  axios.post(`${baseUrl}/api/run`, {
    commands: Array.isArray(commands) ? commands : [commands],
    ...extra,
  }, options).then((r) => r.data);

const runOne = (command, options = {}) => run([command], {}, options).then((rows) => rows[0]);

const deleteFile = (cachedFile) =>
  axios.delete(`${baseUrl}/api/file/${cachedFile}`).catch(() => { /* best effort */ });

const fileExists = (cachedFile) =>
  axios.get(`${baseUrl}/api/file/${encodeURIComponent(cachedFile)}`, {
    responseType: 'stream',
    validateStatus: (status) => status === 200 || status === 404,
  }).then((r) => {
    if (r.data && typeof r.data.destroy === 'function') r.data.destroy();
    return r.status === 200;
  }).catch(() => false);

const version = (options = {}) =>
  axios.get(`${baseUrl}/api/version`, options).then((r) => r.data);

module.exports = {
  baseUrl,
  streamUrl,
  run,
  runOne,
  deleteFile,
  fileExists,
  version,
};
