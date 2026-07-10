# nywOJ

> An Online Judge System — 在线评测系统

**Demo:** [https://niyiwei.com](https://niyiwei.com)

**Author:** ty · Jiangsu Suzhou Experimental Middle School

---

## 技术栈 / Tech Stack

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 · Element Plus · Monaco Editor · ECharts · Vuex · Vue Router |
| 后端 | Node.js · Express · express-session (MySQL store) |
| 数据库 | MariaDB / MySQL |
| 评测沙箱 | 仓库内 Rust sandbox（默认运行在 `localhost:5050`，API 前缀 `/api/*`） |
| 邮件 | Nodemailer (SMTP) |
| IP 归属地 | ip2region |

---

## 功能模块 / Features

### 用户系统
- 注册（邮箱验证码，30 秒限频，用户名 / 邮箱可用性检查）、用户名/邮箱密码登录、邮箱验证码登录、退出、邮箱找回密码
- 前端启动时通过 `/api/auth/getSessionInfo` 拉取当前登录态、权限键与站点偏好
- 密码 bcrypt 哈希存储；修改密码后吊销所有其他会话
- 邮箱绑定 / 修改（验证码 3 分钟有效）
- 个人资料：昵称、简介、组织、所在地、个人网址、QQ / Telegram / GitHub、Gravatar / QQ / GitHub 头像、个人主页（motto）
- 用户榜：按 AC 题数或积分排序，支持 `/u/:username` 访问、用户搜索/元信息接口，用户主页展示排名、AC 题数、积分与提交统计
- 多设备会话列表 / 单个或批量吊销
- 安全审计日志（登录、密码修改、邮箱变更、下载测试数据等）
- 管理员更新用户用户名 / 邮箱时会做格式与唯一性校验，并写入审计日志

### 权限体系（RBAC，2026-05 重构）
早期三档身份模型已被 RBAC 取代：权限是细粒度的 key（如 `problem.create` /
`submission.rejudge.any` / `user.role.admin`），多个权限组成"角色"，用户可持
有多个角色，最终权限取并集。`uid=1` 始终拥有全部权限。

内置角色：

| key | 名称 | 典型权限 |
|-----|------|---------|
| `user` | 普通用户 | 默认角色，无额外权限 |
| `problem_setter` | 出题人 | `problem.create` / `problem.manage.self` / `problem.view.any` |
| `contest_manager` | 比赛管理员 | `contest.create` / `contest.manage.self` |
| `judge_admin` | 判题管理员 | `submission.view.any` / `submission.rejudge.any` |
| `solution_admin` | 题解管理员 | `problem.solmanage`，可绑定/解绑自己可查看题目的题解，不含 `paste.edit.any` |
| `moderator` | 管理员 | 出题 + 办赛 + 判题三合一，加 `*.manage.any` 与用户相关权限 |
| `super_admin` | 超级管理员 | 所有权限 |

权限可"作用域化"：`problem.manage.any` / `contest.manage.any` / `problem.view.any`
支持 `(resource_type, resource_id)` 绑定，资源所有者可以把这些 key 授予
协作者，协作者只能在该资源范围内行使权限。讨论区权限仅作为全局管理能力使用。

用户组：
- `group.manage` 可创建 / 重命名 / 删除用户组，设置组管理员和组权限
- 组管理员可维护本组成员
- `group_permissions` 中的 allow / deny 会在登录态权限计算时并入用户有效权限
- 授权管理员可在 `/admin/migration` 导出 / 导入用户、题目、提交与讨论元数据 JSON；
  导入支持 dry-run 预检并按主键 upsert

权限目录定义于 [server/auth/permissions.js](server/auth/permissions.js)；启动时
[sync.js](server/auth/sync.js) 自动同步到 DB 表 `permissions / roles /
role_permissions / user_roles / user_permissions`。前端权限管理中心位于
`/admin/permissions`，需要 `user.manage` 或 `user.role.admin` 任一权限。

### 题目系统
- 创建、编辑、删除、公开 / 私有控制
- 题库与题目详情使用内部 `pid` 作为唯一题号
- 题面使用单一默认内容（标题、描述、标签）
- 题面样例：独立维护多组样例输入 / 输出，题面页展示并支持复制
- 难度分级（0–5）、最多 5 个标签（单标签 ≤ 10 字符）
- 管理员标签目录：支持多语言标签名、颜色、收录现有标签，删除 / 重命名会同步题目标签数组
- 时间限制（≤ 10000 ms）、内存限制（≤ 512 MB）
- 评测类型：传统文本比较 / Special Judge（自定义 checker.cpp，基于 testlib）
  - SPJ 支持部分分：checker 用 testlib `quitp(points[, msg])`（exit 7）或
    `partially correct (P)` 返回单点得分比例（≤1 视为比例，>1 视为百分比），
    评测结果显示为 **Partially Correct**（深绿色）
- 多语言支持（按位掩码控制，题目与比赛双重限制）
- 测试点管理：上传 zip / 在线编辑 / 下载（仅题目发布者或管理员）
- 在线造数据：LLM 出题助手可生成并预览数据方案；数据页提供独立“在线造数据”Tab，可上传 C++14 generator + STD 或粘贴 JSON 后直接生成 `.in/.out` 并写入 OJ，详见 [数据配置指南](docs/data-config-guide.md) 与 [LLM 使用指南](docs/llm-usage-guide.md)
- 出题人资产文件支持在线保存、重命名、删除和下载（checker / interactor / grader / 头文件等）
- 子任务系统：等分 / 自定义分值，支持遇 TLE 止测与子任务依赖
- 题解绑定（paste 系统）
  - 题解绑定由 `problem.solmanage` 或题目管理权控制；绑定前会校验 paste 对当前用户可见
- 统计信息：提交次数、AC 次数、分数分布图、最快通过榜
- 提交统计榜：最快通过、最短代码、最低内存、最早通过（每个用户取 AC 最佳提交，展示前 100）
- `/api/problem/*` 提供题集查询、题目分块详情、题面更新、协作者权限、题目文件增删改下载、评测信息更新与题型切换接口

### 比赛系统
围绕三个核心设计重写，详见 [比赛系统架构](docs/contest-system.md)：

1. **赛制 = 声明式配置**：`contest.format` 选预设（oi / ioi / acm / cf / homework），
   `contest.config`（JSON）保存对预设的覆盖 patch。管理者可在任意赛制下自由改
   「封榜 / 真实分数 / hack / 组队 / 迟交」等独立开关 —— preset 只是初始值，
   与 `problem.judgeProfile` 的设计哲学一致。
2. **鉴权收口到 policy**：所有 endpoint 不再写内联布尔，统一经
   [policy.js](server/api/contest/policy.js) 的 `resolveView` 拿 capabilities 对象，
   问「能不能」而非「是什么身份」；管理权支持按 contest 资源域授权协作者。
3. **榜单 = 事件回放**：榜单不是持久状态，而是把该场提交（+hack）按时间排成事件流，
   回放到任意时刻 t 再按赛制归约，天然支持时间轴拖动、封榜掩码、选手曲线、赛后回放。

五种赛制：

| format | 计分 | 进行中看榜/结果 | 默认封榜 | 特有配置 |
|--------|------|----------------|---------|---------|
| `oi` | 每题最后一次提交 × weight | ✗ / ✗ | ✗ | |
| `ioi` | 每题历史最高分 × weight | ✓ / ✓ | ✗ | |
| `acm` | 过题数 + 罚时 | ✓ / ✓ | ✓（60min） | 错误罚时 |
| `cf` | 初始分线性衰减 − 错误罚分 ± hack 分 | ✓ / ✓ | ✗ | pretest / hack / 衰减 |
| `homework` | 每题最高分 × weight × 迟交系数 | ✓ / ✓ | ✗ | 迟交窗口 / 折分 |

- 四种比赛状态：未开始 / 进行中 / 等待测评（过截止未关闭）/ 已结束
- 公开报名 / 管理员手动添加选手；OI 式赛制进行中遮蔽选手自己的评测结果与榜单
- **事件回放榜单**：`getRankAt` 任意时刻分页榜单（前端时间轴滑块 + 封榜 / 截止刻度），
  `getParticipantTimeline` 选手分数 / 排名曲线（点选手弹 ECharts 双轴图），
  响应含每题 通过 / 尝试 人数、一血标记；封榜期对非管理员把封榜后事件掩码为 `?N`
- **封榜**：可配置开启时间与偏移，管理员解榜或结束比赛后揭晓；结束时把官方最终榜固化到
  `contestFinalStandings`
- **组队参赛**（全赛制）：`team.enabled` 后走队伍报名流程（创建队 / 邀请码加入 / 退队，
  队长与队伍管理），榜单按队聚合，组队场强制不产生 Rating
- **CF 赛制**：pretest（数据页勾选测试点，赛中只跑 pretest）→ 过 pretest 锁题 →
  简化无房间制 hack（validator 校验输入 → std 期望输出 → 目标程序 → checker 比对，
  成功数据自动进终测）→ 管理员启动 systest 全量重测
- **作业**：独立 `/homework` 入口，开放期即时看完整结果，deadline 后进入迟交窗口
  （得分 × scoreRatio，单元格带「迟」标记），完成度统计，强制 unrated
- **比赛体检**：`checkContest` 分级 checklist（ok / warn / error），覆盖支持语言、时长、
  封榜、组队、作业、每题测试数据 / judgeProfile 资产 / 泄题 / CF pretest 与 hack 资产等
- Rating 结算 / 重建 / 预览（Elo 式，组队与作业不计入）
- 单题 / 整场重测；旧 `type` 列与 API `type` 字段保留，OI/IOI 行为与重构前 1:1 等价

### 评测系统（2026-05 重写）
- 单一 Worker 文件 [worker.js](server/api/judge/worker.js) 处理所有语言；
  语言相关参数（compile/run argv、源文件名）集中在
  [languages.js](server/api/judge/languages.js)，新增语言只需加一行
  注册表 + 一行 `INSERT INTO languages`
- 并发队列（最多 4 个 Worker 同时运行），使用 Node `child_process.fork`
- 支持语言：C11、C++14、Python 3、Java、Kotlin、Pascal、Rust、Go、Swift、Haskell、C#、F#（实际可用性取决于沙箱镜像中的工具链）
- SPJ checker 跨提交缓存（按 pid + 源码 sha256 命中），sandbox `fileId` 持久化到
  [server/judge_cache/spj.json](server/api/judge/checkerCache.js)，编辑 `checker.cpp` 自动失效
- 分布式评测：管理员在后台「评测监控」注册远程评测机、启停客户端、重置客户端 Key，服务端通过 HTTP `/api/judge/receiveTask` 分发任务、`/api/judge/clientHeartbeat` 接收心跳；默认只使用本机 Rust sandbox，确认远端也部署 sandbox 后再开启 `JUDGE.ALLOW_REMOTE_SANDBOX_CLIENTS`
- 评测结果：Waiting / Pending / Rejudging / CE / AC / **Partially Correct** / WA / TLE / MLE / RE / Segfault / OLE / 危险系统调用 / SE / **Judgement Failed** / Canceled / Skipped
  - **System Error**：后端 / 评测机代码层面的故障（沙箱不可用、网络、判题代码异常）
  - **Judgement Failed**：题目配置层面（缺失 / 非法的 config 或测试数据）或 SPJ 层面（缺失 / 编译失败 / 运行 FAIL 的 checker）的问题
- 评测完成后自动更新题目统计
- 非比赛提交支持公开 / 私有切换、源码 / 答案文件下载、管理者删除
- 提交进度通过 SSE `/api/judge/streamSubmission`（比赛为 `/api/contest/streamSubmission`）实时推送
- 交互题 / 通信题支持管道组可视化配置、interactor / manager 快捷资产和提交详情中的管道组结果概览

### Paste（剪贴板）
- 创建、编辑、删除、公开 / 私有控制
- 可绑定至题目作为题解展示

### 讨论区
- 全站 / 单题讨论列表，支持标题搜索与公开 / 隐藏状态
- 创建、编辑、删除讨论，Markdown 内容展示
- 回复、编辑回复、删除回复
- 公开 / 隐藏讨论与回复
- 讨论与回复支持 reaction 计数和当前用户选中状态
- `discussion.manage` 可全局管理讨论与回复，普通用户可管理自己的讨论与回复

### 公告系统
- 管理员发布 / 编辑，支持权重排序，首页最多展示 5 条
- 首页模块可在后台启停、排序和分栏，支持公告、一言、点击排行、点击统计与自定义 Markdown；配置保存在本地 `home.config`
- `/api/homepage/getHomepage` 聚合返回公告、用户榜、最新题目与近期比赛供首页展示

### 其他
- 一言（hitokoto）随机返回
- 首页 Rabbit 点击互动计数与排行

---

## 项目结构 / Project Structure

```
nywOJ/
├── server/                  # 后端 (Node.js / Express)
│   ├── app.js                  # 入口：session、鉴权中间件、日志、监听 :1234
│   ├── router.js               # 所有 API 路由注册
│   ├── config.example.json     # 配置模板（仓库内）
│   ├── config.json             # 实际配置（git-ignored，从模板复制）
│   ├── static.js               # 工具函数：时间格式化、IP 归属地、审计事件
│   ├── file.js                 # 文件读写封装
│   ├── refererCheck.js         # Referer 白名单中间件
│   ├── sync_data.sh            # 从部署机 rsync 测试数据到本机
│   ├── auth/                   # RBAC 子系统（2026-05 新增）
│   │   ├── permissions.js      # 权限 / 内置角色目录
│   │   ├── policy.js           # 权限求值（含作用域 + deny override）
│   │   ├── middleware.js       # requirePermission(key) Express 中间件
│   │   ├── endpoints.js        # 权限 → API 路由反查表
│   │   └── sync.js             # 启动时把权限目录同步到 DB
│   ├── db/index.js             # MySQL 连接池
│   ├── api/
│   │   ├── account/            # 用户、会话、资料、用户组
│   │   ├── content/            # 公告、Paste、讨论区、首页互动
│   │   ├── contest/            # 比赛：policy / formats / standings 回放 / teams / hacks / health / rating
│   │   ├── judge/              # 提交、Worker、语言、sandbox、日志、缓存、Socket
│   │   ├── problem/            # 题目 CRUD、测试点、judgeProfile、AI、上传
│   │   └── system/             # 管理、迁移、维护任务
│   ├── comparer/
│   │   ├── comparer.cpp        # 文本比较器（whitespace-insensitive）
│   │   ├── testlib.h           # codeforces testlib
│   │   ├── Makefile            # 构建 comparer 二进制
│   │   └── comparer            # 构建产物（git-ignored）
│   ├── hitokoto/
│   │   └── hitokoto.json       # 一言语料库
│   ├── judge_logs/<sid>.log    # 评测日志（git-ignored）
│   ├── judge_cache/spj.json    # SPJ 编译缓存（git-ignored）
│   ├── data_backup/            # rsync 备份目录（git-ignored）
│   └── data/<pid>/             # 题目测试数据目录（git-ignored，由 sync 脚本生成）
│       ├── config.json         # 测试点与子任务配置
│       ├── *.in / *.out        # 输入输出文件
│       └── checker.cpp         # SPJ checker（可选）
└── web/                     # 前端 (Vue 3)
    ├── src/
    │   ├── main.js
    │   ├── App.vue
    │   ├── router/router.js
    │   ├── sto/store.js      # Vuex store
    │   ├── assets/common.js  # axios 封装、通用工具
    │   ├── chart/myChart.js  # ECharts 封装
    │   └── components/       # 页面组件
    │       ├── indexPage.vue
    │       ├── myHeader.vue
    │       ├── monacoEditor.vue
    │       └── NotFoundPage.vue
    └── public/
```

---

## 配置说明 / Configuration

`server/config.json` 含数据库 / SMTP 凭据，已加入 `.gitignore`，仓库内只保留
模板。首次部署：

```bash
cp server/config.example.json server/config.json
# 然后编辑 server/config.json 填入真实凭据
```

字段说明：

- `DB` — MySQL/MariaDB 连接信息
- `EMAIL` — 注册、登录验证码、改邮箱、找回密码使用的 SMTP 配置；`host/port/secure/from` 可选，未填时默认使用 163 SMTP
- `SESSION.expire` — express-session cookie 过期毫秒数
- `METRICS.enabled` — 是否启动 Prometheus metrics 导出端口；开启后默认监听 `127.0.0.1:9100/metrics`
- `METRICS.allowedIps` — metrics 端口访问白名单；为空数组时不限制来源 IP
- `EVENT_REPORT.enabled` — 可选 Telegram 事件上报；开启并配置 token / chat 后会报告 API handler、Express 中间件和进程级未捕获异常
- `EVENT_REPORT.telegramBotToken` / `EVENT_REPORT.sentTo` — Telegram bot token 与接收方 chat id；`telegramApiRoot`、`proxyUrl`、`timeout` 和 `dedupeWindowMs` 可按部署环境调整
- `LLM.baseUrl` / `LLM.model` — LLM 出题助手的站点默认 Base URL 与模型；每个用户在助手页面保存自己的 API Key 和 Base URL，生成消耗该用户自己的额度。助手可生成题面、STD、题解、静态数据、造数据程序和 `judgeProfile` 评测配置；SPJ/testlib checker、提交答案、函数题、交互题、通信题会随草稿给出可编辑的评测资产
- `JUDGE.ISSERVER`
  - `true`：本机同时作为调度服务端与评测机
  - `false`：本机仅作为评测机，接受来自服务端的任务推送（`/api/judge/receiveTask`）
- `JUDGE.NAME` — 评测机标识，写入 `submission.machine` 字段
- `JUDGE.CLIENT_KEY` — 非服务端评测机接收任务时校验的客户端 Key；由后台"评测监控"生成 / 重置
- `JUDGE.CLIENT_TIMEOUT` — 服务端向远程评测机分发任务的 HTTP 超时毫秒数，默认 10000
- `JUDGE.ALLOW_REMOTE_SANDBOX_CLIENTS` — 默认 `false`。为保证用户上传代码只在 sandbox 中运行，服务端默认不向远程评测机分发提交；确认所有远程评测机也运行 Rust sandbox 后再设为 `true`
- `/api/judge/clientHeartbeat` — 远程评测机可向服务端上报 `{ clientKey, status, message, queue }`，后台会展示最近心跳与队列遥测
- `STORAGE.provider` — 题目文件存储 provider；`local` 使用本机文件系统，`s3` / `minio` / `r2` 使用 S3-compatible 对象存储
- `STORAGE.localRoot` — 本地运行缓存根目录；默认 `.` 表示以 `server/` 为根，判题仍从本地 `data/{pid}` 读取
- `STORAGE.problemArchivePrefix` — 远程对象存储中题目数据归档前缀，默认 `problem-data`，对象形如 `problem-data/<pid>.zip`
- `STORAGE.s3.*` — S3-compatible 配置：`endpoint / region / bucket / prefix / accessKeyId / secretAccessKey / forcePathStyle`
- `STORAGE.SIGN_SECRET` / `STORAGE.SIGNED_URL_TTL` — 题目数据、提交答案输入与评测资产 signed URL 的 HMAC 密钥和默认有效期
- `SYNC.remote` / `SYNC.remoteDataDir` — 测试数据云端来源（见下方"云端测试数据同步"）

---

## 启动方式 / Getting Started

### 前置依赖
- Node.js ≥ 16
- MariaDB / MySQL
- Rust sandbox 运行于 `localhost:5050`，详见 [docs/rust-sandbox-deploy.md](docs/rust-sandbox-deploy.md)
- g++-9（C++ 评测）、Python 3（Python 评测，需在沙箱环境内可执行 `pylint` 与 `python3`）
- `make`、`g++`（构建 comparer 二进制；首次运行前必须）
- 可选：`jq`（用于 `sync_data.sh` 从 `config.json` 读取 SYNC 配置）、`rsync`

### 后端

```bash
cd server
cp config.example.json config.json     # 仅首次；之后编辑填入凭据
npm install
bash scripts/apply_migrations.sh       # 建/补库表（全新库或升级后）
( cd comparer && make )                # 构建 comparer 二进制（git-ignored）
node app.js                            # 监听 :1234
```

启动时 `auth/sync.js` 会自动 reconcile 权限目录到 DB，并同步内置角色与权限关系。

### 测试 / Tests

```bash
cd server
npm run test:logic     # 纯逻辑回归（只需 DB）：RBAC / 榜单引擎 / 鉴权冒烟
npm run test:e2e       # e2e（需活 Rust sandbox / LLM key）：判题 / 出题助手
```

分层说明、CI 建库与 GitHub Actions 见 [docs/testing.md](docs/testing.md)。

### 前端

```bash
cd web
npm install
npm run serve        # 开发模式
npm run build        # 生产构建（输出到 web/dist/，已 git-ignored）
```

### 云端测试数据同步 / Cloud Sync

测试数据 (`server/data/<pid>/`) 体量大且常变，**不入 git**，由 `sync_data.sh`
通过 rsync 从部署服务器拉到本地评测机：

1. 在 `server/config.json` 的 `SYNC` 节填入：
   ```json
   "SYNC": {
     "remote":        "root@your-deploy-host",
     "remoteDataDir": "/root/nywoj/server/data"
   }
   ```
   或导出环境变量 `NYWOJ_SYNC_REMOTE` / `NYWOJ_SYNC_REMOTE_DIR`。

2. 同步：
   ```bash
   cd server
   ./sync_data.sh           # 全量同步所有题目
   ./sync_data.sh 42        # 仅同步 pid=42 的测试数据
   ```

   脚本使用 rsync `--delete --backup`，被覆盖 / 删除的旧文件会落到
   `server/data_backup/`（也已 git-ignored）。

3. 当 `JUDGE.ISSERVER = false` 时，judgeWorker 在每次评测开始时会自动调用
   `sync_data.sh <pid>`，无需手动同步。

---

## API 概览 / API Overview

多数接口为 `POST`；测试数据、提交答案输入和评测资产下载另有 `GET` 下载接口。
`POST /api/problem/createFileAccess` 可签发短期 signed URL，供测试数据上传 /
下载、提交答案输入下载与评测资产下载使用。

| 前缀 | 功能 |
|------|------|
| `/api/user/*` | 用户认证与个人信息 |
| `/api/admin/*` | 管理员操作（用户列表 / 编辑 / 封禁 / 审计 / 评测监控） |
| `/api/auth/*` | 会话信息（`getSessionInfo`）与角色 / 权限 / 资源协作者管理 |
| `/api/group/*` | 用户组、组成员与组权限 |
| `/api/migration/*` | 老站用户 / 数据迁移 |
| `/api/problem/*` | 题目与测试数据 |
| `/api/judge/*` | 提交与评测 |
| `/api/contest/*` | 比赛全流程 |
| `/api/common/*` | 公告、Paste、一言 |
| `/api/homepage/*` | 首页聚合数据 |
| `/api/rabbit/*` | 首页互动 |

未登录用户仅可访问白名单接口（题目列表、比赛列表、提交列表、一言等）。
其余接口由 `auth/middleware.js` 的 `requirePermission(key)` 守卫；调用方必须
持有该权限（直接授予或通过角色继承）。`/api/admin/*` 需要 `user.manage`。
`/api/auth/*` 中的用户角色分配与直接授权需要 `user.role.admin`；角色结构维护
（新建角色、编辑角色权限、删除角色）仅允许 `uid=1`。列表型只读接口
（`listPermissions` / `listRoles` / `listUserGrants`）放开给 `user.manage`
或 `user.role.admin` 任一。

---

## 文档 / Docs

| 文档 | 内容 |
|------|------|
| [contest-system.md](docs/contest-system.md) | 比赛系统架构：赛制声明式配置、policy 收口、事件回放榜单、CF / 组队 / 作业 |
| [judge-pipeline.md](docs/judge-pipeline.md) | 统一评测流水线：`judgeProfile` 解释器、Worker、语言、sandbox |
| [data-config-guide.md](docs/data-config-guide.md) | 测试数据目录、`config.json`、ZIP 导入与在线造数据 |
| [llm-usage-guide.md](docs/llm-usage-guide.md) | LLM 出题助手使用说明 |
| [rust-sandbox-deploy.md](docs/rust-sandbox-deploy.md) | Rust sandbox 部署 |
| [rust-sandbox-migration.md](docs/rust-sandbox-migration.md) | Rust sandbox `/api/*` 请求 / 返回契约 |
| [cloud-upgrade.md](docs/cloud-upgrade.md) | 从 `250fa62` 到当前版本的云端升级方案 |
| [testing.md](docs/testing.md) | 回归测试分层（logic / e2e）、CI 建库与 GitHub Actions |

---

## License

GPL-3.0 © ty
