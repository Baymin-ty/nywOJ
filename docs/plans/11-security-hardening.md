# 方案 11：安全加固（统一限流 / 登录退避 / customRun 节流）

> 类型：夯实 · 规模：M · 前置：方案 15 · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景与现状（已核实）

- 限流目前只有 `server/api/account/user.js` 里验证码用途的 per-session `checkRateLimit/markRateLimit`（30 秒限频），无 IP 维度、无全局中间件。
- 自测接口 `/api/judge/customRun`（server/api/judge/customRun.js）有大小/时长硬上限（100KB 代码、64KB stdin、10s、512MB）但**无频率限制**，可被脚本刷沙箱。
- 提交接口 `judge.submit / submitMulti` 无频率限制。
- 站点对外开放（niyiwei.com），单实例部署。

## 改动

### 1. 统一限流中间件（新建 `server/rateLimit.js`）

- 内存令牌桶：key = `<name>:<uid 或 ip>`（登录用户按 uid，匿名按 IP；IP 取现有封装——static.js 里已有 IP 归属地逻辑，取 IP 的方式与之一致，注意反代 X-Forwarded-For 只信任本机 nginx）。
- 工厂：`rateLimit(name, { capacity, refillPerSec, by: 'uid'|'ip'|'both' })` 返回 Express 中间件；超限回 `429 { wait: <秒> }`；桶表定期清扫防内存泄漏。
- 配置：config.json 新增 `SECURITY` 节（config.example.json 同步 + README 字段说明），每条可覆盖默认值；`SECURITY.enabled=false` 一键关闭（本地开发/CI 友好）。
- 超限达到阈值（如 1 分钟内 20 次 429）写审计事件（static.js 审计封装）。

### 2. 接入点（router.js 在 requirePermission 前挂）

| 路由 | 默认策略 |
|------|---------|
| judge.submit / submitMulti / contest 提交 | 每 uid 10 秒 1 次（OJ 惯例） |
| /api/judge/customRun | 每 uid 每分钟 6 次 |
| 登录 | 每 IP 每分钟 10 次 |
| 注册 / 发验证码 | 现有 purpose 限频保留，补每 IP 每小时上限 |
| 讨论/回复/paste 创建 | 每 uid 每分钟 5 次 |
| 全局搜索（方案 09 上线后） | 每 key 每分钟 30 次 |

### 3. 登录失败退避（server/api/account/user.js 登录处）

- 内存计数器 key=`<username>:<ip>`：连续失败 n 次后要求等待 `min(2^(n-3), 60)` 秒（前 3 次不罚）；成功登录清零；计数 30 分钟自动过期。响应告知等待秒数，前端登录页展示。
- 失败达 10 次写审计事件（撞库信号）。

### 4. 审计核对

对照 README「安全审计日志」现有覆盖（登录、密码修改、邮箱变更、下载测试数据），补齐：权限/角色变更、broadcast、限流封禁事件。已覆盖的不动。

## 验收标准

- [ ] logic 测试：令牌桶单元断言（capacity/refill/清扫）；连发脚本对 submit 与 customRun 断言第 N 次起 429 且 wait 递减准确
- [ ] 登录失败 5 次后被要求等待，成功后计数清零
- [ ] `SECURITY.enabled=false` 时全部直通（CI 里关闭，避免拖慢测试）
- [ ] 正常使用（做题/提交/讨论）无感，比赛 47 项回归 + 判题 e2e 不受影响
- [ ] config.example.json 与 README 文档更新

## 注意

- 单进程内存实现即可（当前单实例）；在 rateLimit.js 头注释写明「多实例部署需换 Redis」的局限。
- 别把限流挂到 SSE 流接口（streamSubmission）和静态资源上。
- 429 前端统一处理：common.js 的 axios 封装里对 429 弹「操作过于频繁，请 N 秒后再试」。
