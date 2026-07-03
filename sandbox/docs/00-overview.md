# 00 · 总览：进程模型与生命周期

## 一个沙箱要解决的三件事

1. **隔离（看不见）**：让程序看不到宿主的进程、文件系统、网络、IPC、主机名 → **namespaces**。
2. **限额（用不超）**：限制内存、CPU 时间、进程数、文件大小 → **cgroups v2** + **rlimits**。
3. **收权（做不了）**：禁止危险操作、以非特权身份运行 → **降权（setuid）** + **seccomp**。

isolate 把这套东西封装成一个三段式 CLI：`--init`（建盒子）/ `--run`（受限运行）/ `--cleanup`（清理）。
本项目聚焦 `--run`：把"搭笼子 → execve 用户程序 → 监督 → 判定"完整走一遍。

## 进程模型

```
supervisor（sandbox-cli 主进程，留在宿主命名空间）
  │  unshare(CLONE_NEWPID)            ← 关键：之后 fork 出的孩子才是新 PID ns 的 PID 1
  │  fork()
  ├──────────────► child（新 PID ns 的 PID 1）
  │                  ├ 等 supervisor 放行（先把自己放进 cgroup）
  │                  ├ unshare(NEWNS|NEWNET|NEWIPC|NEWUTS)
  │                  ├ 重定向 stdio
  │                  ├ 建最小 rootfs + pivot_root + mount /proc
  │                  ├ setrlimit
  │                  ├ 降权 setgid/setuid
  │                  ├ 安装 seccomp
  │                  └ execve(用户程序)        ← 从此在所有限制下运行
  │
  └ supervisor：把 child 写进 cgroup.procs → 放行 → 监督
       · poll 三条管道：events(child 的步骤叙述) / stdout / stderr
       · 周期性读 cgroup：memory.current/peak、pids.current
       · 墙钟/CPU 超时 → cgroup.kill + SIGKILL
       · wait4 收尸 → 读 memory.peak / memory.events(OOM) → 产出判定
```

为什么 supervisor 和 child 是**两个进程**、还要一条 events 管道？因为 child 在
`pivot_root`/`unshare`/`execve` 之后，内存与命名空间都跟 supervisor 分家了，没法直接回调；
所以 child 把"我正在做什么"写成 JSON 行经管道回传，supervisor 再转发给 Web。
代码见 [`exec.rs`](../crates/sandbox-core/src/exec.rs) 与 [`events.rs`](../crates/sandbox-core/src/events.rs)。

## 判定状态（对齐 isolate 的 meta）

| 状态 | 含义 | 触发 |
|---|---|---|
| `OK` | 正常退出 0 | |
| `RE` | 运行错误 | 非零退出码 |
| `SG` | 被信号杀 | 段错误、seccomp kill(SIGSYS) 等 |
| `TO` | 超时 | 墙钟或 CPU 超限，被 supervisor 杀 |
| `MLE` | 内存超限 | cgroup OOM |
| `XX` | 沙箱内部错误 | 搭建失败 |

对应字段：`time` / `time-wall` / `max-rss` / `cg-mem` / `exitcode` / `exitsig` / `killed`。

## 时间是怎么量的

- **墙钟**：supervisor 用 `Instant` 量 fork→退出的真实时间。
- **CPU 时间**：`wait4` 的 `rusage`（user+sys），运行中用 `/proc/<pid>/stat` 近似实时采样。
- 两者都要：死循环靠墙钟抓；"真在烧 CPU vs 在睡眠等待"靠 CPU 时间区分。
