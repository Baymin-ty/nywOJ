# 本项目 ↔ isolate 对照

[isolate](https://github.com/ioi/isolate)（C 实现）是 IOI 竞赛评测用的成熟沙箱。本项目用 Rust
重写其核心思想用于教学，并加了 Web 可视化。下表帮助你对照阅读两边源码。

| 概念 / 功能 | isolate（C） | 本项目（Rust） |
|---|---|---|
| 生命周期 | `--init` / `--run` / `--cleanup` | 聚焦 `--run`：见 `exec::run_sandbox` |
| 监督 vs 被测进程 | keeper / proxy / inside | supervisor / child，见 [`exec.rs`](../crates/sandbox-core/src/exec.rs) |
| 进入命名空间 | `clone()` with `CLONE_NEW*` | `unshare(NEWPID)`+`fork`，child 再 `unshare` 其余 |
| 目录绑定 | `--dir in=out:opts` | `fsroot::setup` 里的 bind/tmpfs 规则 |
| 换根 | `pivot_root` | [`fsroot.rs`](../crates/sandbox-core/src/fsroot.rs) |
| 资源计量/限额 | cgroup v1/v2 | cgroup v2，见 [`cgroup.rs`](../crates/sandbox-core/src/cgroup.rs) |
| 进程级限制 | `setrlimit` | [`rlimit.rs`](../crates/sandbox-core/src/rlimit.rs) |
| 时间限制 | `--time` / `--wall-time` / `--extra-time` | `cpu_time_ms` / `wall_time_ms` / `extra_time_ms` |
| 内存限制 | `--mem` / `--cg-mem` | `mem_kib`（cgroup `memory.max`，可叠加 `RLIMIT_AS`） |
| 进程数 | `--processes` | `max_procs`（cgroup `pids.max`） |
| 降权 | setuid 到 box uid | `setgroups/setgid/setuid` 到 `run_uid` |
| syscall 过滤 | （可选）seccomp | [`seccomp.rs`](../crates/sandbox-core/src/seccomp.rs) |
| 结果输出 | meta 文件（key:value） | `SandboxResult` + WebSocket 事件 |
| 状态码 | `RE`/`SG`/`TO`/`XX`（+OOM） | `OK`/`RE`/`SG`/`TO`/`MLE`/`XX`，见 `Status` |

## 本项目刻意简化/不同之处

- **独立二进制 + JSON 事件流**：isolate 把结果写 meta 文件；我们把每一步做成 JSON 事件经管道/
  WebSocket 实时上报，专为"看见沙箱在做什么"服务。
- **运行环境**：isolate 通常直接跑在裸 Linux 评测机上；本项目为方便在 Mac 学习，跑在 Docker
  特权容器里（引入 cgroup 委派这一额外教学点）。
- **编译**：本项目为简洁在容器内（宿主侧）编译用户代码；isolate 通常把编译也放进沙箱。
- **没做**：磁盘 quota、`--cg-timing`、控制组 timing 的精细统计、多测试点流水线等。

## 推荐对照阅读 isolate 源码

- `isolate.c`：主流程、命名空间、cgroup、计时、meta。
- `isolate.1.txt`：所有选项与 meta 字段语义（本项目的字段命名参考它）。
- 论文：Mareš & Blackham, *Olympiads in Informatics* 上关于 isolate 设计与评测安全的文章。
