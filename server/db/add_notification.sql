-- =============================================================================
-- 站内通知系统。幂等：表已存在时跳过。
-- dedupeKey 撞 UNIQUE 即静默跳过 -> push 天然幂等（开赛提醒/公告只发一次）。
-- =============================================================================
CREATE TABLE IF NOT EXISTS notification (
  nid       INT AUTO_INCREMENT PRIMARY KEY,
  uid       INT NOT NULL,                 -- 接收者
  type      VARCHAR(32) NOT NULL,         -- contest_start / discussion_reply / broadcast / clar_reply / clar_public / homework_due ...
  refType   VARCHAR(16) NULL,             -- contest / discussion / clar / plist ...
  refId     INT NULL,
  dedupeKey VARCHAR(64) NULL,             -- 幂等键，如 'contest_start:12'
  title     VARCHAR(255) NOT NULL,
  content   TEXT NULL,                    -- 纯文本或极简 markdown
  link      VARCHAR(255) NULL,            -- 前端路由路径，如 '/contest/12'
  isRead    TINYINT NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uid_dedupe (uid, dedupeKey),
  KEY idx_uid_read (uid, isRead, nid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
