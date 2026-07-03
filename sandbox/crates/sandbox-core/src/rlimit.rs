//! `setrlimit` 资源限制（POSIX，namespace/cgroup 之外的"老办法"）。
//!
//! 教学要点：rlimit 是**每进程**的硬/软上限，靠内核在相应 syscall 处拦截：
//!   - `RLIMIT_AS`    地址空间（mmap/brk 触顶 → 分配失败/被杀）
//!   - `RLIMIT_STACK` 栈大小（深递归触顶 → SIGSEGV）
//!   - `RLIMIT_FSIZE` 单文件写入上限（超出 → SIGXFSZ）
//!   - `RLIMIT_NOFILE`打开文件数
//!   - `RLIMIT_CPU`   CPU 秒（硬上限，作为 supervisor 计时的兜底）
//!   - `RLIMIT_CORE`  core dump 大小（设 0，避免在沙箱里写 core）
//!
//! 与 cgroup 的区别：rlimit 管不住"一整组进程的总量"（fork 出的子进程各算各的），
//! 这正是竞赛评测要上 cgroup 的原因。

use nix::sys::resource::{setrlimit, Resource};

use crate::events::{Event, Phase};
use crate::SandboxConfig;

/// 在 `execve` 之前（已是被隔离子进程内）设置各项 rlimit。
pub fn apply(cfg: &SandboxConfig, report_line: &mut dyn FnMut(Event)) -> anyhow::Result<()> {
    let set = |res: Resource, soft: u64, hard: u64| -> anyhow::Result<()> {
        setrlimit(res, soft, hard).map_err(|e| anyhow::anyhow!("setrlimit({res:?}) 失败: {e}"))
    };

    // core dump 关掉。
    set(Resource::RLIMIT_CORE, 0, 0)?;

    // CPU 秒（向上取整 + 宽限），作为兜底硬限制。
    let cpu_secs = (cfg.cpu_time_ms + cfg.extra_time_ms + 999) / 1000;
    set(Resource::RLIMIT_CPU, cpu_secs.max(1), cpu_secs.max(1) + 1)?;

    set(
        Resource::RLIMIT_STACK,
        cfg.stack_kib * 1024,
        cfg.stack_kib * 1024,
    )?;
    set(
        Resource::RLIMIT_FSIZE,
        cfg.fsize_kib * 1024,
        cfg.fsize_kib * 1024,
    )?;
    set(Resource::RLIMIT_NOFILE, cfg.nofile, cfg.nofile)?;

    let mut detail = format!(
        "CPU={}s STACK={}KiB FSIZE={}KiB NOFILE={} CORE=0",
        cpu_secs, cfg.stack_kib, cfg.fsize_kib, cfg.nofile
    );

    if cfg.use_rlimit_as {
        let as_bytes = cfg.mem_kib * 1024;
        set(Resource::RLIMIT_AS, as_bytes, as_bytes)?;
        detail.push_str(&format!(" AS={}KiB", cfg.mem_kib));
    }

    report_line(Event::step(
        Phase::Limits,
        "setrlimit 设置进程级资源上限",
        detail,
        "rlimit 在子进程内、execve 之前设置；它是每进程的，fork 出的子进程不共享额度，\
         所以总量限制仍要靠 cgroup。",
    ));
    Ok(())
}
