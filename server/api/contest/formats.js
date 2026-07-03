// 赛制注册表：每个 format 提供默认配置 preset。contest.config(JSON) 里保存的是
// 对 preset 的覆盖（partial），resolveConfig 深合并出生效配置 —— 管理者可以在任何
// 赛制下自由改「是否开放真实分数 / 封榜 / hack」等独立开关，preset 只是初始值。
//
// 配置语义（policy.js 消费）：
//   scoreboard.duringContest : 'none' | 'full'  比赛进行中(含等待测评)选手能否看排行榜
//   scoreboard.afterEnd      : 'public'         结束后 公开赛任何人/私有赛选手 可见（现状）
//   scoreboard.showRealScore : bool             进行中选手看真实分数（false=OI 式隐藏）
//   scoreboard.freeze        : {enabled, offsetMinutes}  封榜（M2 起 acm/cf 用）
//   submission.resultVisibility : 'full'|'none' 进行中选手能否看自己提交的评测结果
//   penalty.wrongTryMinutes  : ACM 每次错误尝试罚时（M2）
//   cf.*                     : CF 赛制专属（M3）
//   team.*                   : 组队参赛（M4）
//   late.*                   : 作业迟交（M5）

const FORMATS = {
  oi: {
    label: 'OI',
    legacyType: 0,
    preset: () => ({
      scoreboard: { duringContest: 'none', afterEnd: 'public', showRealScore: false, freeze: { enabled: false, offsetMinutes: 60 } },
      submission: { resultVisibility: 'none' },
    }),
  },
  ioi: {
    label: 'IOI',
    legacyType: 1,
    preset: () => ({
      scoreboard: { duringContest: 'full', afterEnd: 'public', showRealScore: true, freeze: { enabled: false, offsetMinutes: 60 } },
      submission: { resultVisibility: 'full' },
    }),
  },
};

const FORMAT_IDS = Object.keys(FORMATS);

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

const deepMerge = (base, patch) => {
  if (!isPlainObject(patch)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(base[k])) out[k] = deepMerge(base[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
};

const normalizeFormat = (format) => (FORMATS[format] ? format : 'oi');

const formatLabel = (format) => FORMATS[normalizeFormat(format)].label;

// contest 行（含 format/config 列）→ 生效配置。config 解析失败按纯 preset 处理。
const resolveConfig = (contest) => {
  const id = normalizeFormat(contest && contest.format);
  const preset = FORMATS[id].preset();
  let patch = null;
  if (contest && contest.config) {
    try {
      patch = typeof contest.config === 'string' ? JSON.parse(contest.config) : contest.config;
    } catch (_) { patch = null; }
  }
  return deepMerge(preset, patch);
};

// 校验管理端提交的配置覆盖（只允许已知键、已知取值）。返回错误消息数组。
const validateConfigPatch = (format, patch) => {
  const errors = [];
  if (patch == null) return errors;
  if (!isPlainObject(patch)) return ['config 必须是对象'];
  const check = (cond, msg) => { if (!cond) errors.push(msg); };
  const sb = patch.scoreboard;
  if (sb !== undefined) {
    check(isPlainObject(sb), 'scoreboard 必须是对象');
    if (isPlainObject(sb)) {
      if (sb.duringContest !== undefined) check(['none', 'full'].includes(sb.duringContest), 'scoreboard.duringContest 取值非法');
      if (sb.afterEnd !== undefined) check(['public'].includes(sb.afterEnd), 'scoreboard.afterEnd 取值非法');
      if (sb.showRealScore !== undefined) check(typeof sb.showRealScore === 'boolean', 'scoreboard.showRealScore 必须是布尔');
      if (sb.freeze !== undefined) {
        check(isPlainObject(sb.freeze), 'scoreboard.freeze 必须是对象');
        if (isPlainObject(sb.freeze)) {
          if (sb.freeze.enabled !== undefined) check(typeof sb.freeze.enabled === 'boolean', 'freeze.enabled 必须是布尔');
          if (sb.freeze.offsetMinutes !== undefined) {
            const v = Number(sb.freeze.offsetMinutes);
            check(Number.isInteger(v) && v >= 0 && v <= 100000, 'freeze.offsetMinutes 必须是非负整数');
          }
        }
      }
    }
  }
  const sub = patch.submission;
  if (sub !== undefined) {
    check(isPlainObject(sub), 'submission 必须是对象');
    if (isPlainObject(sub) && sub.resultVisibility !== undefined) {
      check(['full', 'none'].includes(sub.resultVisibility), 'submission.resultVisibility 取值非法');
    }
  }
  for (const key of Object.keys(patch)) {
    if (!['scoreboard', 'submission'].includes(key)) errors.push(`未知配置项 ${key}`);
  }
  return errors;
};

// format ↔ 旧 type 列的兼容映射（acm/cf/homework 落到 0，仅为不破坏旧读取方）。
const legacyTypeOf = (format) => {
  const f = FORMATS[normalizeFormat(format)];
  return f.legacyType != null ? f.legacyType : 0;
};

module.exports = {
  FORMATS,
  FORMAT_IDS,
  normalizeFormat,
  formatLabel,
  resolveConfig,
  validateConfigPatch,
  legacyTypeOf,
  deepMerge,
};
