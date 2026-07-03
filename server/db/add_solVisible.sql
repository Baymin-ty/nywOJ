-- =============================================================================
-- 为 problem 表新增 solVisible 列：题解可见性模式
--   0 = 任何有 view 权限的用户都能查看题解（默认，保持历史行为）
--   1 = 仅通过本题的用户可查看（管理者 / submission.view.any 不受限）
-- 幂等：列已存在时跳过。可安全重复执行。
-- =============================================================================
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'problem'
     AND COLUMN_NAME = 'solVisible'
);
SET @add_sql := IF(@col_exists = 0,
  'ALTER TABLE problem ADD COLUMN solVisible TINYINT NOT NULL DEFAULT 0',
  'SELECT ''problem.solVisible already exists, skip'' AS msg'
);
PREPARE stmt FROM @add_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
