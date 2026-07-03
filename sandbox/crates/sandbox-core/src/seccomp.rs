//! seccomp-bpf 系统调用过滤。
//!
//! 教学要点：seccomp 让我们给进程挂一段 BPF 程序，由**内核**在每次 syscall 入口判定放行/拦截。
//! 这里用**黑名单**策略（默认放行、危险 syscall 拦截），好处是不会误伤 gcc/python 这类
//! 需要大量 syscall 的正常程序，同时仍能演示"某些操作被内核挡下"。
//! （生产评测里也可换成更严格的白名单——把 `mismatch_action` 设为拦截、只 Allow 一小撮。）
//!
//! 用 `seccompiler` 把规则编译成 BPF，再 `apply_filter` 装载。装载前必须打开
//! `PR_SET_NO_NEW_PRIVS`，否则非特权进程无权安装过滤器。

use std::collections::BTreeMap;

use seccompiler::{
    SeccompAction as Act, SeccompCmpArgLen, SeccompCmpOp, SeccompCondition, SeccompFilter,
    SeccompRule, TargetArch,
};

use crate::events::{Event, Phase};
use crate::SeccompAction;

/// 跨 x86_64 / aarch64 都存在的一批"危险" syscall（用 libc::SYS_* 取得各架构正确编号）。
fn dangerous_syscalls() -> Vec<(&'static str, i64)> {
    vec![
        ("mount", libc::SYS_mount),
        ("umount2", libc::SYS_umount2),
        ("pivot_root", libc::SYS_pivot_root),
        ("chroot", libc::SYS_chroot),
        ("setns", libc::SYS_setns),
        ("unshare", libc::SYS_unshare),
        ("ptrace", libc::SYS_ptrace),
        ("process_vm_readv", libc::SYS_process_vm_readv),
        ("process_vm_writev", libc::SYS_process_vm_writev),
        ("pidfd_getfd", libc::SYS_pidfd_getfd),
        ("kcmp", libc::SYS_kcmp),
        ("reboot", libc::SYS_reboot),
        ("kexec_load", libc::SYS_kexec_load),
        ("init_module", libc::SYS_init_module),
        ("finit_module", libc::SYS_finit_module),
        ("delete_module", libc::SYS_delete_module),
        ("add_key", libc::SYS_add_key),
        ("keyctl", libc::SYS_keyctl),
        ("bpf", libc::SYS_bpf),
        ("perf_event_open", libc::SYS_perf_event_open),
        ("userfaultfd", libc::SYS_userfaultfd),
        ("io_uring_setup", libc::SYS_io_uring_setup),
        ("io_uring_enter", libc::SYS_io_uring_enter),
        ("io_uring_register", libc::SYS_io_uring_register),
        ("open_by_handle_at", libc::SYS_open_by_handle_at),
        ("name_to_handle_at", libc::SYS_name_to_handle_at),
        ("fanotify_init", libc::SYS_fanotify_init),
        ("fanotify_mark", libc::SYS_fanotify_mark),
        ("swapon", libc::SYS_swapon),
        ("swapoff", libc::SYS_swapoff),
        ("socket", libc::SYS_socket),
        ("acct", libc::SYS_acct),
    ]
}

/// 白名单：只放行这一小撮 syscall，足够跑动态链接的简单 C 程序与基础 Python。
/// 只用两架构都存在的 SYS_*；x86 专属的 arch_prctl 单独 cfg 补上。
fn allowed_syscalls() -> Vec<i64> {
    #[allow(unused_mut)]
    let mut v = vec![
        // IO
        libc::SYS_read,
        libc::SYS_write,
        libc::SYS_readv,
        libc::SYS_writev,
        libc::SYS_pread64,
        libc::SYS_pwrite64,
        libc::SYS_openat,
        libc::SYS_close,
        libc::SYS_lseek,
        libc::SYS_fcntl,
        libc::SYS_ioctl,
        libc::SYS_dup,
        libc::SYS_dup3,
        libc::SYS_pipe2,
        libc::SYS_getdents64,
        libc::SYS_getcwd,
        libc::SYS_chdir,
        libc::SYS_readlinkat,
        libc::SYS_faccessat,
        // stat 家族
        libc::SYS_fstat,
        libc::SYS_newfstatat,
        libc::SYS_statx,
        // 内存
        libc::SYS_mmap,
        libc::SYS_munmap,
        libc::SYS_mremap,
        libc::SYS_mprotect,
        libc::SYS_brk,
        libc::SYS_madvise,
        // 信号
        libc::SYS_rt_sigaction,
        libc::SYS_rt_sigprocmask,
        libc::SYS_rt_sigreturn,
        libc::SYS_sigaltstack,
        libc::SYS_rt_sigtimedwait,
        libc::SYS_tgkill,
        // 时间 / 调度
        libc::SYS_nanosleep,
        libc::SYS_clock_nanosleep,
        libc::SYS_clock_gettime,
        libc::SYS_clock_getres,
        libc::SYS_gettimeofday,
        libc::SYS_sched_yield,
        libc::SYS_sched_getaffinity,
        libc::SYS_restart_syscall,
        // 进程 / 身份
        libc::SYS_getpid,
        libc::SYS_gettid,
        libc::SYS_getppid,
        libc::SYS_getuid,
        libc::SYS_geteuid,
        libc::SYS_getgid,
        libc::SYS_getegid,
        libc::SYS_exit,
        libc::SYS_exit_group,
        libc::SYS_execve,
        libc::SYS_wait4,
        libc::SYS_set_tid_address,
        libc::SYS_set_robust_list,
        libc::SYS_rseq,
        libc::SYS_futex,
        libc::SYS_prctl,
        libc::SYS_prlimit64,
        libc::SYS_getrlimit,
        // 杂项
        libc::SYS_getrandom,
        libc::SYS_uname,
        libc::SYS_sysinfo,
        libc::SYS_membarrier,
        libc::SYS_ppoll,
        libc::SYS_epoll_create1,
        libc::SYS_epoll_ctl,
        libc::SYS_epoll_pwait,
    ];
    #[cfg(target_arch = "x86_64")]
    {
        v.push(libc::SYS_arch_prctl);
    }
    v
}

#[cfg(target_arch = "x86_64")]
const ARCH: TargetArch = TargetArch::x86_64;
#[cfg(target_arch = "aarch64")]
const ARCH: TargetArch = TargetArch::aarch64;

/// 某个 syscall 名是否在我们的危险黑名单里（供 trace 模式给前端标红用）。
pub fn is_dangerous(name: &str) -> bool {
    dangerous_syscalls().iter().any(|(n, _)| *n == name)
}

/// 在 execve 之前安装 seccomp 过滤器。
///
/// - `allowlist=false`（默认）：黑名单——默认放行、只拦危险 syscall（不误伤 gcc/python）。
/// - `allowlist=true`：白名单——只放行 [`allowed_syscalls`]，其余按 `policy` 处置（更严格，演示"最小权限"）。
/// - `trace=true`：放行 `ptrace`，否则子进程 `PTRACE_TRACEME` 会被自己挡掉。
pub fn apply(
    policy: SeccompAction,
    allowlist: bool,
    trace: bool,
    mut report_line: impl FnMut(Event),
) -> anyhow::Result<Vec<String>> {
    if policy == SeccompAction::Off {
        return Ok(vec![]);
    }

    // 必须先打开 no_new_privs。
    let ret = unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) };
    if ret != 0 {
        anyhow::bail!(
            "prctl(PR_SET_NO_NEW_PRIVS) 失败: {}",
            std::io::Error::last_os_error()
        );
    }

    let violation_action = match policy {
        SeccompAction::Errno => Act::Errno(libc::EPERM as u32),
        SeccompAction::Kill => Act::KillProcess,
        SeccompAction::Off => unreachable!(),
    };
    let action_desc = match policy {
        SeccompAction::Errno => "命中→返回 EPERM",
        SeccompAction::Kill => "命中→杀进程",
        SeccompAction::Off => "",
    };

    let mut rules: BTreeMap<i64, Vec<seccompiler::SeccompRule>> = BTreeMap::new();

    let (filter, names): (SeccompFilter, Vec<String>) = if allowlist {
        // 白名单：放行集合 → Allow；其余 → violation_action。
        let mut allowed = allowed_syscalls();
        if trace {
            allowed.push(libc::SYS_ptrace);
        }
        for nr in &allowed {
            rules.insert(*nr, vec![]);
        }
        let f = SeccompFilter::new(rules, violation_action, Act::Allow, ARCH)
            .map_err(|e| anyhow::anyhow!("构造 seccomp 白名单失败: {e}"))?;
        report_line(Event::step(
            Phase::Security,
            "安装 seccomp-bpf 白名单",
            format!("只放行 {} 个 syscall，其余{action_desc}", allowed.len()),
            "白名单是'最小权限'思路：只允许程序正常运行所必需的少数 syscall，其余一律拦。\
             更安全，但要枚举程序+libc 需要的全部调用，否则会误杀——这正是 nsjail 等用的策略。",
        ));
        (f, vec!["allowlist".to_string()])
    } else {
        // 黑名单：危险集合 → violation_action；其余 → Allow。
        let mut blocked = dangerous_syscalls();
        if trace {
            blocked.retain(|(name, _)| *name != "ptrace");
        }
        for (_name, nr) in &blocked {
            rules.insert(*nr, vec![]);
        }
        // 额外：clone() 带任何"新建命名空间"标志（尤其 CLONE_NEWUSER）→ 拦截。
        // clone 本身必须放行（fork/线程都靠它），所以只按 flags 参数拦命名空间创建，
        // 挡掉"嵌套 user namespace 拿全套 capability、扩大内核攻击面"这条路。
        let ns_flags: [libc::c_int; 7] = [
            libc::CLONE_NEWUSER,
            libc::CLONE_NEWNS,
            libc::CLONE_NEWPID,
            libc::CLONE_NEWNET,
            libc::CLONE_NEWUTS,
            libc::CLONE_NEWIPC,
            libc::CLONE_NEWCGROUP,
        ];
        let clone_rules: Vec<SeccompRule> = ns_flags
            .iter()
            .map(|f| {
                SeccompRule::new(vec![SeccompCondition::new(
                    0,
                    SeccompCmpArgLen::Qword,
                    SeccompCmpOp::MaskedEq(*f as u64),
                    *f as u64,
                )
                .expect("valid clone ns-flag condition")])
                .expect("valid clone ns-flag rule")
            })
            .collect();
        rules.insert(libc::SYS_clone, clone_rules);
        let f = SeccompFilter::new(rules, Act::Allow, violation_action, ARCH)
            .map_err(|e| anyhow::anyhow!("构造 seccomp 黑名单失败: {e}"))?;
        let mut names: Vec<String> = blocked.iter().map(|(n, _)| n.to_string()).collect();
        names.push("clone(命名空间标志)".to_string());
        names.push("clone3→ENOSYS".to_string());
        report_line(Event::step(
            Phase::Security,
            "安装 seccomp-bpf 黑名单",
            format!("拦 {} 个危险 syscall（{action_desc}）: {}", names.len(), names.join(", ")),
            "内核在每次进入 syscall 时跑这段 BPF：放行普通调用，拦截 mount/ptrace/socket 等危险操作。\
             先 prctl(NO_NEW_PRIVS) 才能让降权后的进程也无法绕过。",
        ));
        (f, names)
    };

    let prog: seccompiler::BpfProgram = filter
        .try_into()
        .map_err(|e| anyhow::anyhow!("编译 seccomp BPF 失败: {e}"))?;
    seccompiler::apply_filter(&prog).map_err(|e| anyhow::anyhow!("apply_filter 失败: {e}"))?;

    // 黑名单模式下，再叠一个过滤器把 clone3 挡成 ENOSYS：clone3 的 flags 在结构体里，
    // seccomp 无法解引用指针按参数拦命名空间标志，只能整体挡。返回 ENOSYS 会让 glibc
    // 回退到 clone()（受上面的 flags 过滤约束），线程/fork 仍正常，但走不了 clone3 绕过。
    if !allowlist {
        let mut c3: BTreeMap<i64, Vec<SeccompRule>> = BTreeMap::new();
        c3.insert(libc::SYS_clone3, vec![]);
        let f3 = SeccompFilter::new(c3, Act::Allow, Act::Errno(libc::ENOSYS as u32), ARCH)
            .map_err(|e| anyhow::anyhow!("构造 clone3 过滤器失败: {e}"))?;
        let prog3: seccompiler::BpfProgram = f3
            .try_into()
            .map_err(|e| anyhow::anyhow!("编译 clone3 过滤器失败: {e}"))?;
        seccompiler::apply_filter(&prog3)
            .map_err(|e| anyhow::anyhow!("apply clone3 过滤器失败: {e}"))?;
    }

    Ok(names)
}
