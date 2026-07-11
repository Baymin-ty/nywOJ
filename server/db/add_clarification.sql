-- =============================================================================
-- 赛内提问（Clarification）。幂等：表已存在时跳过。
-- 管理员主动公告 = 直接插入 isPublic=1、answer=正文、question='' 的行。
-- =============================================================================
CREATE TABLE IF NOT EXISTS contestClar (
  clarId     INT AUTO_INCREMENT PRIMARY KEY,
  cid        INT NOT NULL,
  uid        INT NOT NULL,                -- 提问者；管理员主动公告时 = 管理员 uid
  pid        INT NULL,                    -- 关联题目（可空 = 一般问题）
  question   TEXT NOT NULL,
  answer     TEXT NULL,
  answeredBy INT NULL,
  isPublic   TINYINT NOT NULL DEFAULT 0,  -- 1 = 全场可见（公告 / 公开回复）
  createdAt  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answeredAt DATETIME NULL,
  KEY idx_cid (cid, clarId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
