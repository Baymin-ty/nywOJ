// =============================================================================
// 回归测试清单。两层：
//   logic —— 只依赖 MySQL/MariaDB，CI 可跑。RBAC / policy / 榜单归约 / 迁移。
//   e2e   —— 需要活 Rust sandbox(:5050) 或 LLM key，仅本地跑。
// runner(run.js) 按此清单逐个 fork 执行，非零退出即失败。
// 路径相对 server/ 根目录。
// =============================================================================
module.exports = {
  logic: [
    { path: 'auth/test.js', desc: 'RBAC 权限 / 角色 / 组 / 题解绑定 / 比赛授权集成' },
    { path: 'auth/test_admin.js', desc: '管理员操作 / 审计 / 用户改名封禁' },
    { path: 'auth/http_access_smoke.js', desc: 'HTTP 路由鉴权冒烟（真实 server 子进程）' },
    { path: 'test/logic/contest_standings.test.js', desc: '榜单事件回放引擎五赛制归约断言' },
    { path: 'test/logic/notification.test.js', desc: '站内通知 push / 幂等 / 未读数' },
    { path: 'test/logic/rateLimit.test.js', desc: '限流令牌桶放行 / 429 / 独立计数' },
    { path: 'test/logic/clarification.test.js', desc: '赛内提问 提问/回复/公告/可见性/通知' },
    { path: 'test/logic/virtual.test.js', desc: '虚拟参赛 官方榜不变量/合榜/虚拟时钟/封榜/结算' },
    { path: 'test/logic/problem_archive.test.js', desc: '完整题目包 v2 字段 / 数据 / SPJ 资产往返断言' },
  ],
  e2e: [
    { path: 'test/e2e/judge_types.js', desc: '判题六题型真 worker + 活沙箱', needs: 'sandbox' },
    { path: 'scripts/aiAssistantE2E.js', desc: 'LLM 出题助手全链路', needs: 'llm', args: ['traditional', 'spj', 'answer'] },
  ],
};
