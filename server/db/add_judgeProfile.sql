-- =============================================================================
-- 统一评测流水线 M1 迁移：
--   1) problem.judgeProfile (LONGTEXT NULL) —— 每题一份声明式评测档案(JSON)。
--      NULL = 未配置，worker 走 legacy(按 type) 分支，存量题零行为变化。
--   2) submissionFile —— 多文件提交的附加文件槽（主槽 main 仍镜像进 submission.code）。
-- 幂等：列/表已存在时跳过，可安全重复执行。
-- =============================================================================

-- ---- 1) problem.judgeProfile ----
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'problem'
     AND COLUMN_NAME = 'judgeProfile'
);
SET @add_sql := IF(@col_exists = 0,
  'ALTER TABLE problem ADD COLUMN judgeProfile LONGTEXT NULL',
  'SELECT ''problem.judgeProfile already exists, skip'' AS msg'
);
PREPARE stmt FROM @add_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---- 2) submissionFile ----
CREATE TABLE IF NOT EXISTS submissionFile (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  sid     INT NOT NULL,
  fileKey VARCHAR(64) NOT NULL,
  lang    INT NULL,           -- source 槽的语言 id；file 槽为 NULL
  content LONGTEXT NULL,      -- source 内容；超大 file 槽可改存路径
  KEY idx_sid (sid)
);
