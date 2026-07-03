# 03 · 系统调用：seccomp 过滤与 ptrace 追踪

代码：[`seccomp.rs`](../crates/sandbox-core/src/seccomp.rs) · [`exec.rs`](../crates/sandbox-core/src/exec.rs)（trace 部分）

## seccomp-bpf：让内核替你审查每个 syscall

seccomp 给进程挂一段 **BPF 程序**，内核在**每次进入 syscall** 时执行它，决定：放行 / 返回
错误 / 杀进程。本项目用 [`seccompiler`](https://crates.io/crates/seccompiler) 把规则编译成 BPF。

### 黑名单 vs 白名单

- **白名单**（最安全）：只放行一小撮 syscall，其余全拦。但要枚举程序+libc+运行时需要的所有
  syscall，否则 gcc/python 会莫名挂掉。
- **黑名单**（本项目默认）：默认放行，只拦危险的（`mount`/`ptrace`/`socket`/`reboot`/`bpf`/
  `init_module`…）。不会误伤正常程序，又能演示"危险操作被内核挡下"。

```rust
SeccompFilter::new(
    rules,                 // 危险 syscall → 命中动作
    SeccompAction::Allow,  // 不在名单里 → 放行（黑名单语义）
    match_action,          // Errno(EPERM) 或 KillProcess
    arch,                  // 注意：syscall 号 x86_64 / aarch64 不同！用 libc::SYS_*
)
```

> 安装前必须 `prctl(PR_SET_NO_NEW_PRIVS, 1)`，否则降权后的非特权进程无权装过滤器。
> 这一步也保证进程之后无法通过 setuid 程序"重新拿到"权限来绕过过滤器。

### 两种动作的现象（badsyscall 演示，调用 `mount`）

- `seccomp = errno` → `mount` 返回 `EPERM`，程序自己感知报错 → **RE**（退出码 5）。
- `seccomp = kill` → 内核直接发 **SIGSYS** 杀进程 → **SG**（信号 31）。

## ptrace 追踪模式：看程序"想做什么"

勾上「syscall 追踪」后，引擎走 `ptrace` 单步：

1. child 在 `execve` 前 `ptrace(PTRACE_TRACEME)`，把 supervisor 设为 tracer；
2. supervisor `PTRACE_SETOPTIONS(TRACESYSGOOD)` + 循环 `PTRACE_SYSCALL`，
   在每个 syscall 入口暂停；
3. 用 `/proc/<pid>/syscall` 读 syscall 号（**跨架构**，不必区分 x86/arm 寄存器布局），
   映射成名字推到 Web。

> **坑（本项目踩过）**：seccomp 黑名单里有 `ptrace`，会把 child 自己的 `TRACEME` 也挡掉，
> 导致追踪失效。所以 trace 模式下要把 `ptrace` 从黑名单移除（见 `seccomp::apply` 的 `trace` 参数）。

> trace 模式比正常模式慢很多（每个 syscall 两次停顿），仅用于教学观察，不用于计时判定。

## seccomp vs ptrace 该用谁

| | seccomp-bpf | ptrace |
|---|---|---|
| 在哪判定 | 内核里（快） | 用户态 tracer（慢） |
| 用途 | **执行**策略（拦截/放行） | **观测**/调试（看 syscall 流） |
| 开销 | 极小 | 大（每 syscall 停两次） |

生产沙箱用 seccomp 做强制隔离；ptrace 更适合教学演示与排查。

## 进阶

- **seccomp user-notify**（`SECCOMP_RET_USER_NOTIF`）：兼顾"内核拦截"与"用户态观测/放行"，
  比 ptrace 高效，可替代本项目的 trace 模式。
- 用 BPF 规则**检查参数**（如只允许 `openat` 打开特定目录），而非只看 syscall 号。
