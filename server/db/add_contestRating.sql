-- =============================================================================
-- 比赛 Rating 迁移：
--   1) userInfo.rating：用户当前 Rating，0 表示未参与过评级比赛。
--   2) contest.ratingEnabled：比赛是否参与 Rating。
--   3) contestRating：每场已结算比赛的 Rating 变更历史。
-- 幂等：列/表已存在时跳过，可安全重复执行。
-- =============================================================================

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'userInfo'
     AND COLUMN_NAME = 'rating'
);
SET @add_sql := IF(@col_exists = 0,
  'ALTER TABLE userInfo ADD COLUMN rating INT NOT NULL DEFAULT 0',
  'SELECT ''userInfo.rating already exists, skip'' AS msg'
);
PREPARE stmt FROM @add_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
UPDATE userInfo SET rating=0 WHERE rating IS NULL;
ALTER TABLE userInfo MODIFY rating INT NOT NULL DEFAULT 0;

SET @contest_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contest'
     AND COLUMN_NAME = 'ratingEnabled'
);
SET @contest_add_sql := IF(@contest_col_exists = 0,
  'ALTER TABLE contest ADD COLUMN ratingEnabled TINYINT NOT NULL DEFAULT 1',
  'SELECT ''contest.ratingEnabled already exists, skip'' AS msg'
);
PREPARE stmt FROM @contest_add_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
UPDATE contest SET ratingEnabled=1 WHERE ratingEnabled IS NULL;
ALTER TABLE contest MODIFY ratingEnabled TINYINT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS contestRating (
  cid INT NOT NULL,
  uid INT NOT NULL,
  rank INT NOT NULL,
  totalScore INT NOT NULL,
  usedTime INT NOT NULL,
  oldRating INT NOT NULL,
  newRating INT NOT NULL,
  delta INT NOT NULL,
  algorithm VARCHAR(40) NOT NULL DEFAULT 'elo-rank-v1',
  updateTime DATETIME NOT NULL,
  PRIMARY KEY (cid, uid),
  KEY idx_uid (uid),
  KEY idx_cid_rank (cid, rank)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @rating_key_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND COLUMN_NAME = 'cid'
);
SET @rating_key_sql := IF(@rating_key_col_exists = 0,
  'ALTER TABLE contestRating ADD COLUMN cid INT NULL FIRST',
  'SELECT ''contestRating.cid already exists, skip'' AS msg'
);
PREPARE stmt FROM @rating_key_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rating_key_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND COLUMN_NAME = 'uid'
);
SET @rating_key_sql := IF(@rating_key_col_exists = 0,
  'ALTER TABLE contestRating ADD COLUMN uid INT NULL AFTER cid',
  'SELECT ''contestRating.uid already exists, skip'' AS msg'
);
PREPARE stmt FROM @rating_key_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rating_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND COLUMN_NAME = 'rank'
);
SET @rating_col_sql := IF(@rating_col_exists = 0,
  'ALTER TABLE contestRating ADD COLUMN rank INT NOT NULL DEFAULT 0',
  'SELECT ''contestRating.rank already exists, skip'' AS msg'
);
PREPARE stmt FROM @rating_col_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rating_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND COLUMN_NAME = 'totalScore'
);
SET @rating_col_sql := IF(@rating_col_exists = 0,
  'ALTER TABLE contestRating ADD COLUMN totalScore INT NOT NULL DEFAULT 0',
  'SELECT ''contestRating.totalScore already exists, skip'' AS msg'
);
PREPARE stmt FROM @rating_col_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rating_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND COLUMN_NAME = 'usedTime'
);
SET @rating_col_sql := IF(@rating_col_exists = 0,
  'ALTER TABLE contestRating ADD COLUMN usedTime INT NOT NULL DEFAULT 0',
  'SELECT ''contestRating.usedTime already exists, skip'' AS msg'
);
PREPARE stmt FROM @rating_col_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rating_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND COLUMN_NAME = 'oldRating'
);
SET @rating_col_sql := IF(@rating_col_exists = 0,
  'ALTER TABLE contestRating ADD COLUMN oldRating INT NOT NULL DEFAULT 0',
  'SELECT ''contestRating.oldRating already exists, skip'' AS msg'
);
PREPARE stmt FROM @rating_col_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rating_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND COLUMN_NAME = 'newRating'
);
SET @rating_col_sql := IF(@rating_col_exists = 0,
  'ALTER TABLE contestRating ADD COLUMN newRating INT NOT NULL DEFAULT 0',
  'SELECT ''contestRating.newRating already exists, skip'' AS msg'
);
PREPARE stmt FROM @rating_col_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rating_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND COLUMN_NAME = 'delta'
);
SET @rating_col_sql := IF(@rating_col_exists = 0,
  'ALTER TABLE contestRating ADD COLUMN delta INT NOT NULL DEFAULT 0',
  'SELECT ''contestRating.delta already exists, skip'' AS msg'
);
PREPARE stmt FROM @rating_col_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE contestRating SET rank=0 WHERE rank IS NULL;
UPDATE contestRating SET totalScore=0 WHERE totalScore IS NULL;
UPDATE contestRating SET usedTime=0 WHERE usedTime IS NULL;
UPDATE contestRating SET oldRating=0 WHERE oldRating IS NULL;
UPDATE contestRating SET newRating=0 WHERE newRating IS NULL;
UPDATE contestRating SET delta=0 WHERE delta IS NULL;
ALTER TABLE contestRating MODIFY rank INT NOT NULL DEFAULT 0;
ALTER TABLE contestRating MODIFY totalScore INT NOT NULL DEFAULT 0;
ALTER TABLE contestRating MODIFY usedTime INT NOT NULL DEFAULT 0;
ALTER TABLE contestRating MODIFY oldRating INT NOT NULL DEFAULT 0;
ALTER TABLE contestRating MODIFY newRating INT NOT NULL DEFAULT 0;
ALTER TABLE contestRating MODIFY delta INT NOT NULL DEFAULT 0;

SET @rating_alg_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND COLUMN_NAME = 'algorithm'
);
SET @rating_alg_sql := IF(@rating_alg_col_exists = 0,
  'ALTER TABLE contestRating ADD COLUMN algorithm VARCHAR(40) NOT NULL DEFAULT ''elo-rank-v1''',
  'SELECT ''contestRating.algorithm already exists, skip'' AS msg'
);
PREPARE stmt FROM @rating_alg_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
UPDATE contestRating SET algorithm='elo-rank-v1' WHERE algorithm IS NULL OR algorithm='';
ALTER TABLE contestRating MODIFY algorithm VARCHAR(40) NOT NULL DEFAULT 'elo-rank-v1';

SET @rating_time_col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND COLUMN_NAME = 'updateTime'
);
SET @rating_time_sql := IF(@rating_time_col_exists = 0,
  'ALTER TABLE contestRating ADD COLUMN updateTime DATETIME NULL',
  'SELECT ''contestRating.updateTime already exists, skip'' AS msg'
);
PREPARE stmt FROM @rating_time_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
UPDATE contestRating SET updateTime=NOW() WHERE updateTime IS NULL;
ALTER TABLE contestRating MODIFY updateTime DATETIME NOT NULL;

SET @rating_pk_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND INDEX_NAME = 'PRIMARY'
);
SET @rating_pk_columns := (
  SELECT COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY COLUMN_NAME SEPARATOR ','), '')
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND INDEX_NAME = 'PRIMARY'
);
SET @rating_pair_unique_exists := (
  SELECT COUNT(*) FROM (
    SELECT INDEX_NAME,
           GROUP_CONCAT(COLUMN_NAME ORDER BY COLUMN_NAME SEPARATOR ',') AS columnSetCsv,
           COUNT(*) AS columnCount,
           MAX(NON_UNIQUE) AS nonUnique
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contestRating'
     GROUP BY INDEX_NAME
    HAVING nonUnique = 0 AND columnSetCsv = 'cid,uid' AND columnCount = 2
  ) matched
);
SET @rating_pair_key_name_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND INDEX_NAME = 'uniq_contest_rating_cid_uid'
);
SET @rating_pair_key_alt_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND INDEX_NAME = 'uniq_contest_rating_cid_uid_2'
);
SET @rating_pair_key_alt3_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND INDEX_NAME = 'uniq_contest_rating_cid_uid_3'
);
SET @rating_duplicate_pairs := (
  SELECT COUNT(*) FROM (
    SELECT cid, uid
      FROM contestRating
     GROUP BY cid, uid
    HAVING COUNT(*) > 1
  ) duplicated
);
SET @rating_null_keys := (
  SELECT COUNT(*) FROM contestRating WHERE cid IS NULL OR uid IS NULL
);

SET @rating_cid_nullable := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND COLUMN_NAME = 'cid'
     AND IS_NULLABLE = 'YES'
);
SET @rating_cid_sql := IF(@rating_null_keys = 0 AND @rating_cid_nullable > 0,
  'ALTER TABLE contestRating MODIFY cid INT NOT NULL',
  'SELECT ''contestRating.cid is already non-null or has null rows, skip'' AS msg'
);
PREPARE stmt FROM @rating_cid_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rating_uid_nullable := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND COLUMN_NAME = 'uid'
     AND IS_NULLABLE = 'YES'
);
SET @rating_uid_sql := IF(@rating_null_keys = 0 AND @rating_uid_nullable > 0,
  'ALTER TABLE contestRating MODIFY uid INT NOT NULL',
  'SELECT ''contestRating.uid is already non-null or has null rows, skip'' AS msg'
);
PREPARE stmt FROM @rating_uid_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rating_pk_sql := IF(@rating_duplicate_pairs = 0 AND @rating_null_keys = 0 AND @rating_pk_columns = 'cid,uid',
  'SELECT ''contestRating primary key already covers cid/uid, skip'' AS msg',
  IF(@rating_duplicate_pairs = 0 AND @rating_null_keys = 0 AND @rating_pk_exists = 0,
    'ALTER TABLE contestRating ADD PRIMARY KEY (cid, uid)',
    IF(@rating_duplicate_pairs = 0 AND @rating_null_keys = 0 AND @rating_pair_unique_exists = 0,
      IF(@rating_pair_key_name_exists = 0,
        'ALTER TABLE contestRating ADD UNIQUE KEY uniq_contest_rating_cid_uid (cid, uid)',
        IF(@rating_pair_key_alt_exists = 0,
          'ALTER TABLE contestRating ADD UNIQUE KEY uniq_contest_rating_cid_uid_2 (cid, uid)',
          IF(@rating_pair_key_alt3_exists = 0,
            'ALTER TABLE contestRating ADD UNIQUE KEY uniq_contest_rating_cid_uid_3 (cid, uid)',
            'SELECT ''contestRating cid/uid unique key names are occupied; use runtime cleanup or free the index name'' AS msg'
          )
        )
      ),
      IF(@rating_duplicate_pairs > 0 OR @rating_null_keys > 0,
        'SELECT ''contestRating has duplicate or null cid/uid rows; cleanup before adding primary key'' AS msg',
        'SELECT ''contestRating cid/uid unique constraint already exists, skip'' AS msg'
      )
    )
  )
);
PREPARE stmt FROM @rating_pk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rating_uid_idx_ready := (
  SELECT COUNT(*) FROM (
    SELECT INDEX_NAME,
           GROUP_CONCAT(IF(SEQ_IN_INDEX <= 1, COLUMN_NAME, NULL) ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS columnPrefixCsv,
           SUM(IF(SEQ_IN_INDEX <= 1, 1, 0)) AS prefixCount
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contestRating'
     GROUP BY INDEX_NAME
    HAVING columnPrefixCsv = 'uid' AND prefixCount = 1
  ) matched
);
SET @rating_uid_idx_name_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND INDEX_NAME = 'idx_uid'
);
SET @rating_uid_idx_alt_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND INDEX_NAME = 'idx_uid_2'
);
SET @rating_uid_idx_alt3_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND INDEX_NAME = 'idx_uid_3'
);
SET @rating_uid_idx_sql := IF(@rating_uid_idx_ready = 0,
  IF(@rating_uid_idx_name_exists = 0,
    'ALTER TABLE contestRating ADD KEY idx_uid (uid)',
    IF(@rating_uid_idx_alt_exists = 0,
      'ALTER TABLE contestRating ADD KEY idx_uid_2 (uid)',
      IF(@rating_uid_idx_alt3_exists = 0,
        'ALTER TABLE contestRating ADD KEY idx_uid_3 (uid)',
        'SELECT ''contestRating uid index names are occupied; use runtime schema setup or free the index name'' AS msg'
      )
    )
  ),
  'SELECT ''contestRating uid index already covers uid, skip'' AS msg'
);
PREPARE stmt FROM @rating_uid_idx_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rating_rank_idx_ready := (
  SELECT COUNT(*) FROM (
    SELECT INDEX_NAME,
           GROUP_CONCAT(IF(SEQ_IN_INDEX <= 2, COLUMN_NAME, NULL) ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS columnPrefixCsv,
           SUM(IF(SEQ_IN_INDEX <= 2, 1, 0)) AS prefixCount
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'contestRating'
     GROUP BY INDEX_NAME
    HAVING columnPrefixCsv = 'cid,rank' AND prefixCount = 2
  ) matched
);
SET @rating_rank_idx_name_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND INDEX_NAME = 'idx_cid_rank'
);
SET @rating_rank_idx_alt_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND INDEX_NAME = 'idx_cid_rank_2'
);
SET @rating_rank_idx_alt3_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'contestRating'
     AND INDEX_NAME = 'idx_cid_rank_3'
);
SET @rating_rank_idx_sql := IF(@rating_rank_idx_ready = 0,
  IF(@rating_rank_idx_name_exists = 0,
    'ALTER TABLE contestRating ADD KEY idx_cid_rank (cid, rank)',
    IF(@rating_rank_idx_alt_exists = 0,
      'ALTER TABLE contestRating ADD KEY idx_cid_rank_2 (cid, rank)',
      IF(@rating_rank_idx_alt3_exists = 0,
        'ALTER TABLE contestRating ADD KEY idx_cid_rank_3 (cid, rank)',
        'SELECT ''contestRating cid/rank index names are occupied; use runtime schema setup or free the index name'' AS msg'
      )
    )
  ),
  'SELECT ''contestRating cid/rank index already covers cid/rank, skip'' AS msg'
);
PREPARE stmt FROM @rating_rank_idx_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
