// 赛制注册表：每个 format 提供默认配置 preset。contest.config(JSON) 里保存的是
// 对 preset 的覆盖（partial），resolveConfig 深合并出生效配置 —— 管理者可以在任何
// 赛制下自由改「是否开放真实分数 / 封榜 / hack」等独立开关，preset 只是初始值。
//
// 配置语义（policy.js / standings.js 消费）：
//   scoreboard.duringContest : 'none' | 'full'  比赛进行中(含等待测评)选手能否看排行榜
//   scoreboard.afterEnd      : 'public'         结束后 公开赛任何人/私有赛选手 可见（现状）
//   scoreboard.freeze        : {enabled, offsetMinutes, revealed}
//       封榜：任意赛制可开。最后 offsetMinutes 分钟对非管理员遮蔽（单元格只显示
//       pending 数）；revealed=true（管理员手动解榜）或比赛 done 后解除。
//   submission.resultVisibility : 'full'|'none' 进行中选手能否看自己提交的评测结果
//   penalty.wrongTryMinutes  : ACM 每次错误尝试罚时分钟数
//   cf.*                     : CF 赛制专属（M3）
//   team.*                   : 组队参赛（M4）
//   late.*                   : 作业迟交（M5）
//
// 计分归约器在 standings.js（按 format id 分派）：oi=每题最后一次提交加权、
// ioi=每题历史最高分加权、acm=过题数+罚时。

const FORMATS = {
  oi: {
    label: 'OI',
    legacyType: 0,
    preset: () => ({
      scoreboard: { duringContest: 'none', afterEnd: 'public', freeze: { enabled: false, offsetMinutes: 60, revealed: false } },
      team: { enabled: false, maxSize: 3, allowSelfForm: true },
      submission: { resultVisibility: 'none' },
    }),
  },
  ioi: {
    label: 'IOI',
    legacyType: 1,
    preset: () => ({
      scoreboard: { duringContest: 'full', afterEnd: 'public', freeze: { enabled: false, offsetMinutes: 60, revealed: false } },
      team: { enabled: false, maxSize: 3, allowSelfForm: true },
      submission: { resultVisibility: 'full' },
    }),
  },
  acm: {
    label: 'ACM',
    legacyType: 0,
    preset: () => ({
      scoreboard: { duringContest: 'full', afterEnd: 'public', freeze: { enabled: true, offsetMinutes: 60, revealed: false } },
      team: { enabled: false, maxSize: 3, allowSelfForm: true },
      submission: { resultVisibility: 'full' },
      penalty: { wrongTryMinutes: 20 },
    }),
  },
  homework: {
    label: '作业',
    legacyType: 1, // 旧读取方按 IOI 语义处理（即时可看结果）
    preset: () => ({
      scoreboard: { duringContest: 'full', afterEnd: 'public', freeze: { enabled: false, offsetMinutes: 60, revealed: false } },
      team: { enabled: false, maxSize: 3, allowSelfForm: true },
      submission: { resultVisibility: 'full' },
      // 计分 = 每题最高分（IOI 式）；deadline（start+length）后进入迟交窗口，
      // 迟交提交的得分 × scoreRatio；窗口结束后关闭提交。作业强制 unrated。
      late: { enabled: true, windowMinutes: 1440, scoreRatio: 0.5 },
    }),
  },
  cf: {
    label: 'Codeforces',
    legacyType: 0,
    preset: () => ({
      scoreboard: { duringContest: 'full', afterEnd: 'public', freeze: { enabled: false, offsetMinutes: 60, revealed: false } },
      team: { enabled: false, maxSize: 3, allowSelfForm: true },
      submission: { resultVisibility: 'full' },
      // weight 即题目初始分（如 500/1000/...）。得分随过题时刻线性衰减到
      // minRatio，每次错误提交 −wrongPenalty；hack 成功/失败 ±reward/penalty。
      cf: {
        pretestEnabled: true,
        hackEnabled: true,
        decayPerMinuteRatio: 1 / 250, // 每分钟衰减 初始分/250（对齐 CF）
        minRatio: 0.3,
        wrongPenalty: 50,
        hackReward: 100,
        hackFailPenalty: 50,
      },
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
      if (sb.freeze !== undefined) {
        check(isPlainObject(sb.freeze), 'scoreboard.freeze 必须是对象');
        if (isPlainObject(sb.freeze)) {
          if (sb.freeze.enabled !== undefined) check(typeof sb.freeze.enabled === 'boolean', 'freeze.enabled 必须是布尔');
          if (sb.freeze.revealed !== undefined) check(typeof sb.freeze.revealed === 'boolean', 'freeze.revealed 必须是布尔');
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
  const pen = patch.penalty;
  if (pen !== undefined) {
    check(isPlainObject(pen), 'penalty 必须是对象');
    if (isPlainObject(pen) && pen.wrongTryMinutes !== undefined) {
      const v = Number(pen.wrongTryMinutes);
      check(Number.isInteger(v) && v >= 0 && v <= 1000, 'penalty.wrongTryMinutes 必须是 0-1000 的整数');
    }
  }
  const team = patch.team;
  if (team !== undefined) {
    check(isPlainObject(team), 'team 必须是对象');
    if (isPlainObject(team)) {
      if (team.enabled !== undefined) check(typeof team.enabled === 'boolean', 'team.enabled 必须是布尔');
      if (team.allowSelfForm !== undefined) check(typeof team.allowSelfForm === 'boolean', 'team.allowSelfForm 必须是布尔');
      if (team.maxSize !== undefined) {
        const v = Number(team.maxSize);
        check(Number.isInteger(v) && v >= 1 && v <= 20, 'team.maxSize 必须是 1-20 的整数');
      }
    }
  }
  const cf = patch.cf;
  if (cf !== undefined) {
    check(isPlainObject(cf), 'cf 必须是对象');
    if (isPlainObject(cf)) {
      for (const b of ['pretestEnabled', 'hackEnabled']) {
        if (cf[b] !== undefined) check(typeof cf[b] === 'boolean', `cf.${b} 必须是布尔`);
      }
      if (cf.decayPerMinuteRatio !== undefined) {
        const v = Number(cf.decayPerMinuteRatio);
        check(Number.isFinite(v) && v >= 0 && v <= 1, 'cf.decayPerMinuteRatio 必须在 [0,1]');
      }
      if (cf.minRatio !== undefined) {
        const v = Number(cf.minRatio);
        check(Number.isFinite(v) && v >= 0 && v <= 1, 'cf.minRatio 必须在 [0,1]');
      }
      for (const n of ['wrongPenalty', 'hackReward', 'hackFailPenalty']) {
        if (cf[n] !== undefined) {
          const v = Number(cf[n]);
          check(Number.isInteger(v) && v >= 0 && v <= 100000, `cf.${n} 必须是非负整数`);
        }
      }
    }
  }
  const late = patch.late;
  if (late !== undefined) {
    check(isPlainObject(late), 'late 必须是对象');
    if (isPlainObject(late)) {
      if (late.enabled !== undefined) check(typeof late.enabled === 'boolean', 'late.enabled 必须是布尔');
      if (late.windowMinutes !== undefined) {
        const v = Number(late.windowMinutes);
        check(Number.isInteger(v) && v >= 0 && v <= 1000000, 'late.windowMinutes 必须是非负整数');
      }
      if (late.scoreRatio !== undefined) {
        const v = Number(late.scoreRatio);
        check(Number.isFinite(v) && v >= 0 && v <= 1, 'late.scoreRatio 必须在 [0,1]');
      }
    }
  }
  for (const key of Object.keys(patch)) {
    if (!['scoreboard', 'submission', 'penalty', 'cf', 'team', 'late'].includes(key)) errors.push(`未知配置项 ${key}`);
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
