const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { handler, fail, ok } = require('../../db/util');
const { getFile } = require('../../file');
const { profileHealth, listAssetsOf } = require('../problem/judgeProfile');
const { summarizeProfileFlow } = require('../problem/judgeProfile');
const { getContest } = require('./store');
const { canManageContest, contestStatus } = require('./policy');
const { resolveConfig } = require('./formats');

// ============================================================================
// 比赛体检：开赛前一键检查配置是否完整可跑。返回分级 checklist
// [{ level: 'ok'|'warn'|'error', scope: 'contest'|'problem', idx?, title, detail }]
// 管理页「检查比赛」按钮 + 各里程碑功能的前置条件都汇总在这里。
// ============================================================================

const SERVER_ROOT = path.join(__dirname, '..', '..');
const dataDir = (pid) => path.join(SERVER_ROOT, 'data', String(pid));
const assetExists = (pid, name) =>
  fs.existsSync(path.join(dataDir(pid), 'assets', name)) ||
  (name === 'checker.cpp' && fs.existsSync(path.join(dataDir(pid), 'checker.cpp')));

const checkContest = async (cid) => {
  const checks = [];
  const add = (level, scope, title, detail, idx = null) =>
    checks.push({ level, scope, title, detail, idx });

  const contest = await getContest(cid);
  if (!contest) return null;
  const cfg = resolveConfig(contest);
  const format = contest.format || 'oi';
  const status = contestStatus(contest);

  // ---- 比赛级 ----
  if (!contest.lang) add('error', 'contest', '未设置支持语言', '选手将无法提交任何语言。');
  else add('ok', 'contest', '支持语言已设置', null);

  if (!contest.length || contest.length <= 0) add('error', 'contest', '比赛时长非法', `length=${contest.length}`);
  if (status === 3) add('warn', 'contest', '比赛已结束', '体检结果仅供参考。');

  const freeze = cfg.scoreboard && cfg.scoreboard.freeze;
  if (freeze && freeze.enabled) {
    if ((freeze.offsetMinutes || 0) >= contest.length) {
      add('warn', 'contest', '封榜时长覆盖全场', `封榜 ${freeze.offsetMinutes} 分钟 ≥ 比赛时长 ${contest.length} 分钟，全场都会被冻结。`);
    } else {
      add('ok', 'contest', `封榜已开启（最后 ${freeze.offsetMinutes} 分钟）`, null);
    }
  }

  const problems = await db.query(
    `SELECT cp.idx,cp.pid,cp.weight,p.title,p.judgeProfile,p.timeLimit,p.memoryLimit
       FROM contestProblem cp INNER JOIN problem p ON p.pid=cp.pid
      WHERE cp.cid=? ORDER BY cp.idx`,
    [cid]
  );
  if (!problems.length) {
    add('error', 'contest', '没有题目', '请在题目管理中添加题目。');
    return { contest: { cid, format }, checks };
  }
  add('ok', 'contest', `共 ${problems.length} 道题目`, null);

  const cf = format === 'cf' ? (cfg.cf || {}) : null;

  // ---- 题目级 ----
  for (const p of problems) {
    const idx = p.idx;
    const tag = `#${idx} ${p.title}`;

    // 数据与配置
    const cfgRaw = await getFile(`./data/${p.pid}/config.json`).catch(() => null);
    let dataConfig = null;
    try { dataConfig = cfgRaw ? JSON.parse(cfgRaw) : null; } catch (_) { dataConfig = null; }
    if (!dataConfig || !Array.isArray(dataConfig.cases) || !dataConfig.cases.length) {
      add('error', 'problem', `${tag}：没有测试数据`, '缺少 config.json 或 cases 为空。', idx);
      continue;
    }
    add('ok', 'problem', `${tag}：${dataConfig.cases.length} 个测试点`, null, idx);

    // 评测档案
    let profile = null;
    try { profile = p.judgeProfile ? JSON.parse(p.judgeProfile) : null; } catch (_) { profile = null; }
    if (profile) {
      try {
        const health = profileHealth(profile, listAssetsOf(p.pid).map((a) => a.name));
        for (const e of (health && health.errors) || []) {
          add('error', 'problem', `${tag}：评测配置错误`, String(e), idx);
        }
      } catch (err) {
        add('warn', 'problem', `${tag}：评测配置无法体检`, err.message, idx);
      }
    }

    // CF：pretest 标记
    if (cf && cf.pretestEnabled) {
      const pretests = Array.isArray(dataConfig.pretests) ? dataConfig.pretests.map(Number) : [];
      if (!pretests.length) {
        add('error', 'problem', `${tag}：未标记 pretest`, 'CF 赛制开启 pretest 后，需在数据配置页勾选 pretest 测试点。', idx);
      } else {
        const valid = new Set(dataConfig.cases.map((c) => Number(c.index)));
        const bad = pretests.filter((x) => !valid.has(x));
        if (bad.length) add('error', 'problem', `${tag}：pretest 标记失效`, `编号 ${bad.join(',')} 不存在，请重新保存数据配置。`, idx);
        else add('ok', 'problem', `${tag}：pretest ${pretests.length}/${dataConfig.cases.length} 个`, null, idx);
      }
    }

    // CF：hack 前置
    if (cf && cf.hackEnabled) {
      const flow = summarizeProfileFlow(p.judgeProfile);
      if (flow && (flow.pipeGroupCount > 0 || flow.interactive)) {
        add('error', 'problem', `${tag}：交互/通信题不支持 hack`, '请关闭 hack 或移除该题。', idx);
      }
      if (!assetExists(p.pid, 'validator.cpp')) {
        add('error', 'problem', `${tag}：缺少数据校验器`, 'hack 需要资产 assets/validator.cpp（testlib，stdin 读入，exit 0 合法）。', idx);
      }
      if (!assetExists(p.pid, 'std.cpp')) {
        add('error', 'problem', `${tag}：缺少标程`, 'hack 需要资产 assets/std.cpp 以生成期望输出。', idx);
      }
      if (assetExists(p.pid, 'validator.cpp') && assetExists(p.pid, 'std.cpp')) {
        add('ok', 'problem', `${tag}：hack 资产齐备`, assetExists(p.pid, 'checker.cpp') ? '比对使用题目 checker。' : '无 checker，按默认文本比对。', idx);
      }
    }

    // 分值语义提示
    if (format === 'cf' && (!p.weight || p.weight < 100)) {
      add('warn', 'problem', `${tag}：初始分偏低（${p.weight}）`, 'CF 赛制中 weight 即题目初始分，通常为 500~3000。', idx);
    }
  }

  const summary = checks.reduce((acc, c) => { acc[c.level] = (acc[c.level] || 0) + 1; return acc; }, { error: 0, warn: 0, ok: 0 });
  return { contest: { cid, format, title: contest.title }, checks, summary };
};

exports.checkContest = handler(async (req, res) => {
  const { cid } = req.body;
  const allowed = await canManageContest(req, cid);
  if (allowed === null) return fail(res, '无此比赛');
  if (!allowed) return res.status(403).end('403 Forbidden');
  const result = await checkContest(cid);
  if (!result) return fail(res, '无此比赛');
  return ok(res, { data: result });
});
