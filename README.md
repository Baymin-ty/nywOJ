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
| 评测沙箱 | [go-judge](https://github.com/criyle/go-judge)（运行在 `localhost:5050`） |
| 邮件 | Nodemailer (163 SMTP) |
| IP 归属地 | ip2region |

---

## 功能模块 / Features

### 用户系统
- 注册（邮箱验证码，30 秒限频）、登录、退出
- 密码 bcrypt 哈希存储；修改密码后吊销所有其他会话
- 邮箱绑定 / 修改（验证码 3 分钟有效）
- 个人资料：QQ 头像、个人主页（motto）、偏好语言
- 多设备会话列表 / 单个或批量吊销
- 安全审计日志（登录、密码修改、邮箱变更、下载测试数据等）

### 权限体系（RBAC，2026-05 重构）
旧的 `gid` 三档模型已被 RBAC 取代：权限是细粒度的 key（如 `problem.create` /
`submission.rejudge.any` / `user.role.admin`），多个权限组成"角色"，用户可持
有多个角色，最终权限取并集。`uid=1` 始终拥有全部权限（root override）。

内置角色：

| key | 名称 | 典型权限 |
|-----|------|---------|
| `user` | 普通用户 | 默认角色，无额外权限 |
| `problem_setter` | 出题人 | `problem.create` / `problem.manage.self` / `problem.view.any` |
| `contest_manager` | 比赛管理员 | `contest.create` / `contest.manage.self` |
| `judge_admin` | 判题管理员 | `submission.view.any` / `submission.rejudge.any` |
| `solution_admin` | 题解管理员 | `problem.solmanage`，可绑定/解绑自己可查看题目的题解，不含 `paste.edit.any` |
| `moderator` | 管理员 | 出题 + 办赛 + 判题三合一，加 `*.manage.any` 与用户相关权限 |
| `super_admin` | 超级管理员 | 所有权限（兼容历史 `gid=3`） |

权限可"作用域化"：`problem.manage.any` / `contest.manage.any` / `problem.view.any`
都支持 `(resource_type, resource_id)` 绑定，资源所有者可以把这些 key 授予
协作者，协作者只能在该资源范围内行使权限。

权限目录定义于 [server/auth/permissions.js](server/auth/permissions.js)；启动时
[sync.js](server/auth/sync.js) 自动同步到 DB 表 `permissions / roles /
role_permissions / user_roles / user_permissions`。前端权限管理中心位于
`/admin/permissions`，需要 `user.manage` 或 `user.role.admin` 任一权限。

### 题目系统
- 创建、编辑、公开 / 私有控制
- 难度分级（0–5）、最多 5 个标签（单标签 ≤ 10 字符）
- 时间限制（≤ 10000 ms）、内存限制（≤ 512 MB）
- 评测类型：传统文本比较 / Special Judge（自定义 checker.cpp，基于 testlib）
- 多语言支持（按位掩码控制，题目与比赛双重限制）
- 测试点管理：上传 zip / 在线编辑 / 下载（仅题目发布者或管理员）
- 子任务系统：等分 / 自定义分值，支持遇 TLE 止测与子任务依赖
- 题解绑定（paste 系统）
  - 题解绑定由 `problem.solmanage` 或题目管理权控制；绑定前会校验 paste 对当前用户可见
- 统计信息：提交次数、AC 次数、分数分布图、最快通过榜

### 比赛系统
- 创建 / 管理比赛（标题、描述、开始时间、时长）
- 比赛类型：OI（封榜） / IOI（实时可见）
- 公开报名 / 管理员手动添加选手
- 四种比赛状态：未开始 / 正在进行 / 等待测评 / 已结束
- 提交在比赛期间对 OI 赛制选手封锁评测详情
- 比赛排名榜（按总分降序 → 用时升序）、First Blood 标记
- 单题 / 整场重测

### 评测系统（2026-05 重写）
- 单一 Worker 文件 [judgeWorker.js](server/api/judgeWorker.js) 处理所有语言；
  语言相关参数（compile/run argv、源文件名）集中在
  [judgeLanguages.js](server/api/judgeLanguages.js)，新增语言只需加一行
  注册表 + 一行 `INSERT INTO languages`
- 并发队列（最多 4 个 Worker 同时运行），使用 Node `child_process.fork`
- 支持语言：**C++**（g++-9 -O2 -std=c++14）、**Python 3**（pylint 语法预检）
- SPJ checker 跨提交缓存（按 pid + 源码 sha256 命中），sandbox `fileId` 持久化到
  [server/judge_cache/spj.json](server/api/spjCache.js)，编辑 `checker.cpp` 自动失效
- 分布式评测：支持将任务分发到远程评测机（通过 HTTP `/api/judge/receiveTask`）
- 评测结果：Waiting / Pending / Rejudging / CE / AC / WA / TLE / MLE / RE / Segfault / OLE / 危险系统调用 / SE / Canceled / Skipped
- 评测完成后自动更新题目统计

### Paste（剪贴板）
- 创建、编辑、删除、公开 / 私有控制
- 可绑定至题目作为题解展示

### 公告系统
- 管理员发布 / 编辑，支持权重排序，首页最多展示 5 条

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
│   │   ├── user.js             # 用户注册/登录/会话/审计
│   │   ├── admin.js            # 管理员接口
│   │   ├── auth.js             # 角色 / 权限 / 用户授权管理接口
│   │   ├── problem.js          # 题目 CRUD、测试点、子任务、协作者
│   │   ├── judge.js            # 提交、队列调度、结果查询
│   │   ├── judgeWorker.js      # 通用评测 Worker（一份代码处理所有语言）
│   │   ├── judgeLanguages.js   # 语言注册表：编译/运行命令、源文件名等
│   │   ├── judgeLog.js         # 评测日志读写
│   │   ├── spjCache.js         # SPJ checker 编译产物缓存
│   │   ├── contest.js          # 比赛全流程
│   │   ├── common.js           # 公告、Paste、一言
│   │   ├── rabbit.js           # 首页互动
│   │   └── fileUpload.js       # 测试数据上传（multer）
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
- `EMAIL` — 注册 / 改邮箱使用的 SMTP 账号（默认 163）
- `SESSION.expire` — express-session cookie 过期毫秒数
- `JUDGE.ISSERVER`
  - `true`：本机同时作为调度服务端与评测机
  - `false`：本机仅作为评测机，接受来自服务端的任务推送（`/api/judge/receiveTask`）
- `JUDGE.NAME` — 评测机标识，写入 `submission.machine` 字段
- `SYNC.remote` / `SYNC.remoteDataDir` — 测试数据云端来源（见下方"云端测试数据同步"）

---

## 启动方式 / Getting Started

### 前置依赖
- Node.js ≥ 16
- MariaDB / MySQL
- [go-judge](https://github.com/criyle/go-judge) 运行于 `localhost:5050`
- g++-9（C++ 评测）、Python 3（Python 评测，需在沙箱环境内可执行 `pylint` 与 `python3`）
- `make`、`g++`（构建 comparer 二进制；首次运行前必须）
- 可选：`jq`（用于 `sync_data.sh` 从 `config.json` 读取 SYNC 配置）、`rsync`

### 后端

```bash
cd server
cp config.example.json config.json     # 仅首次；之后编辑填入凭据
npm install
( cd comparer && make )                # 构建 comparer 二进制（git-ignored）
node app.js                            # 监听 :1234
```

启动时 `auth/sync.js` 会自动 reconcile 权限目录到 DB，并把历史 `userInfo.gid`
迁移到 `user_roles`（如果列还在）。

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

所有接口均为 `POST`，除下载测试数据（`GET /api/problem/downloadCase`）外。

| 前缀 | 功能 |
|------|------|
| `/api/user/*` | 用户认证与个人信息 |
| `/api/admin/*` | 管理员操作（用户列表 / 编辑 / 封禁 / 审计） |
| `/api/auth/*` | 角色 / 权限 / 资源协作者管理（2026-05 新增） |
| `/api/problem/*` | 题目与测试数据 |
| `/api/judge/*` | 提交与评测 |
| `/api/contest/*` | 比赛全流程 |
| `/api/common/*` | 公告、Paste、一言 |
| `/api/rabbit/*` | 首页互动 |

未登录用户仅可访问白名单接口（题目列表、比赛列表、提交列表、一言等）。
其余接口由 `auth/middleware.js` 的 `requirePermission(key)` 守卫；调用方必须
持有该权限（直接授予或通过角色继承）。`/api/admin/*` 需要 `user.manage`，
`/api/auth/*` 的角色 / 授权管理接口需要 `user.role.admin`，列表型只读接口
（`listPermissions` / `listRoles` / `listUserGrants`）放开给两者任一。

---

## License

GPL-3.0 © ty
