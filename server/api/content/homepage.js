const db = require('../../db');
const { handler, fail, ok } = require('../../db/util');
const common = require('./common');
const config = require('../../config.json');
const discussionApi = require('./discussion');
const { ensureContestRatingStorageSchema, latestRatingJoin, effectiveRatingExpr } = require('../contest/ratingStorage');

const DEFAULT_LOCALE = 'zh-CN';
const DEFAULT_HITOKOTO_API = 'https://v1.hitokoto.cn/?c=a';

let userSummarySchemaReady = null;

const ensureUserSummarySchema = () => {
  if (!userSummarySchemaReady) {
    userSummarySchemaReady = (async () => {
      const columns = [
        { name: 'nickname', ddl: "VARCHAR(24) NOT NULL DEFAULT ''" },
        { name: 'bio', ddl: "VARCHAR(160) NOT NULL DEFAULT ''" },
        { name: 'avatarInfo', ddl: "VARCHAR(128) NOT NULL DEFAULT ''" },
      ];
      for (const column of columns) {
        const row = await db.one(
          'SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
          ['userInfo', column.name]
        );
        if (!row || !row.cnt) await db.query(`ALTER TABLE userInfo ADD COLUMN ${column.name} ${column.ddl}`);
      }
      await ensureContestRatingStorageSchema();
    })();
  }
  return userSummarySchemaReady;
};

const canManageHomepage = (req) => !!(req.can && req.can('announcement.manage'));

const toObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const cleanLocale = (locale) => String(locale || DEFAULT_LOCALE).trim() || DEFAULT_LOCALE;

const localeOf = (req) => cleanLocale((req.query && req.query.locale) || (req.body && req.body.locale));

const preferenceObject = (key) => {
  const preference = config.preference || config.PREFERENCE || {};
  return preference[key] || preference[key && key.toUpperCase && key.toUpperCase()] || {};
};

const preferenceNumber = (section, key, fallback) => {
  const value = preferenceObject(section)[key];
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const preferenceBoolean = (section, key, fallback) => {
  const value = preferenceObject(section)[key];
  return value == null ? fallback : !!value;
};

const normalizeLocaleTextMap = (value, fallbackText = '') => {
  const result = {};
  for (const [locale, text] of Object.entries(toObject(value))) {
    if (typeof text === 'string') result[cleanLocale(locale)] = text;
  }
  if (!Object.keys(result).length && fallbackText) result[DEFAULT_LOCALE] = String(fallbackText);
  return result;
};

const normalizeIntArrayMap = (value) => {
  const result = {};
  for (const [locale, items] of Object.entries(toObject(value))) {
    if (!Array.isArray(items)) continue;
    result[cleanLocale(locale)] = items.map((item) => parseInt(item, 10)).filter((item) => item > 0);
  }
  return result;
};

const normalizeStringMap = (value) => {
  const result = {};
  for (const [key, item] of Object.entries(toObject(value))) {
    const name = String(key || '').trim();
    if (name && typeof item === 'string') result[name] = item;
  }
  return result;
};

const normalizeDateMap = (value) => {
  const result = {};
  for (const [key, item] of Object.entries(toObject(value))) {
    const name = String(key || '').trim();
    const date = String(item || '').trim();
    if (name && date) result[name] = date;
  }
  return result;
};

const blockFallbackSettings = (config) => {
  const blocks = Array.isArray(config && config.blocks) ? config.blocks : [];
  const noticeBlock = blocks.find((block) => block.type === 'markdown' && block.id === 'homepage-notice') ||
    blocks.find((block) => block.type === 'markdown' && block.content) ||
    blocks.find((block) => block.type === 'markdown');
  const hitokotoBlock = blocks.find((block) => block.type === 'hitokoto');
  return {
    notice: {
      enabled: !!(noticeBlock && noticeBlock.enabled),
      contents: noticeBlock && noticeBlock.content ? { [DEFAULT_LOCALE]: noticeBlock.content } : {},
    },
    annnouncements: { items: {} },
    hitokoto: {
      enabled: hitokotoBlock ? !!hitokotoBlock.enabled : true,
      apiUrl: DEFAULT_HITOKOTO_API,
    },
    countdown: { enabled: false, items: {} },
    friendLinks: { enabled: false, links: {} },
  };
};

const normalizeHomepageSettings = (value, fallbackConfig = {}) => {
  const fallback = blockFallbackSettings(fallbackConfig);
  const raw = toObject(value);
  const notice = toObject(raw.notice);
  const annnouncements = toObject(raw.annnouncements);
  const hitokoto = toObject(raw.hitokoto);
  const countdown = toObject(raw.countdown);
  const friendLinks = toObject(raw.friendLinks);

  const normalized = {
    notice: {
      enabled: notice.enabled != null ? !!notice.enabled : fallback.notice.enabled,
      contents: normalizeLocaleTextMap(notice.contents, fallback.notice.contents[DEFAULT_LOCALE] || ''),
    },
    annnouncements: {
      items: normalizeIntArrayMap(annnouncements.items || fallback.annnouncements.items),
    },
    hitokoto: {
      enabled: hitokoto.enabled != null ? !!hitokoto.enabled : fallback.hitokoto.enabled,
      apiUrl: String(hitokoto.apiUrl || fallback.hitokoto.apiUrl || DEFAULT_HITOKOTO_API),
    },
    countdown: {
      enabled: countdown.enabled != null ? !!countdown.enabled : fallback.countdown.enabled,
      items: normalizeDateMap(countdown.items || fallback.countdown.items),
    },
    friendLinks: {
      enabled: friendLinks.enabled != null ? !!friendLinks.enabled : fallback.friendLinks.enabled,
      links: normalizeStringMap(friendLinks.links || fallback.friendLinks.links),
    },
  };
  if (typeof hitokoto.customTitle === 'string' && hitokoto.customTitle.trim()) {
    normalized.hitokoto.customTitle = hitokoto.customTitle.trim();
  }
  return normalized;
};

const settingsToBlocks = (settings, currentBlocks) => {
  const blocks = Array.isArray(currentBlocks) ? currentBlocks.map((block) => ({ ...block })) : [];
  const noticeText = settings.notice.contents[DEFAULT_LOCALE] || Object.values(settings.notice.contents)[0] || '';
  let noticeBlock = blocks.find((block) => block.id === 'homepage-notice');
  if (!noticeBlock && (settings.notice.enabled || noticeText)) {
    noticeBlock = {
      id: 'homepage-notice',
      type: 'notice',
      title: '首页公告',
      column: 'main',
      enabled: !!settings.notice.enabled,
      content: noticeText,
    };
    blocks.unshift(noticeBlock);
  } else if (noticeBlock) {
    noticeBlock.type = 'notice';
    noticeBlock.enabled = !!settings.notice.enabled;
    noticeBlock.content = noticeText;
  }

  let announcementsBlock = blocks.find((block) => block.type === 'announcements');
  if (!announcementsBlock) {
    announcementsBlock = {
      id: 'announcements',
      type: 'announcements',
      title: '公告栏',
      column: 'main',
      enabled: true,
      content: '',
    };
    blocks.push(announcementsBlock);
  }

  let hitokotoBlock = blocks.find((block) => block.type === 'hitokoto');
  if (!hitokotoBlock) {
    hitokotoBlock = {
      id: 'hitokoto',
      type: 'hitokoto',
      title: settings.hitokoto.customTitle || '一言（ヒトコト）',
      column: 'side',
      enabled: !!settings.hitokoto.enabled,
      content: '',
    };
    blocks.push(hitokotoBlock);
  } else {
    hitokotoBlock.enabled = !!settings.hitokoto.enabled;
    if (settings.hitokoto.customTitle) hitokotoBlock.title = settings.hitokoto.customTitle;
  }

  let countdownBlock = blocks.find((block) => block.type === 'countdown');
  if (!countdownBlock && (settings.countdown.enabled || Object.keys(settings.countdown.items).length)) {
    countdownBlock = {
      id: 'countdown',
      type: 'countdown',
      title: '倒计时',
      column: 'side',
      enabled: !!settings.countdown.enabled,
      content: '',
    };
    blocks.push(countdownBlock);
  } else if (countdownBlock) {
    countdownBlock.enabled = !!settings.countdown.enabled;
  }

  let friendLinksBlock = blocks.find((block) => block.type === 'friendLinks');
  if (!friendLinksBlock && (settings.friendLinks.enabled || Object.keys(settings.friendLinks.links).length)) {
    friendLinksBlock = {
      id: 'friend-links',
      type: 'friendLinks',
      title: '友情链接',
      column: 'side',
      enabled: !!settings.friendLinks.enabled,
      content: '',
    };
    blocks.push(friendLinksBlock);
  } else if (friendLinksBlock) {
    friendLinksBlock.enabled = !!settings.friendLinks.enabled;
  }
  return blocks;
};

const readHomepageSettings = async () => {
  const config = await common._home.readHomeConfig();
  return normalizeHomepageSettings(config.homepageSettings, config);
};

const saveHomepageSettings = async (settings) => {
  const current = await common._home.readHomeConfig();
  const config = common._home.normalizeHomeConfig({
    ...current,
    blocks: settingsToBlocks(settings, current.blocks),
    homepageSettings: settings,
  });
  await common._home.ensureSettingSchema();
  await db.query(
    'INSERT INTO siteSetting(`key`,value,updateTime) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value=VALUES(value),updateTime=VALUES(updateTime)',
    ['home.config', JSON.stringify(config), new Date()]
  );
};

const formatAnnouncementMeta = (row) => ({
  id: row.did,
  did: row.did,
  title: row.title,
  publishTime: row.time,
  editTime: row.updateTime || row.time,
  sortTime: row.lastReplyTime || row.updateTime || row.time,
  replyCount: Number(row.replyCnt || 0),
  isPublic: !!row.isPublic,
  publisherId: row.uid,
  problemId: row.pid || undefined,
});

const getAnnouncements = async (settings, locale) => {
  await discussionApi.ensureSchema();
  const ids = settings.annnouncements.items[locale] || settings.annnouncements.items[DEFAULT_LOCALE] || [];
  if (!ids.length) return [];
  const rows = await db.query(
    'SELECT did,pid,uid,title,isPublic,time,updateTime,lastReplyTime,replyCnt FROM discussion WHERE did IN (?)',
    [ids]
  );
  const byId = new Map(rows.map((row) => [Number(row.did), row]));
  return ids.map((id) => byId.get(Number(id))).filter(Boolean).map(formatAnnouncementMeta);
};

const getAnnouncementDiscussionsByIds = async (ids) => {
  await discussionApi.ensureSchema();
  const orderedIds = (Array.isArray(ids) ? ids : [])
    .map((id) => parseInt(id, 10))
    .filter((id) => id > 0);
  if (!orderedIds.length) return [];
  const rows = await db.query(
    'SELECT did,pid,uid,title,isPublic,time,updateTime,lastReplyTime,replyCnt FROM discussion WHERE did IN (?)',
    [Array.from(new Set(orderedIds))]
  );
  const byId = new Map(rows.map((row) => [Number(row.did), row]));
  return orderedIds.map((id) => byId.get(id)).filter(Boolean).map(formatAnnouncementMeta);
};

const avatarOf = (row) => {
  const info = String(row.avatarInfo || '').trim();
  const pos = info.indexOf(':');
  if (pos > 0) return { type: info.slice(0, pos), key: info.slice(pos + 1) };
  if (row.qq) return { type: 'qq', key: String(row.qq) };
  return { type: 'qq', key: '' };
};

const topUsers = async () => {
  await ensureUserSummarySchema();
  const sortByRating = preferenceBoolean('misc', 'sortUserByRating', false);
  const limit = preferenceNumber('pagination', 'homepageUserList', 10);
  const acceptedExpr = '(SELECT COUNT(DISTINCT s.pid) FROM submission s WHERE s.uid=u.uid AND s.judgeResult=4)';
  const submissionExpr = '(SELECT COUNT(*) FROM submission s2 WHERE s2.uid=u.uid)';
  const ratingExpr = effectiveRatingExpr('u');
  const orderExpr = sortByRating
    ? `${ratingExpr} DESC,${acceptedExpr} DESC,u.uid ASC`
    : `acceptedProblemCount DESC,${ratingExpr} DESC,u.uid ASC`;
  const rows = await db.query(
    `SELECT u.uid,u.name,u.nickname,u.bio,u.qq,u.avatarInfo,u.reg_time,
            ${ratingExpr} AS rating,
            ${acceptedExpr} AS acceptedProblemCount,
            ${submissionExpr} AS submissionCount
       FROM userInfo u ${latestRatingJoin('u')}
      WHERE u.inUse=1
      ORDER BY ${orderExpr}
      LIMIT ?`,
    [limit]
  );
  return rows.map((row) => ({
    id: row.uid,
    uid: row.uid,
    username: row.name,
    name: row.name,
    email: '',
    nickname: row.nickname || '',
    bio: row.bio || '',
    avatar: avatarOf(row),
    isAdmin: Number(row.uid) === 1,
    acceptedProblemCount: Number(row.acceptedProblemCount || 0),
    submissionCount: Number(row.submissionCount || 0),
    rating: Number(row.rating || 0),
    registrationTime: row.reg_time,
  }));
};

const problemTypeOf = (type) => ([2, 3].includes(Number(type)) ? 'SubmitAnswer' : 'Traditional');

const latestUpdatedProblems = async () => {
  const limit = preferenceNumber('pagination', 'homepageProblemList', 10);
  const rows = await db.query(
    `SELECT pid,title,time,type,isPublic,publisher,submitCnt,acCnt
       FROM problem
      WHERE isPublic=1
      ORDER BY time DESC,pid DESC
      LIMIT ?`,
    [limit]
  );
  return rows.map((row) => ({
    meta: {
      id: row.pid,
      pid: row.pid,
      type: problemTypeOf(row.type),
      isPublic: !!row.isPublic,
      publicTime: row.time,
      ownerId: row.publisher,
      locales: [DEFAULT_LOCALE],
      submissionCount: Number(row.submitCnt || 0),
      acceptedSubmissionCount: Number(row.acCnt || 0),
    },
    title: row.title,
    submission: null,
  }));
};

const existingDiscussionIds = async (ids) => {
  await discussionApi.ensureSchema();
  if (!ids.length) return new Set();
  const rows = await db.query('SELECT did FROM discussion WHERE did IN (?)', [ids]);
  return new Set(rows.map((row) => Number(row.did)));
};

exports.getHomepage = handler(async (req, res) => {
  const locale = localeOf(req);
  const settings = await readHomepageSettings();
  const noticeLocale = settings.notice.contents[locale] ? locale : Object.keys(settings.notice.contents)[0];
  const annnouncementsLocale = settings.annnouncements.items[locale] ? locale : Object.keys(settings.annnouncements.items)[0];
  const [annnouncements, users, problems] = await Promise.all([
    getAnnouncements(settings, annnouncementsLocale || locale),
    topUsers(),
    latestUpdatedProblems(),
  ]);
  return ok(res, {
    notice: settings.notice.enabled && noticeLocale ? settings.notice.contents[noticeLocale] : null,
    noticeLocale: noticeLocale || null,
    annnouncements,
    annnouncementsLocale: annnouncementsLocale || null,
    hitokoto: settings.hitokoto.enabled ? settings.hitokoto : null,
    countdown: settings.countdown.enabled ? settings.countdown : null,
    friendLinks: settings.friendLinks.enabled ? settings.friendLinks : null,
    topUsers: users,
    latestUpdatedProblems: problems,
  });
});

exports.getHomepageSettings = handler(async (req, res) => {
  if (!canManageHomepage(req)) return ok(res, { error: 'PERMISSION_DENIED' });
  const settings = await readHomepageSettings();
  const annnouncementDiscussionIds = Object.values(settings.annnouncements.items).flat();
  const annnouncementDiscussions = await getAnnouncementDiscussionsByIds(annnouncementDiscussionIds);
  return ok(res, { settings, annnouncementDiscussions });
});

exports.updateHomepageSettings = handler(async (req, res) => {
  if (!canManageHomepage(req)) return ok(res, { error: 'PERMISSION_DENIED' });
  if (!req.body || !req.body.settings) return fail(res, '请确认信息完善');
  const current = await common._home.readHomeConfig();
  const settings = normalizeHomepageSettings(req.body.settings, current);
  const annnouncementIds = Object.values(settings.annnouncements.items).flat();
  const uniqueIds = Array.from(new Set(annnouncementIds));
  const existingIds = await existingDiscussionIds(uniqueIds);
  const missingId = uniqueIds.find((id) => !existingIds.has(Number(id)));
  if (missingId) return ok(res, { error: 'NO_SUCH_DISCUSSION', errorDiscussionId: missingId });
  await saveHomepageSettings(settings);
  return ok(res);
});
