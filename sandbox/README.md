# 🧪 教学沙箱 · Linux Sandbox Lab

一个**用来学习 Linux 系统编程**的迷你沙箱：用 Rust 实现，参考 IOI 评测沙箱
[isolate](https://github.com/ioi/isolate)，把 **namespaces / cgroups v2 / seccomp /
rlimits / pivot_root** 这些"造笼子"的内核机制亲手写一遍，并配一个 Web 界面，
让你在浏览器里提交代码、受限运行，**实时看到沙箱每一步具体做了什么**。

> **为什么在 Mac 上要用 Docker？** namespaces / cgroups / seccomp 都是 Linux 内核特性，
> macOS 内核（XNU）没有。所以"在 Mac 上写 Linux 沙箱" = 用 Rust 在 Mac 上开发，
> 但引擎跑在 Linux 内核里。Docker Desktop 底层就是一台 Linux 虚拟机，我们把引擎 + Web
> 放进一个**特权容器**运行，浏览器从 Mac 访问即可。

## 快速开始

```bash
docker compose up --build      # 构建并启动（首次编译依赖需几分钟）
# 浏览器打开 http://localhost:1145
```

打开后：左侧选语言/示例（C / C++ / Python / Shell）、写代码（带行号编辑器）、填 stdin 与可选的预期输出、调限额与机制开关，点「▶ 运行」；右侧四块面板实时展示：

1. **搭建步骤** —— 建 cgroup、unshare 命名空间、写 uid_map、bind 挂载、pivot_root、seccomp… 逐条叙述带原理与耗时。
2. **系统调用** —— 开启「syscall 追踪」后，按 syscall 聚合计数 + 原始调用流（红色 = 危险/被拦截），可过滤。
3. **资源监控** —— 内存/CPU/进程数随时间变化的双线图 + 限额进度条。
4. **隔离视图** —— 被测程序**真实看到**的根目录、挂载表、网卡、以及宿主上已"消失"的路径（execve 前从沙箱内采集）。

**机制开关（可逐项打开对照学习）**：命名空间隔离、cgroup 限额、seccomp（黑名单/白名单 × errno/kill）、
**user namespace（rootless）**、共享网络、syscall 追踪。填了"预期输出"还会做 **AC/WA 判题**。

## 一键演示（下拉「载入演示程序」）

| 程序 | 判定 | 演示的机制 |
|---|---|---|
| hello | **OK** | 正常路径，看完整搭建流程 |
| loop | **TO** | 墙钟/CPU 超时 → supervisor `SIGKILL` |
| memhog | **MLE** | cgroup `memory.max` → OOM kill |
| forkbomb | 被 `pids.max` 挡住 | cgroup 进程数上限 |
| escape | **RE** | pivot_root + 降权后读不到 `/etc/shadow` |
| netcall | 联网失败 | net namespace 只剩 loopback（勾「共享网络」可联网对照） |
| badsyscall | **RE**(EPERM) / **SG**(kill) | seccomp 拦截 `mount` |
| path_probe | **OK** | 敏感文件不可读、系统目录只读、`/box`/`/tmp` 可写 |
| proc_probe | **OK** | hostname、PID namespace、无外部网卡、no_new_privs/seccomp/capability |
| fd_stress | **OK** | `RLIMIT_NOFILE` 限制打开文件数 |
| proc_stress | **OK** | 有界 fork 压测，验证 `pids.max` |
| thread_stress | **OK** | 有界线程压测，验证 `pids.max` 覆盖 task/thread |
| privilege_probe | **OK** | setuid/setgid/setgroups/sethostname/mknod 等提权动作被拒绝 |
| escape_surface_probe | **OK** | Docker/containerd socket、危险设备、cgroup/sysctl/sysfs、旧根等逃逸前置面不可达 |
| syscall_probe | **OK** | socket/ptrace/unshare/mount/bpf/io_uring 等危险 syscall 返回 EPERM |
| tmp_fill | **OK** | 私有 `/tmp` tmpfs 填充到上限后失败 |
| output_flood | **OLE** | stdout 捕获上限与截断 |
| a+b | **AC** | 判题：stdin `3 4` + 预期 `7` → 输出比对 |
| shell · 探查隔离 | — | 在沙箱里 `id`/`hostname`/`ls /` 看隔离效果 |

勾上「user ns (rootless)」再跑 hello，程序里 `getuid()` 会是 **0（沙箱内 root）**，但它在宿主上其实是非特权用户 60000。

## 防御向安全回归

容器启动后，可以直接跑兼容接口 smoke test。Docker Compose 默认端口是 `1145`：

```bash
SANDBOX_URL=http://127.0.0.1:1145 node scripts/security-smoke.mjs
SANDBOX_URL=http://127.0.0.1:1145 node scripts/adversarial-smoke.mjs
SANDBOX_URL=http://127.0.0.1:1145 node scripts/malicious-corpus-smoke.mjs
SANDBOX_URL=http://127.0.0.1:1145 node scripts/breakout-smoke.mjs
```

`security-smoke.mjs` 覆盖基础资源限制、路径校验和危险 syscall；`adversarial-smoke.mjs`
会编译并运行 `examples/*_probe` / `*_stress` 里的有界探针，验证"应该被拒绝"和"应该被限额"的边界；
`malicious-corpus-smoke.mjs` 是全量恶意行为语料库，覆盖 CPU/墙钟/内存/输出/fd/进程/线程/tmpfs、
文件系统、逃逸前置面、权限、`/proc`、网络、危险 syscall、`copyIn/copyOut/copyOutCached`、多命令隔离与 pipeMapping
参数校验；`breakout-smoke.mjs` 是"爆破"电池，专打更刁钻的绕过面：**fork 多进程翻倍 CPU 预算**
（整组 `cpu.stat` 计量，`cpu_multiplier`/`cpu_farm`）、多进程内存炸弹（整组 cgroup 记账，`mem_multiproc`）、
原始设备/内核内存节点（`dev_probe`）、procfs 内核旋钮与 `oom_score_adj` 降权（`procfs_probe`）、
**fd 继承泄漏**（`fd_leak_probe`，execve 后只应留 stdio）、pivot_root 的 `..`/proc-root 逃逸containment
（`box_escape_probe`）、**`clone(CLONE_NEWUSER)` 嵌套 user namespace**（`userns_probe`，seccomp 按 clone flags 拦、
clone3 挡成 ENOSYS）、pipeMapping 死锁与干净 EOF、以及 `copyOut/copyOutCached` 的软链接外泄。
这些程序用于回归测试 sandbox 是否稳固，不包含逃逸、提权或反连载荷。

## 判题接口 `/api/run` 与题型支持

评测走的是 `POST /api/run`（与教学用的 `/api/submit` 不同）：它把一组「命令」在沙箱里跑起来，
可选地用「管道」把多个沙箱进程连起来。**无论请求里写什么，`/api/run` 一律强制开启全套隔离**
（命名空间 + cgroup v2 + seccomp errno 黑名单 + 断网 + 降权到非特权 uid），客户端只能调
*限额*（cpu/wall/mem/stack/进程数）与*文件*，**无法**关掉任何安全机制。请求体：

```jsonc
{
  "commands": [{
    "command": ["/box/a.out"],          // argv；[0] 支持绝对路径 / gcc·g++·python3·sh / /box 内文件
    "env": ["PATH=/usr/bin:/bin"],       // 覆盖默认 PATH/HOME
    "stdio": [                           // 按 fd 下标：0=stdin 1=stdout 2=stderr
      {"content": "3 4\n"},              // fd0：内联内容，或 {"name":"in.txt"} 指向 box 内文件，或 null
      {"name": "stdout", "max": 1048576},// fd1：捕获上限（字节，封顶 64 MiB）
      {"name": "stderr", "max": 1048576}
    ],
    "limits": {"cpuMs":2000,"wallMs":5000,"memoryMB":256,"stackMB":64,"processes":16},
    "inputFiles": {"data.in": {"content":"..."}, "prog": {"cachedFile":"<id>"}},
    "outputFiles": ["stdout","stderr","user.out"], // 要取回的文件（缺省取 stdout/stderr）
    "cachedOutputs": ["prog"],           // 落盘到文件缓存、返回可复用的 id
    "cachePrefix": "nywOJ_spj"
  }],
  "pipes": [{"from":{"command":0,"fd":1},"to":{"command":1,"fd":0}}]
}
```

响应是与 `commands` 同序的结果数组：`{status, exitCode, exitSignal, cpuTimeMs, memoryKb,
wallTimeMs, outputFiles:{…}, cachedFiles:{…}}`。缓存文件用 `GET/DELETE /api/file/:id` 取回或删除。

凭这几件积木（多命令 + 管道 + 额外 fd + 输入/输出文件 + 缓存二进制），四类题型都能表达：

| 题型 | 做法 | 对应机制 |
|---|---|---|
| **交互题** | 2 个命令（选手 + 交互器），2 条管道互连 stdin/stdout；交互器读测试数据、用退出码/stderr 给判定 | `pipes` 双向 FIFO（见 `scripts/pipe-smoke.mjs`） |
| **通信题** | ≥3 个命令（manager + 多个选手进程），多条管道由 manager 居中转发 | 多命令 + 多 `pipes`，每个进程各自独立隔离 |
| **函数题** | ①编译：`inputFiles` 传 grader.cpp+选手函数+头文件，`command` 跑 g++，`cachedOutputs` 拿二进制 id；②运行：`command:["prog"]`、`inputFiles:{prog:{cachedFile:id}}` | 缓存二进制 + 常规单命令运行 |
| **自定义题（SPJ）** | 编译 testlib checker → 缓存 id；再 `command:["spj","data.in","user.out","data.out"]` 跑，退出码/stderr = 判定 | 缓存二进制 + 输入文件（见 `scripts/spj-smoke.mjs`） |

交互题也可走 `GET /api/stream`（WebSocket，实时喂 stdin/收 stdout）用于在线 IDE 式交互。

## 架构

```
浏览器 ──HTTP/WebSocket──► sandbox-web (axum, 多线程 tokio)
                                │ 每次提交 fork 一个单线程子进程
                                ▼
                          sandbox-cli  ← 引擎入口（单线程，才能安全 fork）
                                │ 读 stdin 的 JSON 配置，把事件按行 JSON 写 stdout
                                ▼
                          sandbox-core ── supervisor + 被隔离 child
                                          unshare/cgroup/mount/seccomp/execve
```

- **`sandbox-core`**（[crates/sandbox-core](crates/sandbox-core)）：沙箱引擎库 + `cli` 入口。
  各机制独立成模块，便于对照学习：
  [namespaces+exec](crates/sandbox-core/src/exec.rs) ·
  [cgroup](crates/sandbox-core/src/cgroup.rs) ·
  [fsroot/pivot_root](crates/sandbox-core/src/fsroot.rs) ·
  [rlimit](crates/sandbox-core/src/rlimit.rs) ·
  [seccomp](crates/sandbox-core/src/seccomp.rs)
- **`sandbox-web`**（[crates/sandbox-web](crates/sandbox-web)）：axum Web + WebSocket 事件流。
- **`frontend/`**：无构建的原生 HTML/JS 四面板界面。

> **为什么引擎要做成独立子进程？** `sandbox-core::run` 会 `unshare(NEWPID)` + `fork`，
> 这在多线程进程里不安全（fork 后只能用 async-signal-safe 操作）。Web 用 tokio 是多线程的，
> 所以它把 `sandbox-cli` 作为单线程子进程拉起。这也正好贴近 isolate 的"独立 setuid 二进制"模型。

## 脱离 Web 单独跑引擎（像 isolate 的 CLI）

```bash
# 容器内
echo '{"box_dir":"/tmp/box","command":["/box/a.out"], ... }' | sandbox-cli
# 或 sandbox-cli --config cfg.json
```

## 进一步阅读

- [docs/00-overview.md](docs/00-overview.md) —— 进程模型与三段式生命周期
- [docs/01-rlimits-cgroups.md](docs/01-rlimits-cgroups.md) —— 资源限制
- [docs/02-namespaces.md](docs/02-namespaces.md) —— 命名空间与文件系统隔离
- [docs/03-seccomp-ptrace.md](docs/03-seccomp-ptrace.md) —— 系统调用过滤与追踪
- [docs/isolate-mapping.md](docs/isolate-mapping.md) —— 本项目 ↔ isolate 对照

## 安全模型与加固

**两条路径，两套策略：**

- **`/api/run`、`/api/stream`（评测路径）**：安全开关**全部硬编码为开**——命名空间隔离、
  cgroup v2 限额、seccomp（errno 黑名单，拦 `mount/ptrace/unshare/setns/socket/bpf/io_uring/
  userfaultfd/keyctl/pidfd_getfd/open_by_handle_at` 等一票危险 syscall，并按 `clone` 的 flags
  拦命名空间创建、`clone3` 挡成 ENOSYS）、断网、`pivot_root` 到最小只读根、卸载旧根、降权到
  非特权 uid、`no_new_privs`。客户端只能调*限额*和*文件*，**改不动任何一项隔离**。
- **`/api/submit`（教学路径）**：为了逐项对照学习，命名空间/cgroup/seccomp/共享网络/user ns
  等开关**可由前端自由切换**。因此它只该跑在 `localhost`，**绝不能对公网开放**。

**本轮安全评审补的洞（均在 `/api/run` 路径上）：**

- **软链越权读取**：被测程序对 `/box` 可写，可能留下软链把 `outputFiles`/`cachedOutputs` 的读取
  重定向到宿主文件（如把子目录做成指向 `/etc` 的软链）。现在读取产物时逐层设防——`symlink_metadata`
  拒绝最终分量是软链或非普通文件，再 `canonicalize` 要求真实路径仍落在 `box_dir` 内，越界即拒。
- **路径校验收紧**：`inputFiles`/stdin 的文件名拒绝空串、绝对路径、`..` 与 NUL 字节。
- **请求级 DoS 上限**：单个 `/api/run` 请求的命令数（≤64）与管道数（≤256）设了硬上限，
  挡住"一次请求 fork 上万个 sandbox-cli / 占满宿主 fd"。配合默认 256 MiB 的 HTTP body 上限
  与 stream 输入分片/总量上限（可用 `SANDBOX_*_LIMIT` 环境变量调）。
- **多命令失败清理**：管道请求准备阶段失败时，会中止持锚任务并删掉整棵 `pipe_root`，不再泄漏
  带 FIFO 的临时目录树。

回归可跑 `scripts/{security,adversarial,malicious-corpus,breakout}-smoke.mjs`（见上文）。

> 仍是**教学/自托管定位**：为求"跑得通、看得见"用了 `privileged` 容器，且编译在容器内的宿主侧进行。
> 生产评测请在此基础上进一步收敛（编译也入沙箱、rootless、更严白名单 seccomp、全局并发配额等），
> 方向见各 docs 末尾的"进阶"。**不要把任何一个端口直接暴露到公网。**
