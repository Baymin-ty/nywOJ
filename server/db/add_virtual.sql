-- =============================================================================
-- 虚拟参赛（Virtual Participation）。幂等。
--   contestVirtual：一人一场一次有效 VP 会话。
--   submission.virtualId：NULL = 正式提交；非 NULL = 某次 VP 的提交（对官方榜/评级/
--     题目统计不可见）。
-- 核心不变量：官方一切统计的 submission 查询都加 `AND virtualId IS NULL`。
-- =============================================================================
CREATE TABLE IF NOT EXISTS contestVirtual (
  vid        INT AUTO_INCREMENT PRIMARY KEY,
  cid        INT NOT NULL,
  uid        INT NOT NULL,
  startAt    DATETIME NOT NULL,
  finishedAt DATETIME NULL,
  UNIQUE KEY uq_cid_uid (cid, uid),
  KEY idx_uid (uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- submission.virtualId（幂等 ALTER）
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='submission' AND COLUMN_NAME='virtualId');
SET @sql := IF(@col=0,
  'ALTER TABLE submission ADD COLUMN virtualId INT NULL',
  'SELECT ''submission.virtualId exists, skip'' AS msg');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='submission' AND INDEX_NAME='idx_cid_virtual');
SET @sql := IF(@idx=0,
  'ALTER TABLE submission ADD INDEX idx_cid_virtual (cid, virtualId, submitTime)',
  'SELECT ''idx_cid_virtual exists, skip'' AS msg');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
