//! # sandbox-core —— 教学型 Linux 沙箱引擎
//!
//! 本 crate **只能在 Linux 上运行**（用到 namespaces / cgroups v2 / seccomp / pivot_root）。
//! 在 Mac 上开发，请在 Docker 特权容器里编译运行（见仓库 README 与 Dockerfile）。
//!
//! 设计参考 IOI 的 [isolate](https://github.com/ioi/isolate)。进程模型：
//!
//! ```text
//! supervisor(本进程, 宿主 ns)
//!   ├─ unshare(CLONE_NEWPID)        // 之后 fork 出的孩子成为新 PID ns 的 PID 1
//!   └─ fork ──► child(PID 1)
//!                 ├─ unshare(NEWNS|NEWNET|NEWIPC|NEWUTS)
//!                 ├─ 建最小 rootfs + pivot_root + mount /proc
//!                 ├─ setrlimit / 降权 / seccomp
//!                 └─ execve(用户程序)
//! supervisor 留在宿主 ns：写 cgroup、计时、采样、超时 SIGKILL、收尸、产出判定。
//! ```
//!
//! 每一步都通过 [`events::Event`] 上报，最终由 Web 前端实时展示"沙箱具体做了什么"。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub mod cgroup;
pub mod events;
pub mod exec;
pub mod fsroot;
pub mod rlimit;
pub mod seccomp;

pub use events::{Event, Phase};

/// seccomp 策略：对危险 syscall 的处置方式。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SeccompAction {
    /// 关闭 seccomp。
    Off,
    /// 危险 syscall 返回 EPERM（程序通常能感知并报错，便于观察）。
    Errno,
    /// 危险 syscall 直接杀进程（判定 SG，演示更直观）。
    Kill,
}

/// 一次沙箱运行的全部配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    /// 宿主侧工作目录；隔离后映射为 `/box`（读写）。被测可执行文件应放在此目录。
    pub box_dir: PathBuf,
    /// 在沙箱内要执行的 argv，例如 `["/box/prog"]` 或 `["/usr/bin/python3", "/box/main.py"]`。
    pub command: Vec<String>,
    /// 传给被测程序的环境变量。
    pub env: Vec<(String, String)>,
    /// 可选 stdin 文件（相对 box_dir 或绝对路径）。
    pub stdin_path: Option<PathBuf>,
    /// 额外 fd 重定向，用于多命令管道；路径在 pivot_root 前打开。
    #[serde(default)]
    pub fd_mappings: Vec<FdMapping>,

    // ---- 资源限制 ----
    /// 墙钟上限（毫秒）。
    pub wall_time_ms: u64,
    /// CPU 时间上限（毫秒）。
    pub cpu_time_ms: u64,
    /// CPU 超时后的宽限（毫秒），用于区分"算得慢"与"死循环"。
    pub extra_time_ms: u64,
    /// 内存上限（KiB）→ cgroup `memory.max`，并可同时设 `RLIMIT_AS`。
    pub mem_kib: u64,
    /// 栈上限（KiB）→ `RLIMIT_STACK`。
    pub stack_kib: u64,
    /// 单文件写入上限（KiB）→ `RLIMIT_FSIZE`。
    pub fsize_kib: u64,
    /// 打开文件数上限 → `RLIMIT_NOFILE`。
    pub nofile: u64,
    /// 进程/线程数上限 → cgroup `pids.max`。
    pub max_procs: u64,

    // ---- 机制开关（便于按里程碑逐项打开、对照学习）----
    /// 是否启用命名空间隔离（mount/pid/net/ipc/uts）。
    pub use_namespaces: bool,
    /// 是否启用 cgroup v2 资源限制与计量。
    pub use_cgroup: bool,
    /// 是否同时用 `RLIMIT_AS` 限制地址空间。
    pub use_rlimit_as: bool,
    /// seccomp 处置动作（Off 时不装过滤器）。
    pub seccomp: SeccompAction,
    /// seccomp 名单语义：true=白名单（只放行一小撮），false=黑名单（只拦危险的）。
    pub seccomp_allowlist: bool,
    /// 是否启用 user namespace（rootless：沙箱内 root 映射到宿主非特权 uid，无需容器 root）。
    pub use_user_ns: bool,
    /// 是否与宿主共享网络（true 则不建 net namespace，程序可联网）。
    pub share_net: bool,
    /// 是否开启 ptrace 系统调用追踪（会显著变慢，仅教学演示用）。
    pub trace: bool,

    /// 降权目标 uid（在容器内以 root 搭建后切到该非特权 uid 再 execve）。
    pub run_uid: u32,
    /// 降权目标 gid。
    pub run_gid: u32,
    /// cgroup 根（容器内被委派的 cgroup v2 子树），默认 `/sys/fs/cgroup`。
    pub cgroup_root: PathBuf,
}

/// 子进程 fd 重定向。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FdMapping {
    pub fd: u32,
    pub path: PathBuf,
    pub mode: FdMode,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FdMode {
    Read,
    Write,
    ReadWrite,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        SandboxConfig {
            box_dir: PathBuf::from("/tmp/box"),
            command: vec![],
            env: vec![
                ("PATH".into(), "/usr/local/bin:/usr/bin:/bin".into()),
                ("HOME".into(), "/box".into()),
            ],
            stdin_path: None,
            fd_mappings: Vec::new(),
            wall_time_ms: 5_000,
            cpu_time_ms: 2_000,
            extra_time_ms: 500,
            mem_kib: 256 * 1024,
            stack_kib: 64 * 1024,
            fsize_kib: 64 * 1024,
            nofile: 64,
            max_procs: 16,
            use_namespaces: true,
            use_cgroup: true,
            use_rlimit_as: false,
            seccomp: SeccompAction::Errno,
            seccomp_allowlist: false,
            use_user_ns: false,
            share_net: false,
            trace: false,
            run_uid: 60000,
            run_gid: 60000,
            cgroup_root: PathBuf::from("/sys/fs/cgroup"),
        }
    }
}

/// isolate 风格的判定状态。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum Status {
    /// 正常退出，返回码 0。
    Ok,
    /// 运行错误：非零退出码。
    Re,
    /// 被信号杀死（非超时/非 OOM）。
    Sg,
    /// 超时（墙钟或 CPU）。
    To,
    /// 内存超限（cgroup OOM 或超 memory.max）。
    Mle,
    /// 沙箱内部错误（搭建失败、配置错误等）。
    Xx,
}

/// 一次运行的最终结果（对应 isolate 的 meta 文件）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxResult {
    pub status: Status,
    /// 正常退出时的返回码。
    pub exit_code: Option<i32>,
    /// 被信号杀死时的信号编号。
    pub exit_signal: Option<i32>,
    /// 是否由沙箱主动杀死（超时/超内存）。
    pub killed: bool,
    /// 墙钟耗时（毫秒）。
    pub wall_time_ms: u64,
    /// CPU 耗时（毫秒，user+sys）。
    pub cpu_time_ms: u64,
    /// 峰值常驻内存（KiB，来自 rusage.ru_maxrss）。
    pub max_rss_kib: u64,
    /// cgroup 记录的内存峰值（KiB，memory.peak）。
    pub cg_mem_kib: u64,
    /// cgroup 是否发生 OOM kill。
    pub cg_oom: bool,
    /// 人类可读说明。
    pub message: String,
}

impl SandboxResult {
    pub fn internal_error(msg: impl Into<String>) -> Self {
        SandboxResult {
            status: Status::Xx,
            exit_code: None,
            exit_signal: None,
            killed: false,
            wall_time_ms: 0,
            cpu_time_ms: 0,
            max_rss_kib: 0,
            cg_mem_kib: 0,
            cg_oom: false,
            message: msg.into(),
        }
    }
}

/// 运行一次沙箱。`report` 会在事件发生时被同步回调。
///
/// 注意：调用本函数的进程会 `unshare(CLONE_NEWPID)` 并 `fork`，因此**必须是单线程进程**
/// （在 `sandbox-web` 中，引擎是被作为独立子进程 `sandbox-cli` 拉起的，天然单线程）。
pub fn run(config: &SandboxConfig, report: events::Reporter) -> SandboxResult {
    match exec::run_sandbox(config, report) {
        Ok(result) => result,
        Err(e) => {
            let r = SandboxResult::internal_error(format!("{e:#}"));
            report(Event::Error {
                message: r.message.clone(),
            });
            r
        }
    }
}
