-- =============================================================================
-- nywOJ 基础库表结构（schema-only, 幂等）。
-- 由 dev 库 mysqldump --no-data 生成，加 IF NOT EXISTS，供全新环境 / CI 建库。
-- 应用顺序（见 scripts/apply_migrations.sh）：
--   1) db/schema.sql        本文件，全部基础表
--   2) auth/migration.sql   RBAC 权限表
--   3) db/add_*.sql         增量迁移（幂等，schema 已含时为 no-op）
-- FK_CHECKS 关闭以规避 mysqldump 字母序导致的外键前向引用。
-- =============================================================================

SET FOREIGN_KEY_CHECKS=0;

/*M!999999\- enable the sandbox mode */ 
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `announcement` (
  `aid` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(31) NOT NULL,
  `description` text NOT NULL,
  `time` datetime NOT NULL,
  `weight` int(11) NOT NULL,
  PRIMARY KEY (`aid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `clickList` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `uid` int(11) NOT NULL,
  `time` datetime NOT NULL,
  `ip` varchar(50) NOT NULL,
  `iploc` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `contest` (
  `cid` int(11) NOT NULL AUTO_INCREMENT,
  `title` text NOT NULL,
  `start` datetime NOT NULL,
  `length` int(11) NOT NULL,
  `host` int(11) NOT NULL,
  `type` int(11) NOT NULL,
  `isPublic` tinyint(1) NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `done` tinyint(1) DEFAULT 0,
  `lang` int(11) DEFAULT 2,
  `ratingEnabled` tinyint(4) NOT NULL DEFAULT 1,
  `format` varchar(16) DEFAULT NULL,
  `config` longtext DEFAULT NULL,
  `phase` tinyint(4) NOT NULL DEFAULT 0,
  PRIMARY KEY (`cid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `contestFinalStandings` (
  `cid` int(11) NOT NULL,
  `participantKey` varchar(24) NOT NULL,
  `rank` int(11) NOT NULL,
  `payload` longtext NOT NULL,
  PRIMARY KEY (`cid`,`participantKey`),
  KEY `idx_cid_rank` (`cid`,`rank`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `contestHack` (
  `hackId` int(11) NOT NULL AUTO_INCREMENT,
  `cid` int(11) NOT NULL,
  `pid` int(11) NOT NULL,
  `idx` int(11) NOT NULL,
  `hackerUid` int(11) NOT NULL,
  `targetSid` int(11) NOT NULL,
  `targetUid` int(11) NOT NULL,
  `inputFile` varchar(255) NOT NULL,
  `status` varchar(12) NOT NULL DEFAULT 'pending',
  `verdict` text DEFAULT NULL,
  `createTime` datetime NOT NULL,
  `judgedTime` datetime DEFAULT NULL,
  PRIMARY KEY (`hackId`),
  KEY `idx_cid` (`cid`),
  KEY `idx_cid_pid` (`cid`,`pid`),
  KEY `idx_target` (`targetSid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `contestLastSubmission` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cid` int(11) NOT NULL,
  `sid` int(11) NOT NULL,
  `uid` int(11) NOT NULL,
  `pid` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `contestPlayer` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cid` int(11) NOT NULL,
  `uid` int(11) NOT NULL,
  `teamId` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `contestProblem` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cid` int(11) NOT NULL,
  `pid` int(11) NOT NULL,
  `idx` int(11) NOT NULL,
  `weight` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `contestRating` (
  `cid` int(11) NOT NULL,
  `uid` int(11) NOT NULL,
  `rank` int(11) NOT NULL,
  `totalScore` int(11) NOT NULL,
  `usedTime` int(11) NOT NULL,
  `oldRating` int(11) NOT NULL,
  `newRating` int(11) NOT NULL,
  `delta` int(11) NOT NULL,
  `algorithm` varchar(40) NOT NULL DEFAULT 'elo-rank-v1',
  `updateTime` datetime NOT NULL,
  PRIMARY KEY (`cid`,`uid`),
  KEY `idx_uid` (`uid`),
  KEY `idx_cid_rank` (`cid`,`rank`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `contestTeam` (
  `teamId` int(11) NOT NULL AUTO_INCREMENT,
  `cid` int(11) NOT NULL,
  `name` varchar(60) NOT NULL,
  `inviteCode` varchar(16) NOT NULL,
  `createTime` datetime NOT NULL,
  PRIMARY KEY (`teamId`),
  UNIQUE KEY `uniq_cid_name` (`cid`,`name`),
  KEY `idx_cid` (`cid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `contestTeamMember` (
  `teamId` int(11) NOT NULL,
  `uid` int(11) NOT NULL,
  `isCaptain` tinyint(4) NOT NULL DEFAULT 0,
  PRIMARY KEY (`teamId`,`uid`),
  KEY `idx_uid` (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `discussion` (
  `did` int(11) NOT NULL AUTO_INCREMENT,
  `pid` int(11) DEFAULT NULL,
  `uid` int(11) NOT NULL,
  `title` varchar(80) NOT NULL,
  `content` mediumtext NOT NULL,
  `isPublic` tinyint(4) NOT NULL DEFAULT 1,
  `time` datetime NOT NULL,
  `updateTime` datetime NOT NULL,
  `lastReplyTime` datetime DEFAULT NULL,
  `replyCnt` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`did`),
  KEY `idx_pid_last_reply` (`pid`,`lastReplyTime`),
  KEY `idx_uid_time` (`uid`,`time`),
  KEY `idx_last_reply` (`lastReplyTime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `discussionReaction` (
  `did` int(11) NOT NULL,
  `uid` int(11) NOT NULL,
  `reaction` varchar(24) NOT NULL,
  `time` datetime NOT NULL,
  PRIMARY KEY (`did`,`uid`,`reaction`),
  KEY `idx_did` (`did`),
  KEY `idx_uid` (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `discussionReply` (
  `rid` int(11) NOT NULL AUTO_INCREMENT,
  `did` int(11) NOT NULL,
  `uid` int(11) NOT NULL,
  `content` mediumtext NOT NULL,
  `isPublic` tinyint(4) NOT NULL DEFAULT 1,
  `time` datetime NOT NULL,
  `updateTime` datetime NOT NULL,
  PRIMARY KEY (`rid`),
  KEY `idx_did_time` (`did`,`time`),
  KEY `idx_uid_time` (`uid`,`time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `discussionReplyReaction` (
  `rid` int(11) NOT NULL,
  `uid` int(11) NOT NULL,
  `reaction` varchar(24) NOT NULL,
  `time` datetime NOT NULL,
  PRIMARY KEY (`rid`,`uid`,`reaction`),
  KEY `idx_rid` (`rid`),
  KEY `idx_uid` (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `group_members` (
  `gid` int(11) NOT NULL,
  `uid` int(11) NOT NULL,
  `isAdmin` tinyint(4) NOT NULL DEFAULT 0,
  `joinTime` datetime NOT NULL,
  PRIMARY KEY (`gid`,`uid`),
  KEY `idx_uid` (`uid`),
  KEY `idx_gid_admin` (`gid`,`isAdmin`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `group_permissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `gid` int(11) NOT NULL,
  `permission_id` int(11) NOT NULL,
  `effect` enum('allow','deny') NOT NULL DEFAULT 'allow',
  `resource_type` varchar(32) DEFAULT NULL,
  `resource_id` int(11) DEFAULT NULL,
  `granted_by` int(11) DEFAULT NULL,
  `granted_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `expires_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_group_perm` (`gid`,`permission_id`,`effect`,`resource_type`,`resource_id`),
  KEY `idx_gid` (`gid`),
  KEY `idx_perm` (`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `judgeClient` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(80) NOT NULL,
  `endpoint` varchar(255) DEFAULT NULL,
  `allowedHosts` text DEFAULT NULL,
  `clientKey` varchar(80) NOT NULL,
  `enabled` tinyint(4) NOT NULL DEFAULT 1,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `lastSeenAt` datetime DEFAULT NULL,
  `lastTaskAt` datetime DEFAULT NULL,
  `lastTaskSid` int(11) DEFAULT NULL,
  `lastStatus` varchar(32) NOT NULL DEFAULT 'new',
  `lastMessage` varchar(255) DEFAULT NULL,
  `queueWaiting` int(11) DEFAULT NULL,
  `queueRunning` int(11) DEFAULT NULL,
  `queueConcurrency` int(11) DEFAULT NULL,
  `systemInfo` mediumtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_name` (`name`),
  UNIQUE KEY `idx_client_key` (`clientKey`),
  KEY `idx_enabled` (`enabled`),
  KEY `idx_last_seen` (`lastSeenAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `languages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `des` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `lang` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`,`name`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `pastes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `mark` varchar(255) NOT NULL,
  `title` varchar(255) NOT NULL,
  `content` text NOT NULL,
  `uid` int(11) NOT NULL,
  `time` datetime NOT NULL,
  `isPublic` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `uid` (`uid`) USING BTREE,
  KEY `mark` (`mark`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `permissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `key` varchar(64) NOT NULL,
  `group` varchar(32) NOT NULL,
  `name` varchar(64) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `scopable` tinyint(4) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `problem` (
  `pid` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(127) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `submitCnt` int(11) DEFAULT 0,
  `acCnt` int(11) DEFAULT 0,
  `timeLimit` int(11) DEFAULT 1000,
  `memoryLimit` int(11) DEFAULT 128,
  `publisher` int(11) NOT NULL,
  `isPublic` tinyint(1) DEFAULT 0,
  `time` datetime DEFAULT NULL,
  `type` int(11) NOT NULL DEFAULT 0,
  `tags` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`tags`)),
  `level` int(11) NOT NULL DEFAULT 0,
  `stat` text DEFAULT NULL,
  `lang` int(11) NOT NULL DEFAULT 6,
  `solVisible` tinyint(4) NOT NULL DEFAULT 0,
  `judgeProfile` longtext DEFAULT NULL,
  `displayId` int(11) DEFAULT NULL,
  PRIMARY KEY (`pid`),
  UNIQUE KEY `idx_problem_displayId` (`displayId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `problemAiPreview` (
  `uid` int(11) NOT NULL,
  `pid` int(11) NOT NULL,
  `jobId` varchar(80) NOT NULL,
  `status` varchar(24) NOT NULL,
  `model` varchar(120) NOT NULL,
  `sections` text DEFAULT NULL,
  `prompt` mediumtext DEFAULT NULL,
  `draft` longtext DEFAULT NULL,
  `reasoning` mediumtext DEFAULT NULL,
  `summary` text DEFAULT NULL,
  `checks` mediumtext DEFAULT NULL,
  `error` text DEFAULT NULL,
  `createTime` datetime NOT NULL,
  `updateTime` datetime NOT NULL,
  PRIMARY KEY (`uid`,`pid`),
  KEY `idx_jobId` (`jobId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `problemCompatMeta` (
  `pid` int(11) NOT NULL,
  `defaultLocale` varchar(16) NOT NULL DEFAULT 'zh-CN',
  `judgeInfo` mediumtext DEFAULT NULL,
  `submittable` tinyint(4) NOT NULL DEFAULT 1,
  `updateTime` datetime NOT NULL,
  PRIMARY KEY (`pid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `problemLocale` (
  `pid` int(11) NOT NULL,
  `locale` varchar(16) NOT NULL,
  `title` varchar(100) NOT NULL,
  `description` mediumtext NOT NULL,
  `tags` text DEFAULT NULL,
  `updateTime` datetime NOT NULL,
  PRIMARY KEY (`pid`,`locale`),
  KEY `idx_locale` (`locale`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `problemSample` (
  `pid` int(11) NOT NULL,
  `samples` mediumtext NOT NULL,
  `updateTime` datetime NOT NULL,
  PRIMARY KEY (`pid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `problemSolution` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `mark` varchar(255) NOT NULL,
  `pid` int(11) NOT NULL,
  `show` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `problemTag` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `color` varchar(20) NOT NULL DEFAULT '#909399',
  `locales` text NOT NULL,
  `createTime` datetime NOT NULL,
  `updateTime` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `rabbitstat` (
  `uid` int(11) NOT NULL DEFAULT 0,
  `click` int(11) NOT NULL DEFAULT 0,
  `date` date NOT NULL,
  PRIMARY KEY (`uid`,`date`) USING BTREE,
  KEY `uid` (`uid`),
  KEY `date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `role_permissions` (
  `role_id` int(11) NOT NULL,
  `permission_id` int(11) NOT NULL,
  PRIMARY KEY (`role_id`,`permission_id`),
  KEY `fk_rp_perm` (`permission_id`),
  CONSTRAINT `fk_rp_perm` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rp_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `roles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `key` varchar(64) NOT NULL,
  `name` varchar(64) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `builtin` tinyint(4) NOT NULL DEFAULT 0,
  `legacy_gid` tinyint(4) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key` (`key`),
  UNIQUE KEY `legacy_gid` (`legacy_gid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` int(11) unsigned NOT NULL,
  `data` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `siteSetting` (
  `key` varchar(64) NOT NULL,
  `value` mediumtext NOT NULL,
  `updateTime` datetime NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `submission` (
  `sid` int(11) NOT NULL AUTO_INCREMENT,
  `uid` int(11) NOT NULL,
  `pid` int(11) NOT NULL,
  `cid` int(11) NOT NULL DEFAULT 0,
  `code` text NOT NULL,
  `judgeResult` int(11) NOT NULL DEFAULT 0,
  `time` int(11) NOT NULL DEFAULT 0,
  `memory` int(11) NOT NULL DEFAULT 0,
  `score` int(11) NOT NULL DEFAULT 0,
  `submitTime` datetime NOT NULL,
  `codeLength` int(11) NOT NULL,
  `compileResult` longtext DEFAULT NULL,
  `caseResult` text DEFAULT NULL,
  `bonus` int(11) NOT NULL DEFAULT 0,
  `machine` varchar(255) DEFAULT NULL,
  `lang` int(11) DEFAULT NULL,
  `isPublic` tinyint(4) NOT NULL DEFAULT 1,
  `judgeScope` varchar(8) DEFAULT NULL,
  PRIMARY KEY (`sid`),
  KEY `res` (`judgeResult`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `submissionDetail` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sid` int(11) NOT NULL,
  `caseId` int(11) NOT NULL,
  `input` text DEFAULT NULL,
  `output` text DEFAULT NULL,
  `time` int(11) NOT NULL,
  `memory` int(11) NOT NULL,
  `result` int(11) NOT NULL,
  `compareResult` text DEFAULT NULL,
  `subtaskId` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `submissionFile` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sid` int(11) NOT NULL,
  `fileKey` varchar(64) NOT NULL,
  `lang` int(11) DEFAULT NULL,
  `content` longtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sid` (`sid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `userAudit` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `uid` int(11) NOT NULL,
  `event` int(11) NOT NULL,
  `ip` varchar(255) NOT NULL,
  `iploc` varchar(255) NOT NULL,
  `time` datetime NOT NULL,
  `browser` varchar(255) NOT NULL,
  `os` varchar(255) NOT NULL,
  `detail` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `userInfo` (
  `uid` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(32) NOT NULL,
  `pwd` varchar(100) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `reg_time` datetime NOT NULL,
  `login_time` datetime DEFAULT NULL,
  `clickCnt` int(11) NOT NULL DEFAULT 0,
  `inUse` tinyint(1) NOT NULL DEFAULT 1,
  `motto` text DEFAULT '这位用户太懒了，还没有设置个性签名',
  `qq` varchar(31) DEFAULT NULL,
  `preferenceLang` int(11) DEFAULT 1,
  `preferenceLocale` varchar(16) NOT NULL DEFAULT 'zh-CN',
  `acceptedProblemCount` int(11) NOT NULL DEFAULT 0,
  `rating` int(11) NOT NULL DEFAULT 0,
  `nickname` varchar(24) NOT NULL DEFAULT '',
  `bio` varchar(160) NOT NULL DEFAULT '',
  `publicEmail` tinyint(4) NOT NULL DEFAULT 0,
  `avatarInfo` varchar(128) NOT NULL DEFAULT '',
  `organization` varchar(80) NOT NULL DEFAULT '',
  `location` varchar(80) NOT NULL DEFAULT '',
  `homepageUrl` varchar(80) NOT NULL DEFAULT '',
  `telegram` varchar(30) NOT NULL DEFAULT '',
  `github` varchar(30) NOT NULL DEFAULT '',
  PRIMARY KEY (`uid`) USING BTREE,
  UNIQUE KEY `user_name` (`name`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `userLlmConfig` (
  `uid` int(11) NOT NULL,
  `baseUrl` varchar(300) NOT NULL,
  `apiKey` text NOT NULL,
  `model` varchar(120) NOT NULL,
  `updateTime` datetime NOT NULL,
  PRIMARY KEY (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `userPreferenceCompat` (
  `uid` int(11) NOT NULL,
  `preference` mediumtext NOT NULL,
  `updateTime` datetime NOT NULL,
  PRIMARY KEY (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `userSession` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `uid` int(11) NOT NULL,
  `token` varchar(63) NOT NULL,
  `loginIp` varchar(255) NOT NULL,
  `loginLoc` varchar(63) NOT NULL,
  `time` datetime NOT NULL,
  `browser` varchar(63) NOT NULL,
  `os` varchar(63) NOT NULL,
  `lastact` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_groups` (
  `gid` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(40) NOT NULL,
  `memberCnt` int(11) NOT NULL DEFAULT 0,
  `createTime` datetime NOT NULL,
  PRIMARY KEY (`gid`),
  UNIQUE KEY `name` (`name`),
  KEY `idx_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_permissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `uid` int(11) NOT NULL,
  `permission_id` int(11) NOT NULL,
  `effect` enum('allow','deny') NOT NULL DEFAULT 'allow',
  `resource_type` varchar(32) DEFAULT NULL,
  `resource_id` int(11) DEFAULT NULL,
  `granted_by` int(11) DEFAULT NULL,
  `granted_at` datetime NOT NULL DEFAULT current_timestamp(),
  `expires_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_perm` (`uid`,`permission_id`,`effect`,`resource_type`,`resource_id`),
  KEY `idx_uid` (`uid`),
  KEY `idx_resource` (`resource_type`,`resource_id`),
  KEY `fk_up_perm` (`permission_id`),
  CONSTRAINT `fk_up_perm` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_privilege` (
  `userId` int(11) NOT NULL,
  `privilegeType` varchar(40) NOT NULL,
  PRIMARY KEY (`userId`,`privilegeType`),
  KEY `idx_privilege` (`privilegeType`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_roles` (
  `uid` int(11) NOT NULL,
  `role_id` int(11) NOT NULL,
  `granted_by` int(11) DEFAULT NULL,
  `granted_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`uid`,`role_id`),
  KEY `idx_role` (`role_id`),
  CONSTRAINT `fk_ur_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET FOREIGN_KEY_CHECKS=1;
