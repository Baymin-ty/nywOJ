//! 监督进程（supervisor）与被隔离进程（child）的编排——沙箱引擎的心脏。
//!
//! 进程模型见 crate 顶部文档。关键时序（带 cgroup 与命名空间）：
//!   supervisor: 建 cgroup → 建管道 → `unshare(NEWPID)` → `fork`
//!   child:      等待放行 → `unshare(NEWNS|NEWNET|NEWIPC|NEWUTS)` → 重定向 stdio →
//!               建 rootfs+`pivot_root` → `setrlimit` → 降权 → `seccomp` → `execve`
//!   supervisor: 把 child 放进 cgroup → 放行 child → poll 三条管道 + 周期采样 +
//!               超时 `SIGKILL` → `wait4` 收尸 → 读 cgroup 峰值/OOM → 产出判定

use std::ffi::CString;
use std::os::unix::io::RawFd;
use std::time::Instant;

use nix::sched::{unshare, CloneFlags};

use crate::cgroup::Cgroup;
use crate::events::{Event, Phase};
use crate::{FdMode, SandboxConfig, SandboxResult, Status};

// ---------------------------------------------------------------------------
// 低层 fd / 进程辅助（直接用 libc，语义最清晰，便于教学）
// ---------------------------------------------------------------------------

struct Pipe {
    r: RawFd,
    w: RawFd,
}

fn make_pipe() -> anyhow::Result<Pipe> {
    let mut fds = [0i32; 2];
    let rc = unsafe { libc::pipe2(fds.as_mut_ptr(), 0) };
    if rc != 0 {
        anyhow::bail!("pipe2 失败: {}", std::io::Error::last_os_error());
    }
    Ok(Pipe {
        r: fds[0],
        w: fds[1],
    })
}

fn set_nonblock(fd: RawFd) {
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFL, 0);
        libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
    }
}

fn set_cloexec(fd: RawFd) {
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFD, 0);
        libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC);
    }
}

fn close_fd(fd: RawFd) {
    if fd >= 0 {
        unsafe {
            libc::close(fd);
        }
    }
}

fn protect_event_fd(cfg: &SandboxConfig, ev_w: RawFd) -> anyhow::Result<RawFd> {
    if !cfg.fd_mappings.iter().any(|m| m.fd as RawFd == ev_w) {
        set_cloexec(ev_w);
        return Ok(ev_w);
    }
    let new_fd = unsafe { libc::fcntl(ev_w, libc::F_DUPFD_CLOEXEC, 256) };
    if new_fd < 0 {
        anyhow::bail!(
            "移动事件 fd {} 失败: {}",
            ev_w,
            std::io::Error::last_os_error()
        );
    }
    close_fd(ev_w);
    Ok(new_fd)
}

fn write_all(fd: RawFd, buf: &[u8]) {
    let mut off = 0;
    while off < buf.len() {
        let n = unsafe { libc::write(fd, buf[off..].as_ptr() as *const _, buf.len() - off) };
        if n <= 0 {
            break;
        }
        off += n as usize;
    }
}

/// 从 /proc/<pid>/stat 读主进程 CPU 时间（utime+stime），毫秒。仅用于实时采样的近似值。
fn read_proc_cpu_ms(pid: i32) -> u64 {
    let Ok(s) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
        return 0;
    };
    // 字段 14(utime) 15(stime)，但 comm 可能含空格/括号，先跳到最后一个 ')'。
    let Some(rparen) = s.rfind(')') else { return 0 };
    let rest: Vec<&str> = s[rparen + 1..].split_whitespace().collect();
    // rest[0] 是 state，对应原始字段 3；utime=字段14 → rest[11]，stime=字段15 → rest[12]。
    if rest.len() < 13 {
        return 0;
    }
    let utime: u64 = rest[11].parse().unwrap_or(0);
    let stime: u64 = rest[12].parse().unwrap_or(0);
    let hz = unsafe { libc::sysconf(libc::_SC_CLK_TCK) } as u64;
    let hz = if hz == 0 { 100 } else { hz };
    (utime + stime) * 1000 / hz
}

fn cpu_ms_from_rusage(ru: &libc::rusage) -> u64 {
    let u = ru.ru_utime.tv_sec as u64 * 1000 + ru.ru_utime.tv_usec as u64 / 1000;
    let s = ru.ru_stime.tv_sec as u64 * 1000 + ru.ru_stime.tv_usec as u64 / 1000;
    u + s
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

pub fn run_sandbox(
    cfg: &SandboxConfig,
    report: &mut dyn FnMut(Event),
) -> anyhow::Result<SandboxResult> {
    if cfg.command.is_empty() {
        anyhow::bail!("command 为空");
    }

    report(Event::step(
        Phase::Setup,
        "开始搭建沙箱",
        format!(
            "argv={:?}  namespaces={}  cgroup={}  seccomp={:?}  trace={}",
            cfg.command, cfg.use_namespaces, cfg.use_cgroup, cfg.seccomp, cfg.trace
        ),
        "下面每一步都会实时上报。这是 isolate 三段式中的 --run：先把'笼子'搭好，再 execve 用户程序。",
    ));

    // 1) cgroup（失败自动降级）。
    let cg = Cgroup::create(cfg, report);

    // 2) 管道：events(child→sv)、stdout、stderr、sync(sv→child)。
    let ev = make_pipe()?;
    let out = make_pipe()?;
    let err = make_pipe()?;
    let sync = make_pipe()?;

    // 3) stdin 源。
    let stdin_fd = open_stdin(cfg);

    // userns（rootless）模式：用 user namespace，把沙箱内 root 映射到宿主非特权 uid。
    let userns = cfg.use_namespaces && cfg.use_user_ns;
    // usrns 管道：userns 模式下 child 通知 supervisor"我已 unshare userns，请写 uid_map"。
    let usrns = make_pipe()?;

    // 4) 非 userns：NEWPID 须在 fork 前 unshare，fork 出的孩子才是新 PID ns 的 PID 1。
    //    userns 模式由 child 自己 unshare(NEWUSER|NEWPID|…)，使 pidns 归新 userns 所有（才能挂私有 /proc）。
    if cfg.use_namespaces && !userns {
        unshare(CloneFlags::CLONE_NEWPID).map_err(|e| {
            anyhow::anyhow!("unshare(CLONE_NEWPID) 失败: {e}（需要在特权容器内运行）")
        })?;
        report(Event::step(
            Phase::Namespace,
            "unshare(CLONE_NEWPID)",
            "为接下来 fork 的子进程开一个新的 PID namespace",
            "unshare(NEWPID) 不改变调用者本身，而是让它之后 fork 的孩子成为新命名空间里的 PID 1。",
        ));
    }

    // 5) fork。
    let pid = unsafe { libc::fork() };
    if pid < 0 {
        anyhow::bail!("fork 失败: {}", std::io::Error::last_os_error());
    }

    if pid == 0 {
        // ---- 子进程：永不返回 ----
        close_fd(ev.r);
        close_fd(out.r);
        close_fd(err.r);
        close_fd(sync.w);
        close_fd(usrns.r);
        if userns {
            child_userns(cfg, ev.w, out.w, err.w, sync.r, usrns.w, stdin_fd);
        } else {
            close_fd(usrns.w);
            child_exec(cfg, ev.w, out.w, err.w, sync.r, stdin_fd);
        }
    }

    // ---- 父进程（supervisor）----
    let child_pid = pid;
    close_fd(ev.w);
    close_fd(out.w);
    close_fd(err.w);
    close_fd(sync.r);
    close_fd(usrns.w);
    close_fd(stdin_fd);

    report(Event::step(
        Phase::Setup,
        "fork 出被隔离进程",
        format!("child host-pid={child_pid}"),
        "supervisor 留在宿主命名空间，负责写 cgroup、计时、采样、超时杀进程、收尸。",
    ));

    // 6) userns：等 child 报告已 unshare userns，再从宿主侧写它的 uid_map/gid_map。
    if userns {
        let mut b = [0u8; 1];
        unsafe {
            libc::read(usrns.r, b.as_mut_ptr() as *mut _, 1);
        }
        close_fd(usrns.r);
        write_uid_maps(child_pid, cfg.run_uid, cfg.run_gid, report);
    } else {
        close_fd(usrns.r);
    }

    // 7) 把 child 放进 cgroup（在它干重活之前）。
    if cg.enabled {
        if let Err(e) = cg.add_pid(child_pid) {
            report(Event::step(
                Phase::Limits,
                "把进程放进 cgroup 失败",
                format!("写 cgroup.procs 失败: {e}"),
                "限额可能不生效；继续运行。",
            ));
        } else {
            report(Event::step(
                Phase::Limits,
                "把进程放进 cgroup",
                format!("echo {child_pid} > run_*/cgroup.procs"),
                "从这一刻起，它及其所有子孙的内存/进程数都受这个 cgroup 约束。",
            ));
        }
    }

    // 8) 放行 child（写 1 字节到 sync）。
    write_all(sync.w, b"go");
    close_fd(sync.w);

    // 9) 监督。trace 与 userns 不兼容（userns 下真正的被测进程是 grandchild，
    //    不是 supervisor 的直接子进程，无法 ptrace）。
    let result = if cfg.trace && !userns {
        supervise_traced(cfg, &cg, child_pid, ev.r, out.r, err.r, report)
    } else {
        supervise_normal(cfg, &cg, child_pid, ev.r, out.r, err.r, report)
    };

    cg.cleanup();
    Ok(result)
}

/// supervisor 侧：从宿主写 child 的 uid/gid 映射（child 已 unshare 了 user namespace）。
fn write_uid_maps(child_pid: i32, run_uid: u32, run_gid: u32, report: &mut dyn FnMut(Event)) {
    // 写 gid_map 前必须先 deny setgroups（内核要求，防止用映射绕过组权限检查）。
    let _ = std::fs::write(format!("/proc/{child_pid}/setgroups"), "deny");
    let uid_ok = std::fs::write(
        format!("/proc/{child_pid}/uid_map"),
        format!("0 {run_uid} 1\n"),
    )
    .is_ok();
    let gid_ok = std::fs::write(
        format!("/proc/{child_pid}/gid_map"),
        format!("0 {run_gid} 1\n"),
    )
    .is_ok();
    report(Event::step(
        Phase::Namespace,
        "写 uid_map / gid_map（rootless 关键）",
        format!("uid_map='0 {run_uid} 1' gid_map='0 {run_gid} 1'  (ok={uid_ok}/{gid_ok})",),
        "把沙箱内的 root(0) 映射到宿主的非特权 uid。于是程序在沙箱里'是 root'、能搭建命名空间，\
         但在宿主看来只是普通用户——这就是 rootless 容器的核心，不需要真正的宿主 root。",
    ));
}

fn open_stdin(cfg: &SandboxConfig) -> RawFd {
    let path = match &cfg.stdin_path {
        Some(p) if p.is_absolute() => p.clone(),
        Some(p) => cfg.box_dir.join(p),
        None => std::path::PathBuf::from("/dev/null"),
    };
    let cpath = CString::new(path.to_string_lossy().as_bytes()).unwrap();
    let fd = unsafe { libc::open(cpath.as_ptr(), libc::O_RDONLY) };
    if fd < 0 {
        let devnull = CString::new("/dev/null").unwrap();
        unsafe { libc::open(devnull.as_ptr(), libc::O_RDONLY) }
    } else {
        fd
    }
}

// ---------------------------------------------------------------------------
// 子进程：搭建隔离环境并 execve
// ---------------------------------------------------------------------------

fn child_exec(
    cfg: &SandboxConfig,
    ev_w: RawFd,
    out_w: RawFd,
    err_w: RawFd,
    sync_r: RawFd,
    stdin_fd: RawFd,
) -> ! {
    let ev_w = match protect_event_fd(cfg, ev_w) {
        Ok(fd) => fd,
        Err(e) => {
            let mut line = Event::Error {
                message: format!("沙箱搭建失败: {e:#}"),
            }
            .to_line();
            line.push('\n');
            write_all(ev_w, line.as_bytes());
            unsafe { libc::_exit(112) }
        }
    };
    let mut emit = move |e: Event| {
        let mut line = e.to_line();
        line.push('\n');
        write_all(ev_w, line.as_bytes());
    };

    match child_setup(cfg, &mut emit, out_w, err_w, sync_r, stdin_fd) {
        Ok(()) => unreachable!("execve 成功不会返回"),
        Err(e) => {
            emit(Event::Error {
                message: format!("沙箱搭建失败: {e:#}"),
            });
            unsafe { libc::_exit(112) }
        }
    }
}

fn child_setup(
    cfg: &SandboxConfig,
    emit: &mut dyn FnMut(Event),
    out_w: RawFd,
    err_w: RawFd,
    sync_r: RawFd,
    stdin_fd: RawFd,
) -> anyhow::Result<()> {
    // 等 supervisor 放行（它要先把我们放进 cgroup）。
    wait_go(sync_r);

    // 其余命名空间（NEWPID 已由父进程 unshare）。
    if cfg.use_namespaces {
        let mut flags =
            CloneFlags::CLONE_NEWNS | CloneFlags::CLONE_NEWIPC | CloneFlags::CLONE_NEWUTS;
        if !cfg.share_net {
            flags |= CloneFlags::CLONE_NEWNET;
        }
        unshare(flags).map_err(|e| anyhow::anyhow!("unshare(其余命名空间) 失败: {e}"))?;
        emit(Event::step(
            Phase::Namespace,
            "unshare 其余命名空间",
            format!(
                "CLONE_NEWNS | CLONE_NEWIPC | CLONE_NEWUTS{}",
                if cfg.share_net { "（共享宿主网络）" } else { " | CLONE_NEWNET" }
            ),
            "mount(文件系统视图)、ipc(独立 IPC)、uts(独立主机名)；NEWNET 让网络只剩 loopback=断网（关闭则与宿主共享网络）。",
        ));
    }

    redirect_stdio(out_w, err_w, stdin_fd);
    apply_fd_mappings(cfg, emit)?;
    setup_and_exec(cfg, emit, true, cfg.trace)
}

/// userns（rootless）路径：child 自建 user + pid 命名空间，等 supervisor 写好映射后，
/// 再 fork 一个 grandchild 作为新 pidns 的 PID 1，由它搭建并 execve；child 中继其退出状态。
fn child_userns(
    cfg: &SandboxConfig,
    ev_w: RawFd,
    out_w: RawFd,
    err_w: RawFd,
    sync_r: RawFd,
    usrns_w: RawFd,
    stdin_fd: RawFd,
) -> ! {
    let ev_w = match protect_event_fd(cfg, ev_w) {
        Ok(fd) => fd,
        Err(e) => {
            let mut line = Event::Error {
                message: format!("沙箱搭建失败(userns): {e:#}"),
            }
            .to_line();
            line.push('\n');
            write_all(ev_w, line.as_bytes());
            unsafe { libc::_exit(112) }
        }
    };
    let mut emit = move |e: Event| {
        let mut line = e.to_line();
        line.push('\n');
        write_all(ev_w, line.as_bytes());
    };
    match child_userns_setup(cfg, &mut emit, out_w, err_w, sync_r, usrns_w, stdin_fd) {
        Ok(()) => unreachable!(),
        Err(e) => {
            emit(Event::Error {
                message: format!("沙箱搭建失败(userns): {e:#}"),
            });
            unsafe { libc::_exit(112) }
        }
    }
}

fn child_userns_setup(
    cfg: &SandboxConfig,
    emit: &mut dyn FnMut(Event),
    out_w: RawFd,
    err_w: RawFd,
    sync_r: RawFd,
    usrns_w: RawFd,
    stdin_fd: RawFd,
) -> anyhow::Result<()> {
    // 真正的 rootless：先把自己降到宿主非特权 uid，再 unshare(NEWUSER)。
    // 配合 supervisor 写 "0 run_uid 1" 映射，进程在沙箱内就是 root(0)、在宿主看只是普通用户。
    // （若不先降权，映射后进程的宿主 uid=0 不在映射范围内 → 沙箱内显示为 nobody(65534)。）
    if unsafe { libc::geteuid() } == 0 && cfg.run_uid != 0 {
        unsafe {
            libc::setgroups(0, std::ptr::null());
            libc::setgid(cfg.run_gid);
            libc::setuid(cfg.run_uid);
        }
    }

    let mut flags = CloneFlags::CLONE_NEWUSER
        | CloneFlags::CLONE_NEWNS
        | CloneFlags::CLONE_NEWPID
        | CloneFlags::CLONE_NEWIPC
        | CloneFlags::CLONE_NEWUTS;
    if !cfg.share_net {
        flags |= CloneFlags::CLONE_NEWNET;
    }
    unshare(flags).map_err(|e| anyhow::anyhow!("unshare(NEWUSER|NEWPID|NEWNS|…) 失败: {e}"))?;
    emit(Event::step(
        Phase::Namespace,
        "unshare user + pid + 其余命名空间",
        "CLONE_NEWUSER | CLONE_NEWPID | CLONE_NEWNS | CLONE_NEWIPC | CLONE_NEWUTS(+NEWNET)",
        "先建 user namespace：此刻进程在新 userns 里拥有全部 capability（但 uid 还没映射）。\
         同时建 pidns 使其归该 userns 所有——这样 rootless 下才能挂私有 /proc。",
    ));

    // 通知 supervisor 写 uid/gid 映射，然后等放行。
    write_all(usrns_w, b"u");
    close_fd(usrns_w);
    wait_go(sync_r);

    // fork grandchild = 新 pidns 的 PID 1。
    let g = unsafe { libc::fork() };
    if g < 0 {
        anyhow::bail!("fork(grandchild) 失败: {}", std::io::Error::last_os_error());
    }
    if g == 0 {
        redirect_stdio(out_w, err_w, stdin_fd);
        if let Err(e) = apply_fd_mappings(cfg, emit) {
            emit(Event::Error {
                message: format!("fd 重定向失败: {e:#}"),
            });
            unsafe { libc::_exit(112) }
        }
        match setup_and_exec(cfg, emit, false, false) {
            Ok(()) => unreachable!(),
            Err(e) => {
                emit(Event::Error {
                    message: format!("沙箱搭建失败(grandchild): {e:#}"),
                });
                unsafe { libc::_exit(112) }
            }
        }
    }

    // child（中继）：等 grandchild，镜像其退出状态，让 supervisor 拿到正确判定。
    if out_w > 2 {
        close_fd(out_w);
    }
    if err_w > 2 {
        close_fd(err_w);
    }
    close_fd(stdin_fd);
    let mut st: libc::c_int = 0;
    unsafe { libc::waitpid(g, &mut st, 0) };
    if libc::WIFEXITED(st) {
        unsafe { libc::_exit(libc::WEXITSTATUS(st)) };
    }
    if libc::WIFSIGNALED(st) {
        let sig = libc::WTERMSIG(st);
        unsafe {
            libc::signal(sig as libc::c_int, libc::SIG_DFL);
            libc::raise(sig as libc::c_int);
            libc::_exit(128 + sig)
        };
    }
    unsafe { libc::_exit(0) };
}

/// 进入隔离命名空间后的公共收尾：rootfs → rlimit →（可选）降权 → 快照 → seccomp →（可选）TRACEME → execve。
fn setup_and_exec(
    cfg: &SandboxConfig,
    emit: &mut dyn FnMut(Event),
    do_drop: bool,
    allow_trace: bool,
) -> anyhow::Result<()> {
    // 文件系统隔离。
    if cfg.use_namespaces {
        crate::fsroot::setup(cfg, &mut *emit)?;
    } else {
        let dir = CString::new(cfg.box_dir.to_string_lossy().as_bytes())?;
        if unsafe { libc::chdir(dir.as_ptr()) } != 0 {
            anyhow::bail!(
                "chdir({}) 失败: {}",
                cfg.box_dir.display(),
                std::io::Error::last_os_error()
            );
        }
    }

    // 资源限制。
    crate::rlimit::apply(cfg, emit)?;

    // 降权（userns 模式不在此降权：沙箱内 root 已被映射到宿主非特权 uid）。
    if do_drop {
        let euid = unsafe { libc::geteuid() };
        if euid == 0 && cfg.run_uid != 0 {
            unsafe {
                libc::setgroups(0, std::ptr::null());
                if libc::setgid(cfg.run_gid) != 0 {
                    anyhow::bail!(
                        "setgid({}) 失败: {}",
                        cfg.run_gid,
                        std::io::Error::last_os_error()
                    );
                }
                if libc::setuid(cfg.run_uid) != 0 {
                    anyhow::bail!(
                        "setuid({}) 失败: {}",
                        cfg.run_uid,
                        std::io::Error::last_os_error()
                    );
                }
            }
            emit(Event::step(
                Phase::Security,
                "降权到非特权用户",
                format!("setgroups([]) → setgid({}) → setuid({})", cfg.run_gid, cfg.run_uid),
                "搭建笼子需要 root，但被测程序必须以普通用户跑。顺序固定：先弃附加组，再 gid，最后 uid。",
            ));
        }
    }

    // 快照：被测程序真实看到的根/挂载/网卡（隔离视图数据来源）。
    if cfg.use_namespaces {
        emit(crate::fsroot::snapshot());
    }

    // seccomp。
    crate::seccomp::apply(cfg.seccomp, cfg.seccomp_allowlist, allow_trace, &mut *emit)?;

    // trace 模式：execve 前让自己被 ptrace。
    if allow_trace {
        unsafe {
            libc::ptrace(libc::PTRACE_TRACEME, 0, 0, 0);
        }
    }

    // 构造 argv / envp 并 execve。
    let path = CString::new(cfg.command[0].as_bytes())?;
    let argv: Vec<CString> = cfg
        .command
        .iter()
        .map(|s| CString::new(s.as_bytes()).unwrap())
        .collect();
    let envp: Vec<CString> = cfg
        .env
        .iter()
        .map(|(k, v)| CString::new(format!("{k}={v}")).unwrap())
        .collect();
    let mut argv_p: Vec<*const libc::c_char> = argv.iter().map(|c| c.as_ptr()).collect();
    argv_p.push(std::ptr::null());
    let mut envp_p: Vec<*const libc::c_char> = envp.iter().map(|c| c.as_ptr()).collect();
    envp_p.push(std::ptr::null());

    emit(Event::step(
        Phase::Run,
        "execve 启动被测程序",
        format!("execve({:?})", cfg.command),
        "笼子搭好，正式把进程映像换成用户程序。从这一刻起它在所有限制之下运行。",
    ));

    unsafe {
        libc::execve(path.as_ptr(), argv_p.as_ptr(), envp_p.as_ptr());
    }
    anyhow::bail!(
        "execve({}) 失败: {}",
        cfg.command[0],
        std::io::Error::last_os_error()
    );
}

fn wait_go(sync_r: RawFd) {
    let mut b = [0u8; 2];
    unsafe {
        libc::read(sync_r, b.as_mut_ptr() as *mut _, b.len());
    }
    close_fd(sync_r);
}

fn redirect_stdio(out_w: RawFd, err_w: RawFd, stdin_fd: RawFd) {
    unsafe {
        libc::dup2(stdin_fd, 0);
        libc::dup2(out_w, 1);
        libc::dup2(err_w, 2);
    }
    close_fd(stdin_fd);
    if out_w > 2 {
        close_fd(out_w);
    }
    if err_w > 2 {
        close_fd(err_w);
    }
}

fn apply_fd_mappings(cfg: &SandboxConfig, emit: &mut dyn FnMut(Event)) -> anyhow::Result<()> {
    for mode in [FdMode::Read, FdMode::ReadWrite, FdMode::Write] {
        for mapping in cfg.fd_mappings.iter().filter(|m| m.mode == mode) {
            if mapping.fd > 255 {
                anyhow::bail!("非法 fd: {}", mapping.fd);
            }
            let path = if mapping.path.is_absolute() {
                mapping.path.clone()
            } else {
                cfg.box_dir.join(&mapping.path)
            };
            let fd = open_mapped_fd(&path, mapping.mode)?;
            let target = mapping.fd as RawFd;
            if fd != target {
                let rc = unsafe { libc::dup2(fd, target) };
                close_fd(fd);
                if rc < 0 {
                    anyhow::bail!(
                        "dup2({}, {}) 失败: {}",
                        path.display(),
                        target,
                        std::io::Error::last_os_error()
                    );
                }
            }
            emit(Event::step(
                Phase::Setup,
                "重定向额外 fd",
                format!("fd{} <- {:?} {}", mapping.fd, mapping.mode, path.display()),
                "多命令管道通过宿主侧 FIFO 连接多个沙箱进程；路径在 pivot_root 前打开，exec 后用户程序只看到 fd。",
            ));
        }
    }
    Ok(())
}

fn open_mapped_fd(path: &std::path::Path, mode: FdMode) -> anyhow::Result<RawFd> {
    let cpath = CString::new(path.to_string_lossy().as_bytes())?;
    let flags = match mode {
        FdMode::Read => libc::O_RDONLY | libc::O_NONBLOCK,
        FdMode::Write => libc::O_WRONLY | libc::O_NONBLOCK,
        FdMode::ReadWrite => libc::O_RDWR | libc::O_NONBLOCK,
    };
    let mut last_err = std::io::Error::from_raw_os_error(0);
    for _ in 0..500 {
        let fd = unsafe { libc::open(cpath.as_ptr(), flags, 0o666) };
        if fd >= 0 {
            let old = unsafe { libc::fcntl(fd, libc::F_GETFL, 0) };
            if old >= 0 {
                unsafe {
                    libc::fcntl(fd, libc::F_SETFL, old & !libc::O_NONBLOCK);
                }
            }
            return Ok(fd);
        }
        last_err = std::io::Error::last_os_error();
        let raw = last_err.raw_os_error().unwrap_or(0);
        if raw != libc::ENXIO && raw != libc::EAGAIN && raw != libc::EINTR {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    anyhow::bail!(
        "open fd mapping {} ({:?}) 失败: {}",
        path.display(),
        mode,
        last_err
    )
}

// ---------------------------------------------------------------------------
// 监督：普通模式（poll 三条管道 + 周期采样 + 超时）
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn supervise_normal(
    cfg: &SandboxConfig,
    cg: &Cgroup,
    child_pid: i32,
    ev_r: RawFd,
    out_r: RawFd,
    err_r: RawFd,
    report: &mut dyn FnMut(Event),
) -> SandboxResult {
    set_nonblock(ev_r);
    set_nonblock(out_r);
    set_nonblock(err_r);

    let start = Instant::now();
    let wall_limit = cfg.wall_time_ms + cfg.extra_time_ms;
    let cpu_limit = cfg.cpu_time_ms + cfg.extra_time_ms;

    let mut ev_buf = String::new();
    let mut child_error: Option<String> = None;
    let mut timed_out = false;
    let mut last_sample = Instant::now();
    let mut peak_kib = 0u64;

    let mut status: libc::c_int = 0;
    let mut rusage: libc::rusage = unsafe { std::mem::zeroed() };
    let mut reaped = false;

    let mut fds = [ev_r, out_r, err_r];

    loop {
        let mut pollfds: Vec<libc::pollfd> = fds
            .iter()
            .filter(|&&f| f >= 0)
            .map(|&f| libc::pollfd {
                fd: f,
                events: libc::POLLIN,
                revents: 0,
            })
            .collect();

        if !pollfds.is_empty() {
            unsafe {
                libc::poll(pollfds.as_mut_ptr(), pollfds.len() as libc::nfds_t, 50);
            }
            for pfd in &pollfds {
                if pfd.revents == 0 {
                    continue;
                }
                if pfd.fd == ev_r {
                    if drain_events(ev_r, &mut ev_buf, &mut child_error, report) {
                        mark_closed(&mut fds, ev_r);
                    }
                } else if pfd.fd == out_r {
                    if drain_output(out_r, report, true) {
                        mark_closed(&mut fds, out_r);
                    }
                } else if pfd.fd == err_r {
                    if drain_output(err_r, report, false) {
                        mark_closed(&mut fds, err_r);
                    }
                }
            }
        }

        // 周期采样 + 超时检查。
        if last_sample.elapsed().as_millis() >= 50 {
            last_sample = Instant::now();
            let (mem, peak, procs) = if cg.enabled { cg.sample() } else { (0, 0, 0) };
            peak_kib = peak_kib.max(peak).max(mem);
            // 整组 CPU 时间优先（含 fork 出来的所有子孙）；cgroup 不可用时退回主进程近似值。
            let cpu_ms = cg
                .cpu_usage_ms()
                .unwrap_or_else(|| read_proc_cpu_ms(child_pid));
            report(Event::ResourceSample {
                t_ms: start.elapsed().as_millis() as u64,
                mem_kib: mem,
                peak_kib,
                cpu_ms,
                procs,
            });

            let wall = start.elapsed().as_millis() as u64;
            if wall > wall_limit && !reaped {
                timed_out = true;
                report(Event::step(
                    Phase::Run,
                    "墙钟超时，杀死进程",
                    format!("wall={wall}ms > limit={wall_limit}ms"),
                    "supervisor 用 cgroup.kill 一键杀掉整组进程（含 fork 出来的子孙）。",
                ));
                cg.kill_all();
                unsafe { libc::kill(child_pid, libc::SIGKILL) };
            } else if cpu_ms > cpu_limit && !reaped {
                timed_out = true;
                report(Event::step(
                    Phase::Run,
                    "CPU 超时，杀死进程",
                    format!("cpu={cpu_ms}ms > limit={cpu_limit}ms"),
                    "区分'算得慢'（墙钟）与'真在烧 CPU'（CPU 时间）是评测系统的关键。",
                ));
                cg.kill_all();
                unsafe { libc::kill(child_pid, libc::SIGKILL) };
            }
        }

        // 收尸（非阻塞）。
        if !reaped {
            let r = unsafe { libc::wait4(child_pid, &mut status, libc::WNOHANG, &mut rusage) };
            if r == child_pid {
                reaped = true;
            }
        }

        // 收尸完成且管道都 EOF → 结束。
        if reaped && fds.iter().all(|&f| f < 0) {
            break;
        }
        // 兜底：进程已退出但管道迟迟不 EOF，做几次零超时 drain 后退出。
        if reaped && start.elapsed().as_millis() as u64 > wall_limit + 1000 {
            break;
        }
    }

    // 最终统计。整组 CPU 时间（cgroup）优先，与实时超时判断口径一致，并防止只 wait 部分
    // 子进程导致 rusage 少算；两者取大，绝不少报。
    let wall_time_ms = start.elapsed().as_millis() as u64;
    let rusage_cpu_ms = cpu_ms_from_rusage(&rusage);
    let cpu_time_ms = cg
        .cpu_usage_ms()
        .map(|c| c.max(rusage_cpu_ms))
        .unwrap_or(rusage_cpu_ms);
    let max_rss_kib = rusage.ru_maxrss.max(0) as u64; // Linux 上单位是 KiB
    let cg_peak = if cg.enabled {
        cg.peak_kib().max(peak_kib)
    } else {
        peak_kib
    };
    let oom = cg.enabled && cg.oom_killed();

    let result = classify(
        &child_error,
        status,
        timed_out,
        oom,
        wall_time_ms,
        cpu_time_ms,
        max_rss_kib,
        cg_peak,
    );
    report(Event::Result(result.clone()));
    result
}

fn mark_closed(fds: &mut [RawFd], target: RawFd) {
    for f in fds.iter_mut() {
        if *f == target {
            close_fd(*f);
            *f = -1;
        }
    }
}

/// 读 events 管道、按行解析转发；返回 true 表示 EOF。
fn drain_events(
    fd: RawFd,
    buf: &mut String,
    child_error: &mut Option<String>,
    report: &mut dyn FnMut(Event),
) -> bool {
    let mut tmp = [0u8; 4096];
    loop {
        let n = unsafe { libc::read(fd, tmp.as_mut_ptr() as *mut _, tmp.len()) };
        if n > 0 {
            buf.push_str(&String::from_utf8_lossy(&tmp[..n as usize]));
            while let Some(idx) = buf.find('\n') {
                let line: String = buf.drain(..=idx).collect();
                let line = line.trim_end();
                if line.is_empty() {
                    continue;
                }
                match serde_json::from_str::<Event>(line) {
                    Ok(ev) => {
                        if let Event::Error { message } = &ev {
                            *child_error = Some(message.clone());
                        }
                        report(ev);
                    }
                    Err(_) => report(Event::Stderr {
                        data: format!("[bad-event] {line}\n"),
                    }),
                }
            }
        } else if n == 0 {
            return true;
        } else {
            return false; // EAGAIN
        }
    }
}

/// 读 stdout/stderr 管道并转发；返回 true 表示 EOF。
fn drain_output(fd: RawFd, report: &mut dyn FnMut(Event), is_stdout: bool) -> bool {
    let mut tmp = [0u8; 8192];
    loop {
        let n = unsafe { libc::read(fd, tmp.as_mut_ptr() as *mut _, tmp.len()) };
        if n > 0 {
            let data = String::from_utf8_lossy(&tmp[..n as usize]).to_string();
            if is_stdout {
                report(Event::Stdout { data });
            } else {
                report(Event::Stderr { data });
            }
        } else if n == 0 {
            return true;
        } else {
            return false;
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn classify(
    child_error: &Option<String>,
    status: libc::c_int,
    timed_out: bool,
    oom: bool,
    wall_time_ms: u64,
    cpu_time_ms: u64,
    max_rss_kib: u64,
    cg_mem_kib: u64,
) -> SandboxResult {
    let mut exit_code = None;
    let mut exit_signal = None;
    let (st, msg);

    if let Some(e) = child_error {
        st = Status::Xx;
        msg = format!("沙箱内部错误: {e}");
    } else if oom {
        st = Status::Mle;
        msg = "内存超限：cgroup 触发 OOM kill".into();
    } else if timed_out {
        st = Status::To;
        msg = "超时：被沙箱杀死".into();
    } else if libc::WIFEXITED(status) {
        let code = libc::WEXITSTATUS(status);
        exit_code = Some(code);
        if code == 0 {
            st = Status::Ok;
            msg = "正常退出".into();
        } else if code == 112 {
            st = Status::Xx;
            msg = "沙箱搭建失败（子进程以 112 退出）".into();
        } else {
            st = Status::Re;
            msg = format!("运行错误：退出码 {code}");
        }
    } else if libc::WIFSIGNALED(status) {
        let sig = libc::WTERMSIG(status);
        exit_signal = Some(sig);
        st = Status::Sg;
        msg = format!("被信号 {sig} 杀死");
    } else {
        st = Status::Xx;
        msg = "未知终止状态".into();
    }

    SandboxResult {
        status: st,
        exit_code,
        exit_signal,
        killed: timed_out || oom,
        wall_time_ms,
        cpu_time_ms,
        max_rss_kib,
        cg_mem_kib,
        cg_oom: oom,
        message: msg,
    }
}

// ---------------------------------------------------------------------------
// 监督：trace 模式（ptrace 单步 syscall；用 /proc/<pid>/syscall 跨架构读编号）
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn supervise_traced(
    cfg: &SandboxConfig,
    cg: &Cgroup,
    child_pid: i32,
    ev_r: RawFd,
    out_r: RawFd,
    err_r: RawFd,
    report: &mut dyn FnMut(Event),
) -> SandboxResult {
    set_nonblock(ev_r);
    set_nonblock(out_r);
    set_nonblock(err_r);

    let start = Instant::now();
    let wall_limit = cfg.wall_time_ms + cfg.extra_time_ms;
    let mut ev_buf = String::new();
    let mut child_error = None;
    let mut timed_out = false;

    let mut status: libc::c_int = 0;
    let mut rusage: libc::rusage = unsafe { std::mem::zeroed() };

    // 等子进程第一次停下（TRACEME 后 execve 会触发 SIGTRAP）。
    unsafe { libc::waitpid(child_pid, &mut status, 0) };
    // 万一 tracing 没生效（子进程直接退出/被杀），就别进单步循环了，直接收尾。
    let already_done = libc::WIFEXITED(status) || libc::WIFSIGNALED(status);
    if !already_done {
        unsafe {
            libc::ptrace(
                libc::PTRACE_SETOPTIONS,
                child_pid,
                0,
                (libc::PTRACE_O_TRACESYSGOOD | libc::PTRACE_O_EXITKILL) as *mut libc::c_void,
            );
            libc::ptrace(libc::PTRACE_SYSCALL, child_pid, 0, 0);
        }
    }

    let blacklisted = cfg.seccomp != crate::SeccompAction::Off;
    let mut at_entry = true; // syscall-stop 在 entry/exit 之间交替。
    while !already_done {
        // 顺手把输出管道排空（非阻塞）。
        drain_events(ev_r, &mut ev_buf, &mut child_error, report);
        drain_output(out_r, report, true);
        drain_output(err_r, report, false);

        let r = unsafe { libc::waitpid(child_pid, &mut status, libc::WNOHANG) };
        if r == 0 {
            if (start.elapsed().as_millis() as u64) > wall_limit {
                timed_out = true;
                cg.kill_all();
                unsafe { libc::kill(child_pid, libc::SIGKILL) };
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
            continue;
        }
        if r < 0 {
            break; // ECHILD：已无可等的子进程
        }
        if r != child_pid {
            continue;
        }
        if libc::WIFEXITED(status) || libc::WIFSIGNALED(status) {
            break;
        }
        if libc::WIFSTOPPED(status) {
            let sig = libc::WSTOPSIG(status);
            // syscall-stop：SIGTRAP|0x80。
            if sig == (libc::SIGTRAP | 0x80) {
                if at_entry {
                    let (nr, name) = read_syscall(child_pid);
                    let blocked = blacklisted && crate::seccomp::is_dangerous(&name);
                    report(Event::Syscall { nr, name, blocked });
                }
                at_entry = !at_entry;
                unsafe { libc::ptrace(libc::PTRACE_SYSCALL, child_pid, 0, 0) };
            } else if sig == libc::SIGTRAP {
                unsafe { libc::ptrace(libc::PTRACE_SYSCALL, child_pid, 0, 0) };
            } else {
                // 把信号透传给被测程序。
                unsafe {
                    libc::ptrace(libc::PTRACE_SYSCALL, child_pid, 0, sig as *mut libc::c_void)
                };
            }
        }
    }

    // 收尸拿 rusage。
    unsafe { libc::wait4(child_pid, &mut status, libc::WNOHANG, &mut rusage) };
    drain_events(ev_r, &mut ev_buf, &mut child_error, report);
    drain_output(out_r, report, true);
    drain_output(err_r, report, false);

    let wall_time_ms = start.elapsed().as_millis() as u64;
    let rusage_cpu_ms = cpu_ms_from_rusage(&rusage);
    let cpu_time_ms = cg
        .cpu_usage_ms()
        .map(|c| c.max(rusage_cpu_ms))
        .unwrap_or(rusage_cpu_ms);
    let max_rss_kib = rusage.ru_maxrss.max(0) as u64;
    let cg_peak = if cg.enabled { cg.peak_kib() } else { 0 };
    let oom = cg.enabled && cg.oom_killed();

    let result = classify(
        &child_error,
        status,
        timed_out,
        oom,
        wall_time_ms,
        cpu_time_ms,
        max_rss_kib,
        cg_peak,
    );
    report(Event::Result(result.clone()));
    result
}

/// 从 /proc/<pid>/syscall 读当前 syscall 号（停在 syscall-stop 时有效），跨架构。
fn read_syscall(pid: i32) -> (i64, String) {
    let s = std::fs::read_to_string(format!("/proc/{pid}/syscall")).unwrap_or_default();
    let nr: i64 = s
        .split_whitespace()
        .next()
        .and_then(|t| t.parse().ok())
        .unwrap_or(-1);
    (nr, syscall_name(nr))
}

/// 常见 syscall 编号→名字（用 libc::SYS_* 保证架构正确）。未收录则用 nr_N。
fn syscall_name(nr: i64) -> String {
    let table: &[(&str, i64)] = &[
        ("read", libc::SYS_read),
        ("write", libc::SYS_write),
        ("close", libc::SYS_close),
        ("openat", libc::SYS_openat),
        ("mmap", libc::SYS_mmap),
        ("munmap", libc::SYS_munmap),
        ("mprotect", libc::SYS_mprotect),
        ("brk", libc::SYS_brk),
        ("rt_sigaction", libc::SYS_rt_sigaction),
        ("rt_sigprocmask", libc::SYS_rt_sigprocmask),
        ("ioctl", libc::SYS_ioctl),
        ("nanosleep", libc::SYS_nanosleep),
        ("clock_nanosleep", libc::SYS_clock_nanosleep),
        ("futex", libc::SYS_futex),
        ("getrandom", libc::SYS_getrandom),
        ("exit", libc::SYS_exit),
        ("exit_group", libc::SYS_exit_group),
        ("lseek", libc::SYS_lseek),
        ("fstat", libc::SYS_fstat),
        ("execve", libc::SYS_execve),
        ("clone", libc::SYS_clone),
        ("wait4", libc::SYS_wait4),
        ("getpid", libc::SYS_getpid),
        ("uname", libc::SYS_uname),
        ("set_tid_address", libc::SYS_set_tid_address),
        ("set_robust_list", libc::SYS_set_robust_list),
        ("prlimit64", libc::SYS_prlimit64),
        ("readlinkat", libc::SYS_readlinkat),
        ("faccessat", libc::SYS_faccessat),
        ("newfstatat", libc::SYS_newfstatat),
        ("statx", libc::SYS_statx),
        ("getdents64", libc::SYS_getdents64),
        ("pread64", libc::SYS_pread64),
        ("rseq", libc::SYS_rseq),
        ("clock_gettime", libc::SYS_clock_gettime),
        ("socket", libc::SYS_socket),
        ("mount", libc::SYS_mount),
        ("ptrace", libc::SYS_ptrace),
    ];
    for (name, n) in table {
        if *n == nr {
            return (*name).to_string();
        }
    }
    format!("nr_{nr}")
}
