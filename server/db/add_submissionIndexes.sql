-- =============================================================================
-- submission 高频查询索引。幂等：索引已存在时跳过。
--   idx_cid_time   (cid, submitTime, sid)  —— 榜单引擎 loadContext 主查询
--   idx_uid_result (uid, judgeResult)      —— 用户统计 / 练习统计（AC 去重）
--   idx_uid_time   (uid, submitTime)       —— 做题热力图 / 最近 AC（练习统计）
-- =============================================================================

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='submission' AND INDEX_NAME='idx_cid_time');
SET @sql := IF(@idx=0,
  'ALTER TABLE submission ADD INDEX idx_cid_time (cid, submitTime, sid)',
  'SELECT ''idx_cid_time exists, skip'' AS msg');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='submission' AND INDEX_NAME='idx_uid_result');
SET @sql := IF(@idx=0,
  'ALTER TABLE submission ADD INDEX idx_uid_result (uid, judgeResult)',
  'SELECT ''idx_uid_result exists, skip'' AS msg');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='submission' AND INDEX_NAME='idx_uid_time');
SET @sql := IF(@idx=0,
  'ALTER TABLE submission ADD INDEX idx_uid_time (uid, submitTime)',
  'SELECT ''idx_uid_time exists, skip'' AS msg');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
