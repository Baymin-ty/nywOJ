# 01 · 资源限制：rlimits 与 cgroups v2

代码：[`rlimit.rs`](../crates/sandbox-core/src/rlimit.rs) · [`cgroup.rs`](../crates/sandbox-core/src/cgroup.rs)

## rlimit（POSIX，每进程）

`setrlimit(resource, soft, hard)` 给**当前进程**设上限，内核在相应 syscall 处拦截：

| 资源 | 触顶后果 |
|---|---|
| `RLIMIT_AS` | 地址空间（mmap/brk 失败） |
| `RLIMIT_STACK` | 栈（深递归 → SIGSEGV） |
| `RLIMIT_FSIZE` | 单文件写入（超出 → SIGXFSZ） |
| `RLIMIT_NOFILE` | 打开文件数 |
| `RLIMIT_CPU` | CPU 秒（兜底硬限制） |
| `RLIMIT_CORE` | core dump 大小（设 0） |

**局限**：rlimit 是"每进程"的。程序 `fork` 出 10 个子进程，每个都能各用一份额度——
管不住"一整组进程的总内存/总进程数"。这正是要上 cgroup 的原因。

## cgroup v2（每"组"，Linux 核心机制）

cgroup v2 就是 `/sys/fs/cgroup` 下的一棵目录树，限额/计量全靠**读写普通文件**：

```bash
# 限额
echo 268435456 > run_X/memory.max     # 256 MiB
echo 0         > run_X/memory.swap.max # 禁 swap，防绕过
echo 16        > run_X/pids.max        # 最多 16 个进程/线程
# 放进笼子
echo <pid>     > run_X/cgroup.procs    # 它及其所有子孙都受限
# 计量
cat run_X/memory.current  run_X/memory.peak   run_X/pids.current
cat run_X/memory.events   # oom_kill 次数
# 一键全杀
echo 1 > run_X/cgroup.kill
```

进程超 `memory.max` → 内核触发 **OOM kill**（判定 MLE）；`fork` 超 `pids.max` → 失败（挡住 fork 炸弹）。

## 容器里的坑：cgroup 委派 + no-internal-process

cgroup v2 有条规则：一个**非根、且有进程**的 cgroup 不能在 `cgroup.subtree_control`
里启用控制器。容器命名空间根 `/sys/fs/cgroup` 恰好既非真根、又装着容器自己的进程，
直接启用控制器会 `EBUSY`。本项目的做法（见 `Cgroup::create`）：

1. 把根 `cgroup.procs` 里的进程先挪到一个叶子 `_keeper`，腾空根；
2. 往根 `cgroup.subtree_control` 写 `+memory +pids` 启用控制器；
3. 建本次运行用的子 cgroup 写限额。

如果哪步失败（控制器没委派进来、权限不足……）→ **优雅降级**到 `RLIMIT_AS` 限内存，
并在 Web 上标注。这就是 isolate README 警告的"容器内 cgroup 委派"问题。

## 试一试

- `memhog` 把 `内存 (KiB)` 调到 65536，看 OOM（MLE）。
- `forkbomb` 看「资源监控」里进程数顶在 `max_procs` 不再涨。
- 关掉「cgroup 限额」开关再跑 `memhog`，观察降级到 rlimit 后的差异。

## 进阶

- 用 `cpu.max` 做 CPU 配额（带宽限制）而不仅靠计时杀。
- 用 `io.max` 限磁盘 IO；用 `memory.high` 做软限制 + 回收。
