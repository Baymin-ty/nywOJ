const { getContest, isReg } = require('./store');
const { resolveConfig } = require('./formats');

// ============================================================================
// 比赛鉴权/可见性统一收口。所有 endpoint 不再写内联布尔表达式，改为：
//   const view = await loadView(req, cid);        // contest + viewer + caps
//   if (!view.caps.canViewScoreboard) ...403
//
// caps 由 (比赛状态, 观众身份, 赛制生效配置) 三元决定，是纯函数 —— 新赛制只需
// 在 formats.js 加 preset、在这里按新配置键扩展 capability 推导。
// OI/IOI 的推导与重构前逐接口等价（等价性由 e2e 基线 diff 保证）。
// ============================================================================

// 0 未开始 / 1 进行中 / 2 已过截止但未关闭（等待测评）/ 3 已结束(done)
const contestStatus = (info) => {
  if (info.done) return 3;
  if (Date.now() > info.start.getTime() + info.length * 1000 * 60) return 2;
  return Date.now() >= info.start.getTime() ? 1 : 0;
};

// manage = (host AND contest.manage.self) OR contest.manage.any (scoped or global)
const canManageContest = async (req, cid) => {
  if (!cid) return null;
  const contest = await getContest(cid);
  if (!contest) return null;
  return canManageLoaded(req, contest);
};

const canManageLoaded = (req, contest) => {
  const isHost = contest.host === req.session.uid;
  if (isHost && req.can('contest.manage.self')) return true;
  return req.can('contest.manage.any', { type: 'contest', id: Number(contest.cid) });
};

// 观众身份 + 能力推导。返回：
// { contest, cfg, status, isReged, isManager, caps }
const resolveView = async (req, contest) => {
  const status = contestStatus(contest);
  const isReged = await isReg(req.session.uid, contest.cid);
  const isManager = await canManageLoaded(req, contest);
  const cfg = resolveConfig(contest);
  const caps = capabilities(contest, cfg, status, {
    uid: req.session.uid,
    isReged,
    isManager,
    canViewAnySubmission: req.can('submission.view.any'),
    canRejudgeAny: req.can('submission.rejudge.any'),
  });
  return { contest, cfg, status, isReged, isManager, caps };
};

const loadView = async (req, cid) => {
  const contest = await getContest(cid);
  if (!contest) return null;
  return resolveView(req, contest);
};

// 纯函数：能力矩阵。viewer = { uid, isReged, isManager, canViewAnySubmission, canRejudgeAny }
const capabilities = (contest, cfg, status, viewer) => {
  const { isReged, isManager } = viewer;
  const isPublic = !!contest.isPublic;
  const done = !!contest.done;
  const ended = status === 3;
  const publicOrReged = isPublic || isReged;

  // 比赛进行/等待测评期间，选手是否能看到实时排行榜（IOI 式）
  const liveScoreboard = cfg.scoreboard.duringContest === 'full';
  // 进行期间选手能否看到自己提交的评测结果（OI 式 = 不能，全部遮蔽）
  const liveResults = cfg.submission.resultVisibility === 'full';

  return {
    // 进入比赛页（看介绍等基本信息）
    canEnter: isPublic || isReged || isManager,
    // 报名（公开赛、未截止、未报名）
    canRegister: status < 2 && isPublic && !isReged,
    // 「参加」：看题/提交入口
    canJoin: (isReged && status > 0) || isManager,
    // 查看题目（进行中限选手；结束后公开赛任何人、私有赛选手）
    canViewProblems: (isReged && status > 0) || isManager || (publicOrReged && done),
    // 提交（严格比赛时间窗内）
    canSubmit: isReged && status === 1,
    // 提交记录列表（进行中选手可见——OI 下行内容另行遮蔽；结束后按公开性）
    canViewSubmissionList:
      (ended && publicOrReged) || (isReged && status > 0) || isManager,
    // 排行榜（赛后需公开赛或已报名；进行中 IOI 式对选手开放）
    canViewScoreboard:
      (ended && publicOrReged) || (isReged && liveScoreboard && status > 0) || isManager,
    // 封榜掩码：开启且未手动解榜、比赛未 done 时，对非管理员遮蔽封榜期提交
    scoreboardMasked:
      !!(cfg.scoreboard.freeze && cfg.scoreboard.freeze.enabled &&
        !cfg.scoreboard.freeze.revealed && !done && !isManager),
    // Rating 变化列表
    canViewRatingChanges: (ended && publicOrReged) || isManager,
    // 提交行/详情是否遮蔽评测结果（分数/结果/时间/内存清零）。
    // done 之前（含等待测评期）持续遮蔽，与旧 OI 行为一致。
    scrubSubmissionRow: !liveResults && !done && !isManager,
    // 查看单条提交详情：本人 / 管理 / 全局提交查看权 / 赛后按公开性
    canViewSubmissionOf: (ownerUid) =>
      (ended && publicOrReged) ||
      viewer.uid === ownerUid ||
      isManager ||
      viewer.canViewAnySubmission,
    // 提交详情的完整视图（测试点 IO、judge log）：赛中仅管理/全局权限，赛后放开
    fullSubmissionView: isManager || viewer.canViewAnySubmission || ended,
    // 重测：比赛管理者或全局重测权（submission.rejudge.self 不适用于比赛内提交）
    canRejudge: isManager || viewer.canRejudgeAny,
    // hack（CF）：开启 hack、比赛进行中、终测未开始、已报名选手
    canHack:
      contest.format === 'cf' && !!(cfg.cf && cfg.cf.hackEnabled) &&
      status === 1 && Number(contest.phase || 0) === 0 && isReged,
    // hack 记录列表：选手赛中可见（自己的+统计），管理员/赛后全量
    canViewHacks:
      contest.format === 'cf' && ((isReged && status > 0) || isManager || (ended && publicOrReged)),
    manage: isManager,
  };
};

module.exports = {
  contestStatus,
  canManageContest,
  canManageLoaded,
  resolveView,
  loadView,
  capabilities,
};
