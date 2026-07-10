const crypto = require('crypto');
const db = require('../../db');
const { Format } = require('../../static');

let schemaReady = null;

const ensureSchema = () => {
  if (!schemaReady) {
    schemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS judgeClient (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        endpoint VARCHAR(255) NULL,
        allowedHosts TEXT NULL,
        clientKey VARCHAR(80) NOT NULL,
        enabled TINYINT NOT NULL DEFAULT 1,
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL,
        lastSeenAt DATETIME NULL,
        lastTaskAt DATETIME NULL,
        lastTaskSid INT NULL,
        lastStatus VARCHAR(32) NOT NULL DEFAULT 'new',
        lastMessage VARCHAR(255) NULL,
        queueWaiting INT NULL,
        queueRunning INT NULL,
        queueConcurrency INT NULL,
        UNIQUE KEY idx_name (name),
        UNIQUE KEY idx_client_key (clientKey),
        KEY idx_enabled (enabled),
        KEY idx_last_seen (lastSeenAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    const ready = schemaReady;
    schemaReady = ready.then(async () => {
      const columns = await db.query(
        `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='judgeClient'
            AND COLUMN_NAME IN ('allowedHosts')`
      );
      const names = new Set(columns.map((row) => row.name));
      if (!names.has('allowedHosts')) await db.query('ALTER TABLE judgeClient ADD COLUMN allowedHosts TEXT NULL AFTER endpoint');
    });
  }
  return schemaReady;
};

const makeClientKey = () =>
  crypto.randomBytes(30).toString('base64');

const maskKey = (key) => {
  if (!key) return '';
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
};

const normalizeAllowedHosts = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizeAllowedHosts(parsed);
    } catch (_) {
      const single = value.trim();
      return single ? [single] : [];
    }
  }
  return [];
};

const normalizeQueue = (queue) => ({
  waiting: Number(queue && queue.waiting) || 0,
  running: Number(queue && queue.running) || 0,
  concurrency: Number(queue && queue.concurrency) || 0,
});

const formatClient = (row, includeKey = false) => {
  if (!row) return null;
  const allowedHosts = normalizeAllowedHosts(row.allowedHosts);
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint || '',
    allowedHosts: allowedHosts.length ? allowedHosts : (row.endpoint ? [row.endpoint] : []),
    enabled: !!row.enabled,
    clientKey: includeKey ? row.clientKey : undefined,
    maskedKey: maskKey(row.clientKey),
    createdAt: row.createdAt ? Format(row.createdAt) : '',
    updatedAt: row.updatedAt ? Format(row.updatedAt) : '',
    lastSeenAt: row.lastSeenAt ? Format(row.lastSeenAt) : '',
    lastTaskAt: row.lastTaskAt ? Format(row.lastTaskAt) : '',
    lastTaskSid: row.lastTaskSid || '',
    lastStatus: row.lastStatus || 'new',
    lastMessage: row.lastMessage || '',
    queueWaiting: Number(row.queueWaiting || 0),
    queueRunning: Number(row.queueRunning || 0),
    queueConcurrency: Number(row.queueConcurrency || 0),
  };
};

exports.ensureSchema = ensureSchema;
exports.formatClient = formatClient;

exports.listClients = async () => {
  await ensureSchema();
  return db.query('SELECT * FROM judgeClient ORDER BY enabled DESC,lastSeenAt DESC,id DESC');
};

exports.getDispatchClients = async () => {
  await ensureSchema();
  return db.query(
    "SELECT * FROM judgeClient WHERE enabled=1 AND endpoint IS NOT NULL AND endpoint<>'' ORDER BY lastSeenAt DESC,id ASC"
  );
};

exports.getById = async (id) => {
  await ensureSchema();
  return db.one('SELECT * FROM judgeClient WHERE id=?', [id]);
};

exports.getByKey = async (clientKey) => {
  await ensureSchema();
  return db.one('SELECT * FROM judgeClient WHERE clientKey=?', [clientKey]);
};

exports.createClient = async ({ name, endpoint, allowedHosts }) => {
  await ensureSchema();
  const now = new Date();
  const clientKey = makeClientKey();
  const hosts = normalizeAllowedHosts(allowedHosts);
  const result = await db.query(
    'INSERT INTO judgeClient(name,endpoint,allowedHosts,clientKey,enabled,createdAt,updatedAt,lastStatus) VALUES (?,?,?,?,?,?,?,?)',
    [name, endpoint || null, JSON.stringify(hosts), clientKey, 1, now, now, 'new']
  );
  const client = await exports.getById(result.insertId);
  return { client, clientKey };
};

exports.updateClient = async (id, patch) => {
  await ensureSchema();
  const sets = ['updatedAt=?'];
  const params = [new Date()];
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    sets.push('name=?');
    params.push(patch.name);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'endpoint')) {
    sets.push('endpoint=?');
    params.push(patch.endpoint || null);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'allowedHosts')) {
    sets.push('allowedHosts=?');
    params.push(JSON.stringify(normalizeAllowedHosts(patch.allowedHosts)));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
    sets.push('enabled=?');
    params.push(patch.enabled ? 1 : 0);
  }
  params.push(id);
  const result = await db.query(`UPDATE judgeClient SET ${sets.join(',')} WHERE id=?`, params);
  if (!result.affectedRows) return null;
  return exports.getById(id);
};

exports.deleteClient = async (id) => {
  await ensureSchema();
  return db.query('DELETE FROM judgeClient WHERE id=?', [id]);
};

exports.resetClientKey = async (id) => {
  await ensureSchema();
  const clientKey = makeClientKey();
  const result = await db.query('UPDATE judgeClient SET clientKey=?,updatedAt=? WHERE id=?', [clientKey, new Date(), id]);
  if (!result.affectedRows) return null;
  const client = await exports.getById(id);
  return { client, clientKey };
};

exports.recordDispatch = async (id, { status, message, sid, queue }) => {
  await ensureSchema();
  const q = normalizeQueue(queue);
  return db.query(
    `UPDATE judgeClient
        SET lastSeenAt=?,lastTaskAt=?,lastTaskSid=?,lastStatus=?,lastMessage=?,
            queueWaiting=?,queueRunning=?,queueConcurrency=?
      WHERE id=?`,
    [
      new Date(),
      new Date(),
      sid || null,
      status,
      String(message || '').slice(0, 255),
      q.waiting,
      q.running,
      q.concurrency,
      id,
    ]
  );
};

exports.recordHeartbeat = async (id, { status, message, queue }) => {
  await ensureSchema();
  const q = normalizeQueue(queue);
  return db.query(
    `UPDATE judgeClient
        SET lastSeenAt=?,lastStatus=?,lastMessage=?,queueWaiting=?,queueRunning=?,queueConcurrency=?
      WHERE id=?`,
    [
      new Date(),
      status || 'online',
      String(message || '').slice(0, 255),
      q.waiting,
      q.running,
      q.concurrency,
      id,
    ]
  );
};
