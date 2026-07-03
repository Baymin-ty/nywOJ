const db = require('../../db');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { handler, fail, ok } = require('../../db/util');
const { ip2loc, recordEvent } = require('../../static');

const FORMAT = 'nywoj.migration.v1';
const NAME_REGEX = /^[A-Za-z0-9\-_.#$]{3,24}$/;

const GROUPS = {
  users: ['userInfo'],
  problems: ['problem', 'problemSample', 'problemTag'],
  submissions: ['submission', 'submissionFile', 'submissionDetail'],
  discussions: ['discussion', 'discussionReply', 'discussionReaction', 'discussionReplyReaction'],
};

const TABLE_ORDER = [
  'userInfo',
  'problemTag',
  'problem',
  'problemSample',
  'submission',
  'submissionFile',
  'submissionDetail',
  'discussion',
  'discussionReply',
  'discussionReaction',
  'discussionReplyReaction',
];

const TABLE_SET = new Set(TABLE_ORDER);

const quoteId = (name) => '`' + String(name).replace(/`/g, '``') + '`';

let userMigrationSchemaReady = null;

const ensureUserMigrationSchema = () => {
  if (!userMigrationSchemaReady) {
    userMigrationSchemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS user_migration_info (
        userId INT NOT NULL PRIMARY KEY,
        oldUsername VARCHAR(80) NOT NULL,
        oldEmail VARCHAR(120) NOT NULL DEFAULT '',
        oldPasswordHashBcrypt CHAR(60) NOT NULL,
        usernameMustChange TINYINT NOT NULL DEFAULT 0,
        migrated TINYINT NOT NULL DEFAULT 0,
        UNIQUE KEY idx_old_username (oldUsername),
        KEY idx_old_email (oldEmail),
        KEY idx_migrated (migrated)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
  return userMigrationSchemaReady;
};

const hashOldPassword = (oldPassword) =>
  crypto.createHash('md5').update(`${oldPassword || ''}syzoj2_xxx`).digest('hex').toLowerCase();

const findUserMigrationInfo = async ({ oldUsername, email }) => {
  await ensureUserMigrationSchema();
  const username = String(oldUsername || '').trim();
  const mail = String(email || '').trim();
  if (username) return db.one('SELECT * FROM user_migration_info WHERE oldUsername=? LIMIT 1', [username]);
  if (!mail) return null;
  const user = await db.one('SELECT uid FROM userInfo WHERE email=? LIMIT 1', [mail]);
  if (user) {
    const row = await db.one('SELECT * FROM user_migration_info WHERE userId=? LIMIT 1', [user.uid]);
    if (row) return row;
  }
  return db.one('SELECT * FROM user_migration_info WHERE oldEmail=? LIMIT 1', [mail]);
};

const isUsernameAvailable = async (name, currentUid) => {
  const username = String(name || '').trim();
  if (!NAME_REGEX.test(username)) return false;
  return !(await db.exists('SELECT uid FROM userInfo WHERE name=? AND uid<>?', [username, currentUid || 0]));
};

const startMigratedSession = async (req, user) => {
  req.session.uid = user.uid;
  req.session.name = user.name;
  req.session.email = user.email;
  const now = new Date();
  await db.query('UPDATE userInfo SET login_time=? WHERE uid=?', [now, user.uid]);
  await db.query(
    'INSERT INTO userSession(uid,token,browser,os,loginIp,loginLoc,time,lastact) values (?,?,?,?,?,?,?,?)',
    [
      user.uid,
      req.sessionID,
      `${req.useragent?.browser?.name || 'unknown'} ${req.useragent?.browser?.version || ''}`.trim(),
      `${req.useragent?.os?.name || 'unknown'} ${req.useragent?.os?.version || ''}`.trim(),
      req.session.ip || req.ip || '',
      ip2loc(req.session.ip || req.ip || ''),
      now,
      now,
    ]
  );
  recordEvent(req, 'migration.migrate', null, user.uid);
};

const ensureOptionalTables = async () => {
  const userTable = await db.one(
    'SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?',
    ['userInfo']
  );
  if (userTable && Number(userTable.cnt) > 0) {
    for (const column of [
      { name: 'acceptedProblemCount', ddl: 'INT NOT NULL DEFAULT 0' },
      { name: 'rating', ddl: 'INT NOT NULL DEFAULT 0' },
      { name: 'nickname', ddl: "VARCHAR(24) NOT NULL DEFAULT ''" },
      { name: 'bio', ddl: "VARCHAR(160) NOT NULL DEFAULT ''" },
      { name: 'publicEmail', ddl: 'TINYINT NOT NULL DEFAULT 0' },
      { name: 'avatarInfo', ddl: "VARCHAR(128) NOT NULL DEFAULT ''" },
      { name: 'organization', ddl: "VARCHAR(80) NOT NULL DEFAULT ''" },
      { name: 'location', ddl: "VARCHAR(80) NOT NULL DEFAULT ''" },
      { name: 'homepageUrl', ddl: "VARCHAR(80) NOT NULL DEFAULT ''" },
      { name: 'telegram', ddl: "VARCHAR(30) NOT NULL DEFAULT ''" },
      { name: 'github', ddl: "VARCHAR(30) NOT NULL DEFAULT ''" },
    ]) {
      const row = await db.one(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='userInfo' AND COLUMN_NAME=?`,
        [column.name]
      );
      if (!row || !row.cnt) {
        await db.query(`ALTER TABLE userInfo ADD COLUMN ${column.name} ${column.ddl}`);
      }
    }
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS problemTag (
      id INT NOT NULL AUTO_INCREMENT,
      color VARCHAR(20) NOT NULL DEFAULT '#909399',
      locales TEXT NOT NULL,
      createTime DATETIME NOT NULL,
      updateTime DATETIME NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS problemSample (
      pid INT NOT NULL,
      samples MEDIUMTEXT NOT NULL,
      updateTime DATETIME NOT NULL,
      PRIMARY KEY (pid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
};

const requireMigrationAdmin = (req, res) => {
  if (!req.can('user.role.admin')) {
    res.status(403).end('403 Forbidden');
    return false;
  }
  return true;
};

const tableExists = async (table) => {
  const row = await db.one(
    'SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?',
    [table]
  );
  return !!(row && Number(row.cnt) > 0);
};

const describeTable = async (table) => {
  if (!(await tableExists(table))) return null;
  const columns = await db.query(`SHOW COLUMNS FROM ${quoteId(table)}`);
  const primary = columns.filter((c) => c.Key === 'PRI').map((c) => c.Field);
  return { columns: columns.map((c) => c.Field), primary };
};

const resolveTables = (include) => {
  const raw = Array.isArray(include) && include.length ? include : ['users', 'problems', 'submissions', 'discussions'];
  const out = new Set();
  for (const item of raw) {
    if (item === 'all') {
      TABLE_ORDER.forEach((table) => out.add(table));
    } else if (GROUPS[item]) {
      GROUPS[item].forEach((table) => out.add(table));
    } else if (TABLE_SET.has(item)) {
      out.add(item);
    }
  }
  return TABLE_ORDER.filter((table) => out.has(table));
};

const normalizePayload = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.format && payload.format !== FORMAT) return null;
  if (!payload.tables || typeof payload.tables !== 'object') return null;
  return payload;
};

const tableRowsFromPayload = (payload, table) => {
  const entry = payload.tables[table];
  if (!entry) return [];
  if (Array.isArray(entry)) return entry;
  if (Array.isArray(entry.rows)) return entry.rows;
  return [];
};

const summarizePayload = async (payload) => {
  const summary = [];
  for (const table of TABLE_ORDER) {
    const rows = tableRowsFromPayload(payload, table);
    if (!rows.length) continue;
    const desc = await describeTable(table);
    const payloadColumns = new Set();
    for (const row of rows) {
      if (row && typeof row === 'object') {
        Object.keys(row).forEach((key) => payloadColumns.add(key));
      }
    }
    const known = desc ? [...payloadColumns].filter((col) => desc.columns.includes(col)) : [];
    const ignored = desc ? [...payloadColumns].filter((col) => !desc.columns.includes(col)) : [...payloadColumns];
    summary.push({
      table,
      exists: !!desc,
      rows: rows.length,
      columns: known,
      ignoredColumns: ignored,
    });
  }
  return summary;
};

const upsertRows = async (tx, table, rows, desc) => {
  let count = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const cols = Object.keys(row).filter((col) => desc.columns.includes(col));
    if (!cols.length) continue;
    const updates = cols
      .filter((col) => !desc.primary.includes(col))
      .map((col) => `${quoteId(col)}=VALUES(${quoteId(col)})`);
    const fallback = `${quoteId(cols[0])}=${quoteId(cols[0])}`;
    const sql = `INSERT INTO ${quoteId(table)} (${cols.map(quoteId).join(',')}) ` +
      `VALUES (${cols.map(() => '?').join(',')}) ON DUPLICATE KEY UPDATE ${updates.join(',') || fallback}`;
    await tx.query(sql, cols.map((col) => row[col]));
    count++;
  }
  return count;
};

exports.queryUserMigrationInfo = handler(async (req, res) => {
  if (req.session.uid) return ok(res, { error: 'ALREADY_LOGGEDIN' });
  const info = await findUserMigrationInfo(req.body || {});
  if (!info) return ok(res, { error: 'NO_SUCH_USER' });
  if (info.migrated) return ok(res, { migrated: true });
  return ok(res, {
    migrated: false,
    usernameMustChange: !!info.usernameMustChange,
  });
});

exports.migrateUser = handler(async (req, res) => {
  if (req.session.uid) return ok(res, { error: 'ALREADY_LOGGEDIN' });
  const info = await findUserMigrationInfo(req.body || {});
  if (!info) return ok(res, { error: 'NO_SUCH_USER' });
  if (info.migrated) return ok(res, { error: 'ALREADY_MIGRATED' });
  const oldPassword = String(req.body.oldPassword || '');
  if (!bcrypt.compareSync(hashOldPassword(oldPassword), info.oldPasswordHashBcrypt)) {
    return ok(res, { error: 'WRONG_PASSWORD' });
  }

  const user = await db.one('SELECT uid,name,email FROM userInfo WHERE uid=? LIMIT 1', [info.userId]);
  if (!user) return ok(res, { error: 'NO_SUCH_USER' });
  const newUsername = String(req.body.newUsername || '').trim();
  if (info.usernameMustChange && !(await isUsernameAvailable(newUsername, user.uid))) {
    return ok(res, { error: 'DUPLICATE_USERNAME' });
  }
  const newPassword = String(req.body.newPassword || '');
  const hashed = bcrypt.hashSync(newPassword, 12);

  await db.tx(async (tx) => {
    if (info.usernameMustChange) {
      await tx.query('UPDATE userInfo SET name=?,pwd=? WHERE uid=?', [newUsername, hashed, user.uid]);
      user.name = newUsername;
    } else {
      await tx.query('UPDATE userInfo SET pwd=? WHERE uid=?', [hashed, user.uid]);
    }
    await tx.query('UPDATE user_migration_info SET migrated=1 WHERE userId=?', [user.uid]);
  });
  await startMigratedSession(req, user);
  return ok(res, { token: req.sessionID });
});

exports.exportMigration = handler(async (req, res) => {
  if (!requireMigrationAdmin(req, res)) return;
  await ensureOptionalTables();
  const tables = resolveTables(req.body.include);
  const out = {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    source: 'nywOJ',
    tables: {},
  };
  const counts = {};
  for (const table of tables) {
    const desc = await describeTable(table);
    if (!desc) continue;
    const rows = await db.query(`SELECT * FROM ${quoteId(table)}`);
    out.tables[table] = { columns: desc.columns, primary: desc.primary, rows };
    counts[table] = rows.length;
  }
  recordEvent(req, 'migration.export', { tables: counts });
  return ok(res, { data: out, summary: counts });
});

exports.importMigration = handler(async (req, res) => {
  if (!requireMigrationAdmin(req, res)) return;
  await ensureOptionalTables();
  const payload = normalizePayload(req.body.payload);
  if (!payload) return fail(res, '迁移文件格式无效');
  const dryRun = req.body.dryRun !== false;
  const summary = await summarizePayload(payload);
  if (dryRun) return ok(res, { dryRun: true, summary });

  const imported = {};
  await db.tx(async (tx) => {
    for (const table of TABLE_ORDER) {
      const rows = tableRowsFromPayload(payload, table);
      if (!rows.length) continue;
      const desc = await describeTable(table);
      if (!desc) continue;
      imported[table] = await upsertRows(tx, table, rows, desc);
    }
  });
  recordEvent(req, 'migration.import', { tables: imported });
  return ok(res, { dryRun: false, summary, imported });
});
