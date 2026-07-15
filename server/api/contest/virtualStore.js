// 虚拟参赛数据访问 + 运行时建表。policy.js / virtual.js / standings.js 共用。
const db = require('../../db');

let ready = null;
const ensureSchema = () => {
  if (!ready) {
    ready = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS contestVirtual (
          vid        INT AUTO_INCREMENT PRIMARY KEY,
          cid        INT NOT NULL,
          uid        INT NOT NULL,
          startAt    DATETIME NOT NULL,
          finishedAt DATETIME NULL,
          UNIQUE KEY uq_cid_uid (cid, uid),
          KEY idx_uid (uid)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
      `);
      // submission.virtualId（幂等）
      const col = await db.one(
        "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='submission' AND COLUMN_NAME='virtualId'"
      );
      if (!col.c) await db.query('ALTER TABLE submission ADD COLUMN virtualId INT NULL');
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
};

// 当前有效 VP 会话（未完成），不判断是否超时（由 policy 用时长判断）。
const activeVirtual = async (uid, cid) => {
  if (!uid || !cid) return null;
  await ensureSchema();
  return db.one(
    'SELECT vid,cid,uid,startAt,finishedAt FROM contestVirtual WHERE cid=? AND uid=? AND finishedAt IS NULL',
    [cid, uid]
  );
};

const getVirtual = async (uid, cid) => {
  await ensureSchema();
  return db.one('SELECT vid,cid,uid,startAt,finishedAt FROM contestVirtual WHERE cid=? AND uid=?', [cid, uid]);
};

module.exports = { ensureSchema, activeVirtual, getVirtual };
