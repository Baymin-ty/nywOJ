-- =============================================================================
-- 比赛系统 V2 迁移（赛制引擎 M1）：
--   1) contest.format (VARCHAR(16))  —— 赛制：oi/ioi/acm/cf/homework。
--      由旧 type 回填：0→'oi'，1→'ioi'。旧 type 列保留（兼容期继续镜像写入）。
--   2) contest.config (LONGTEXT NULL) —— 声明式赛制配置(JSON)；NULL=纯 preset 默认。
--   3) contest.phase (TINYINT) —— CF 用：0 正常 / 1 systest 进行中 / 2 已 finalize。
--   4) submission.judgeScope (VARCHAR(8) NULL) —— NULL=全量评测 / 'pretest'。
--   5) contestPlayer.teamId (INT NULL) —— 组队参赛时指向 contestTeam。
--   6) 新表 contestTeam / contestTeamMember / contestHack / contestFinalStandings。
-- 幂等：列/表已存在时跳过，可安全重复执行。
-- 运行时同样由 server/api/contest/schema.js#ensureContestV2Schema 保证。
-- =============================================================================

-- ---- 1) contest.format ----
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contest' AND COLUMN_NAME = 'format'
);
SET @add_sql := IF(@col_exists = 0,
  'ALTER TABLE contest ADD COLUMN format VARCHAR(16) NULL',
  'SELECT ''contest.format already exists, skip'' AS msg'
);
PREPARE stmt FROM @add_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE contest SET format = IF(type = 1, 'ioi', 'oi') WHERE format IS NULL;

-- ---- 2) contest.config ----
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contest' AND COLUMN_NAME = 'config'
);
SET @add_sql := IF(@col_exists = 0,
  'ALTER TABLE contest ADD COLUMN config LONGTEXT NULL',
  'SELECT ''contest.config already exists, skip'' AS msg'
);
PREPARE stmt FROM @add_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- 3) contest.phase ----
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contest' AND COLUMN_NAME = 'phase'
);
SET @add_sql := IF(@col_exists = 0,
  'ALTER TABLE contest ADD COLUMN phase TINYINT NOT NULL DEFAULT 0',
  'SELECT ''contest.phase already exists, skip'' AS msg'
);
PREPARE stmt FROM @add_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- 4) submission.judgeScope ----
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'submission' AND COLUMN_NAME = 'judgeScope'
);
SET @add_sql := IF(@col_exists = 0,
  'ALTER TABLE submission ADD COLUMN judgeScope VARCHAR(8) NULL',
  'SELECT ''submission.judgeScope already exists, skip'' AS msg'
);
PREPARE stmt FROM @add_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- 5) contestPlayer.teamId ----
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contestPlayer' AND COLUMN_NAME = 'teamId'
);
SET @add_sql := IF(@col_exists = 0,
  'ALTER TABLE contestPlayer ADD COLUMN teamId INT NULL',
  'SELECT ''contestPlayer.teamId already exists, skip'' AS msg'
);
PREPARE stmt FROM @add_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- 6) 新表 ----
CREATE TABLE IF NOT EXISTS contestTeam (
  teamId     INT AUTO_INCREMENT PRIMARY KEY,
  cid        INT NOT NULL,
  name       VARCHAR(60) NOT NULL,
  inviteCode VARCHAR(16) NOT NULL,
  createTime DATETIME NOT NULL,
  KEY idx_cid (cid),
  UNIQUE KEY uniq_cid_name (cid, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contestTeamMember (
  teamId    INT NOT NULL,
  uid       INT NOT NULL,
  isCaptain TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (teamId, uid),
  KEY idx_uid (uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contestHack (
  hackId     INT AUTO_INCREMENT PRIMARY KEY,
  cid        INT NOT NULL,
  pid        INT NOT NULL,
  idx        INT NOT NULL,
  hackerUid  INT NOT NULL,
  targetSid  INT NOT NULL,
  targetUid  INT NOT NULL,
  inputFile  VARCHAR(255) NOT NULL,
  status     VARCHAR(12) NOT NULL DEFAULT 'pending', -- pending/judging/success/fail/invalid
  verdict    TEXT NULL,
  createTime DATETIME NOT NULL,
  judgedTime DATETIME NULL,
  KEY idx_cid (cid),
  KEY idx_cid_pid (cid, pid),
  KEY idx_target (targetSid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contestFinalStandings (
  cid            INT NOT NULL,
  participantKey VARCHAR(24) NOT NULL, -- 'u<uid>' | 't<teamId>'
  rank           INT NOT NULL,
  payload        LONGTEXT NOT NULL,    -- 榜单行完整 JSON（分数/罚时/明细/rating 变化）
  PRIMARY KEY (cid, participantKey),
  KEY idx_cid_rank (cid, rank)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
