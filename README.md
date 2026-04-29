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

### 权限体系
| gid | 角色 | 说明 |
|-----|------|------|
| 1 | 普通用户 | 浏览公开题目、参加比赛、提交代码 |
| 2 | 出题人 | 创建 / 管理题目与比赛、重测 |
| 3 | 管理员 | 全部权限、用户封禁、公告管理 |

### 题目系统
- 创建、编辑、公开 / 私有控制
- 难度分级（0–5）、最多 5 个标签（单标签 ≤ 10 字符）
- 时间限制（≤ 10000 ms）、内存限制（≤ 512 MB）
- 评测类型：传统文本比较 / Special Judge（自定义 checker.cpp，基于 testlib）
- 多语言支持（按位掩码控制，题目与比赛双重限制）
- 测试点管理：上传 zip / 在线编辑 / 下载（仅题目发布者或管理员）
- 子任务系统：等分 / 自定义分值，支持遇 TLE 止测与子任务依赖
- 题解绑定（paste 系统）
- 统计信息：提交次数、AC 次数、分数分布图、最快通过榜

### 比赛系统
- 创建 / 管理比赛（标题、描述、开始时间、时长）
- 比赛类型：OI（封榜） / IOI（实时可见）
- 公开报名 / 管理员手动添加选手
- 四种比赛状态：未开始 / 正在进行 / 等待测评 / 已结束
- 提交在比赛期间对 OI 赛制选手封锁评测详情
- 比赛排名榜（按总分降序 → 用时升序）、First Blood 标记
- 单题 / 整场重测

### 评测系统
- 并发队列（最多 4 个 Worker 同时运行），使用 Node `child_process.fork`
- 支持语言：**C++**（g++-9 -O2 -std=c++14）、**Python 3**、**Baltamatica**
- 分布式评测：支持将任务分发到远程评测机（通过 HTTP）
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
│   ├── app.js               # 入口：session、鉴权中间件、日志、监听 :1234
│   ├── router.js            # 所有 API 路由注册
│   ├── config.json          # 数据库、邮件、Session、评测机配置
│   ├── static.js            # 工具函数：时间格式化、IP 归属地、审计事件
│   ├── file.js              # 文件读写封装
│   ├── refererCheck.js      # Referer 白名单中间件
│   ├── sync_data.sh         # 从服务端同步测试数据到评测机
│   ├── db/index.js          # MySQL 连接池
│   ├── api/
│   │   ├── user.js          # 用户注册/登录/会话/审计
│   │   ├── admin.js         # 管理员接口
│   │   ├── problem.js       # 题目 CRUD、测试点、子任务
│   │   ├── judge.js         # 提交、队列调度、结果查询
│   │   ├── judgeWorker(C++).js      # C++ 评测 Worker
│   │   ├── judgeWorker(Python3).js  # Python3 评测 Worker
│   │   ├── judgeWorker(Baltamatica).js
│   │   ├── contest.js       # 比赛全流程
│   │   ├── common.js        # 公告、Paste、一言
│   │   ├── rabbit.js        # 首页互动
│   │   └── fileUpload.js    # 测试数据上传（multer）
│   ├── comparer/
│   │   └── comparer.cpp     # 文本比较器（whitespace-insensitive）
│   ├── hitokoto/
│   │   └── hitokoto.json    # 一言语料库
│   └── data/<pid>/          # 题目测试数据目录
│       ├── config.json      # 测试点与子任务配置
│       ├── *.in / *.out     # 输入输出文件
│       └── checker.cpp      # SPJ checker（可选）
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

编辑 `server/config.json`：

```json
{
  "DB": {
    "host": "localhost",
    "port": 3306,
    "username": "root",
    "password": "<your-password>",
    "databasename": "nywoj"
  },
  "EMAIL": {
    "username": "xxx@163.com",
    "password": "<smtp-auth-code>"
  },
  "SESSION": {
    "expire": "604800000"
  },
  "JUDGE": {
    "ISSERVER": true,
    "NAME": "<judge-machine-name>"
  }
}
```

- `JUDGE.ISSERVER = true`：本机同时作为调度服务端与评测机。
- `JUDGE.ISSERVER = false`：本机仅作为评测机，接受来自服务端的任务推送（`/api/judge/receiveTask`）。

---

## 启动方式 / Getting Started

### 前置依赖
- Node.js ≥ 16
- MariaDB / MySQL
- [go-judge](https://github.com/criyle/go-judge) 运行于 `localhost:5050`
- g++-9（C++ 评测）、Python 3（Python 评测）

### 后端

```bash
cd server
npm install
node app.js          # 监听 :1234
```

### 前端

```bash
cd web
npm install
npm run serve        # 开发模式
npm run build        # 生产构建
```

---

## API 概览 / API Overview

所有接口均为 `POST`，除下载测试数据（`GET /api/problem/downloadCase`）外。

| 前缀 | 功能 |
|------|------|
| `/api/user/*` | 用户认证与个人信息 |
| `/api/admin/*` | 管理员操作 |
| `/api/problem/*` | 题目与测试数据 |
| `/api/judge/*` | 提交与评测 |
| `/api/contest/*` | 比赛全流程 |
| `/api/common/*` | 公告、Paste、一言 |
| `/api/rabbit/*` | 首页互动 |

未登录用户仅可访问白名单接口（题目列表、比赛列表、提交列表、一言等）。管理员接口（`/api/admin/*`）要求 `gid === 3`。

---

## License

GPL-3.0 © ty
