const db = require('../../db');

// Runtime twin of server/db/add_contestV2.sql — keeps deploys that don't run
// the SQL file working. Memoized like groupSchema.js#ensureGroupSchema.
let ready = null;

const columnExists = async (table, column) => {
  const row = await db.one(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [table, column]
  );
  return !!(row && row.cnt);
};

const addColumnIfMissing = async (table, column, ddl) => {
  if (!(await columnExists(table, column))) {
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
};

const ensureContestV2Schema = () => {
  if (!ready) {
    ready = (async () => {
      await addColumnIfMissing('contest', 'format', 'VARCHAR(16) NULL');
      await db.query("UPDATE contest SET format = IF(type = 1, 'ioi', 'oi') WHERE format IS NULL");
      await addColumnIfMissing('contest', 'config', 'LONGTEXT NULL');
      await addColumnIfMissing('contest', 'phase', 'TINYINT NOT NULL DEFAULT 0');
      await addColumnIfMissing('submission', 'judgeScope', 'VARCHAR(8) NULL');
      await addColumnIfMissing('contestPlayer', 'teamId', 'INT NULL');
      await db.query(`
        CREATE TABLE IF NOT EXISTS contestTeam (
          teamId     INT AUTO_INCREMENT PRIMARY KEY,
          cid        INT NOT NULL,
          name       VARCHAR(60) NOT NULL,
          inviteCode VARCHAR(16) NOT NULL,
          createTime DATETIME NOT NULL,
          KEY idx_cid (cid),
          UNIQUE KEY uniq_cid_name (cid, name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS contestTeamMember (
          teamId    INT NOT NULL,
          uid       INT NOT NULL,
          isCaptain TINYINT NOT NULL DEFAULT 0,
          PRIMARY KEY (teamId, uid),
          KEY idx_uid (uid)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS contestHack (
          hackId     INT AUTO_INCREMENT PRIMARY KEY,
          cid        INT NOT NULL,
          pid        INT NOT NULL,
          idx        INT NOT NULL,
          hackerUid  INT NOT NULL,
          targetSid  INT NOT NULL,
          targetUid  INT NOT NULL,
          inputFile  VARCHAR(255) NOT NULL,
          status     VARCHAR(12) NOT NULL DEFAULT 'pending',
          verdict    TEXT NULL,
          createTime DATETIME NOT NULL,
          judgedTime DATETIME NULL,
          KEY idx_cid (cid),
          KEY idx_cid_pid (cid, pid),
          KEY idx_target (targetSid)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS contestFinalStandings (
          cid            INT NOT NULL,
          participantKey VARCHAR(24) NOT NULL,
          rank           INT NOT NULL,
          payload        LONGTEXT NOT NULL,
          PRIMARY KEY (cid, participantKey),
          KEY idx_cid_rank (cid, rank)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })();
    ready.catch(() => { ready = null; }); // allow retry after transient DB errors
  }
  return ready;
};

module.exports = { ensureContestV2Schema };
