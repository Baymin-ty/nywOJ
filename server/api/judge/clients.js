const { handler, fail, ok } = require('../../db/util');
const judgeClients = require('./clientRegistry');
const judgeSocketBridge = require('./socketBridge');

const canManageJudgeClients = (req) => !!(req.can && req.can('user.role.admin'));
const ONLINE_STATUSES = new Set(['online', 'idle', 'progress', 'queued', 'ok']);
const ONLINE_HEARTBEAT_MAX_AGE_MS = 120000;

const normalizeName = (name) => String(name || '').trim();

const normalizeAllowedHosts = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20);
  const single = String(value || '').trim();
  return single ? [single] : [];
};

const normalizeEndpoint = (body) => {
  const allowedHosts = normalizeAllowedHosts(body.allowedHosts);
  const endpoint = String(body.endpoint || '').trim();
  return endpoint || allowedHosts[0] || '';
};

const parseId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const hasRecentOnlineHeartbeat = (row) => {
  if (!row || !row.enabled || !row.lastSeenAt || !ONLINE_STATUSES.has(row.lastStatus || '')) return false;
  const timestamp = new Date(row.lastSeenAt).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < ONLINE_HEARTBEAT_MAX_AGE_MS;
};

const activeSocketIds = () => new Set(judgeSocketBridge.onlineClients().map((client) => Number(client.id)));

const formatJudgeClient = (row, showSensitive = false, onlineIds = activeSocketIds()) => {
  const formatted = judgeClients.formatClient(row, showSensitive);
  return {
    id: Number(row.id),
    name: row.name || '',
    key: showSensitive ? row.clientKey : null,
    allowedHosts: showSensitive ? formatted.allowedHosts : null,
    online: onlineIds.has(Number(row.id)) || hasRecentOnlineHeartbeat(row),
    systemInfo: formatted.systemInfo || null,
  };
};

exports.addJudgeClient = handler(async (req, res) => {
  if (!canManageJudgeClients(req)) return ok(res, { error: 'PERMISSION_DENIED' });
  const name = normalizeName(req.body.name);
  if (!name || name.length > 80) return fail(res, '评测机名称长度需在 1 到 80 字之间');
  const allowedHosts = normalizeAllowedHosts(req.body.allowedHosts);
  const endpoint = normalizeEndpoint(req.body || {});
  try {
    const { client, clientKey } = await judgeClients.createClient({ name, endpoint, allowedHosts });
    const judgeClient = formatJudgeClient(client, true);
    if (clientKey) judgeClient.key = clientKey;
    return ok(res, { judgeClient });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return fail(res, '评测机名称已存在');
    throw err;
  }
});

exports.deleteJudgeClient = handler(async (req, res) => {
  if (!canManageJudgeClients(req)) return ok(res, { error: 'PERMISSION_DENIED' });
  const id = parseId(req.body.id);
  if (!id) return ok(res, { error: 'NO_SUCH_JUDGE_CLIENT' });
  const result = await judgeClients.deleteClient(id);
  if (!result.affectedRows) return ok(res, { error: 'NO_SUCH_JUDGE_CLIENT' });
  return ok(res);
});

exports.resetJudgeClientKey = handler(async (req, res) => {
  if (!canManageJudgeClients(req)) return ok(res, { error: 'PERMISSION_DENIED' });
  const id = parseId(req.body.id);
  if (!id) return ok(res, { error: 'NO_SUCH_JUDGE_CLIENT' });
  const result = await judgeClients.resetClientKey(id);
  if (!result) return ok(res, { error: 'NO_SUCH_JUDGE_CLIENT' });
  const judgeClient = formatJudgeClient(result.client, true);
  if (result.clientKey) judgeClient.key = result.clientKey;
  return ok(res, {
    key: result.clientKey,
    judgeClient,
  });
});

exports.listJudgeClients = handler(async (req, res) => {
  const showSensitive = canManageJudgeClients(req);
  const rows = await judgeClients.listClients();
  const onlineIds = activeSocketIds();
  return ok(res, {
    judgeClients: rows.map((row) => formatJudgeClient(row, showSensitive, onlineIds)),
    hasManagePermission: showSensitive,
  });
});
