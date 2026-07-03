//! 文件系统隔离：用 mount namespace + bind mount + tmpfs + `pivot_root`
//! 给被测程序造一个**最小、只读为主**的根文件系统。
//!
//! 教学要点（对照 isolate 的目录绑定模型）：
//!   1. `mount(MS_REC|MS_PRIVATE, "/")`：把挂载点设为私有，后续改动不外泄到宿主；
//!   2. 在一块 tmpfs 上拼出新根：把 `/usr /bin /lib /lib64` **只读** bind 进来，
//!      把工作目录 bind 成 `/box`（读写），`/tmp`、`/dev/shm` 用 tmpfs，`/dev` 放几个必需设备；
//!   3. `pivot_root` 把根切换到新根，再 `umount` 掉旧根 → 程序再也看不到宿主文件系统；
//!   4. 挂一个全新的 `/proc`：因为在新 PID namespace 里，它只会显示沙箱内的进程。
//!
//! 这一切都要在**降权之前**做（需要 CAP_SYS_ADMIN）。

use nix::mount::{mount, umount2, MntFlags, MsFlags};
use nix::unistd::{chdir, pivot_root, sethostname};

use crate::events::{Event, MountInfo, Phase};
use crate::SandboxConfig;

const NEWROOT: &str = "/tmp/.sandbox-newroot";

fn mnt(
    src: Option<&str>,
    target: &str,
    fstype: Option<&str>,
    flags: MsFlags,
    data: Option<&str>,
) -> anyhow::Result<()> {
    mount(src, target, fstype, flags, data).map_err(|e| {
        anyhow::anyhow!("mount(src={src:?}, target={target}, fs={fstype:?}) 失败: {e}")
    })
}

/// 原始 mkdir（逐级创建，忽略 EEXIST）。
/// 避免用 `std::fs::create_dir_all`——它内部会 `stat`，在 Docker Desktop(Mac) 的 userns +
/// id-mapped tmpfs 上 `stat` 会回 EOVERFLOW(75)；直接 `mkdirat` 不 stat，可绕过。
fn mkdir_p(path: &str) -> anyhow::Result<()> {
    let mut cur = String::new();
    for comp in path.split('/') {
        if comp.is_empty() {
            cur.push('/');
            continue;
        }
        if !cur.ends_with('/') {
            cur.push('/');
        }
        cur.push_str(comp);
        let c = std::ffi::CString::new(cur.as_str()).unwrap();
        let r = unsafe { libc::mkdir(c.as_ptr(), 0o755) };
        if r != 0 {
            let e = std::io::Error::last_os_error();
            if e.raw_os_error() != Some(libc::EEXIST) {
                anyhow::bail!("mkdir {cur} 失败: {e}");
            }
        }
    }
    Ok(())
}

/// 用 access(F_OK) 判断路径是否存在——不 stat，避免 userns 下的 EOVERFLOW。
fn path_exists(path: &str) -> bool {
    let c = std::ffi::CString::new(path).unwrap();
    unsafe { libc::access(c.as_ptr(), libc::F_OK) == 0 }
}

/// 只读 bind：先 bind，再 remount 成只读。
fn bind_ro(src: &str, target: &str) -> anyhow::Result<()> {
    mnt(
        Some(src),
        target,
        None,
        MsFlags::MS_BIND | MsFlags::MS_REC,
        None,
    )?;
    mnt(
        None,
        target,
        None,
        MsFlags::MS_BIND | MsFlags::MS_REMOUNT | MsFlags::MS_RDONLY | MsFlags::MS_REC,
        None,
    )?;
    Ok(())
}

/// 在已 `unshare(CLONE_NEWNS|CLONE_NEWUTS)` 的子进程内构造新根并 `pivot_root`。
pub fn setup(cfg: &SandboxConfig, mut report_line: impl FnMut(Event)) -> anyhow::Result<()> {
    // 0) 主机名（UTS namespace 的效果之一）。
    let _ = sethostname("sandbox");
    report_line(Event::step(
        Phase::Namespace,
        "设置主机名 = sandbox",
        "sethostname(\"sandbox\")",
        "UTS namespace 让沙箱有独立的主机名/域名，改它不影响宿主。",
    ));

    // 1) 根挂载点设为私有，避免后续 mount 传播到宿主。
    mnt(None, "/", None, MsFlags::MS_REC | MsFlags::MS_PRIVATE, None)?;
    report_line(Event::step(
        Phase::Filesystem,
        "把挂载传播设为私有",
        "mount --make-rprivate /",
        "mount namespace 默认会和宿主共享挂载传播；设为 private 后，我们在沙箱里的挂载/卸载不外泄。",
    ));

    // 2) 准备新根。普通模式用 tmpfs；userns(rootless) 模式改用"对真实目录 bind-to-self"。
    // 原因：某些内核(Docker Desktop 的 linuxkit 5.15) 在 user namespace 内对 tmpfs 创建文件会回
    // EOVERFLOW；而 bind 保留原文件系统的 user namespace(init)，文件落在容器盘上，可正常创建。
    let use_tmpfs = !cfg.use_user_ns;
    mkdir_p(NEWROOT)?;
    if use_tmpfs {
        mnt(
            Some("tmpfs"),
            NEWROOT,
            Some("tmpfs"),
            MsFlags::empty(),
            Some("size=16m,mode=755"),
        )?;
    } else {
        mnt(Some(NEWROOT), NEWROOT, None, MsFlags::MS_BIND, None)?;
    }

    // 3) 新根里建出目录骨架。
    for d in [
        "box", "proc", "sys", "dev", "tmp", "etc", "bin", "lib", "lib64", "usr", "sbin", ".oldroot",
    ] {
        mkdir_p(&format!("{NEWROOT}/{d}"))?;
    }

    // 4) 只读 bind 系统目录（存在才挂）。
    let mut bound = vec![];
    for d in ["bin", "sbin", "lib", "lib64", "usr", "etc"] {
        let src = format!("/{d}");
        if path_exists(&src) {
            bind_ro(&src, &format!("{NEWROOT}/{d}"))?;
            bound.push(d);
        }
    }
    report_line(Event::step(
        Phase::Filesystem,
        "只读 bind 系统目录",
        format!("/{{{}}} → {NEWROOT}/… (MS_BIND|MS_RDONLY)", bound.join(",")),
        "把编译器/解释器/动态库以只读方式映射进来：程序能运行，但改不动系统文件。",
    ));

    // 5) 工作目录 → /box（读写）。
    let box_src = cfg.box_dir.to_string_lossy().to_string();
    mnt(
        Some(&box_src),
        &format!("{NEWROOT}/box"),
        None,
        MsFlags::MS_BIND | MsFlags::MS_REC,
        None,
    )?;
    report_line(Event::step(
        Phase::Filesystem,
        "bind 工作目录为 /box（读写）",
        format!("{box_src} → {NEWROOT}/box"),
        "唯一可写的真实目录。被测程序的可执行文件、输入输出都在这里，对应 isolate 的 /box。",
    ));

    // 6) /tmp：tmpfs（userns 下用真实目录，避免 tmpfs EOVERFLOW）。
    if use_tmpfs {
        mnt(
            Some("tmpfs"),
            &format!("{NEWROOT}/tmp"),
            Some("tmpfs"),
            MsFlags::empty(),
            Some("size=16m,mode=1777"),
        )?;
    } else {
        let c = std::ffi::CString::new(format!("{NEWROOT}/tmp")).unwrap();
        unsafe { libc::chmod(c.as_ptr(), 0o1777) };
    }

    // 7) 极简 /dev：tmpfs（userns 下用真实目录）+ bind 几个必需设备节点。
    if use_tmpfs {
        mnt(
            Some("tmpfs"),
            &format!("{NEWROOT}/dev"),
            Some("tmpfs"),
            MsFlags::empty(),
            Some("mode=755,size=1m"),
        )?;
    }
    let _ = mkdir_p(&format!("{NEWROOT}/dev/shm"));
    for dev in ["null", "zero", "full", "random", "urandom", "tty"] {
        let src = format!("/dev/{dev}");
        let tgt = format!("{NEWROOT}/dev/{dev}");
        if path_exists(&src) {
            let _ = std::fs::File::create(&tgt);
            let _ = mnt(Some(&src), &tgt, None, MsFlags::MS_BIND, None);
        }
    }
    report_line(Event::step(
        Phase::Filesystem,
        "挂 tmpfs /tmp、/dev/shm 与极简 /dev",
        "tmpfs(/tmp,/dev/shm,/dev) + bind /dev/{null,zero,random,urandom,...}",
        "临时目录用内存盘隔离；/dev 只暴露必需设备节点，挡住对磁盘/内核设备的直接访问。",
    ));

    // 8) pivot_root：把根切到新根。
    chdir(NEWROOT)?;
    pivot_root(".", ".oldroot").map_err(|e| anyhow::anyhow!("pivot_root 失败: {e}"))?;
    chdir("/")?;
    report_line(Event::step(
        Phase::Filesystem,
        "pivot_root 切换根文件系统",
        "pivot_root(new_root=tmpfs, put_old=/.oldroot)",
        "这一步之后，进程的 '/' 就是我们拼出来的最小根；宿主的真实根被移到 /.oldroot，马上卸载。",
    ));

    // 9) 挂新的 /proc（反映新 PID namespace）和新的 /sys（反映新 net namespace），再卸掉旧根。
    mnt(Some("proc"), "/proc", Some("proc"), MsFlags::empty(), None)?;
    // sysfs 与 net namespace 绑定：新挂的 /sys 里 /sys/class/net 只会有 lo。失败则忽略（如 userns 限制）。
    let sys_ok = mnt(Some("sysfs"), "/sys", Some("sysfs"), MsFlags::empty(), None).is_ok();
    umount2("/.oldroot", MntFlags::MNT_DETACH)
        .map_err(|e| anyhow::anyhow!("umount2(/.oldroot) 失败: {e}"))?;
    let _ = std::fs::remove_dir("/.oldroot");
    report_line(Event::step(
        Phase::Filesystem,
        "挂私有 /proc、/sys 并卸载旧根",
        format!("mount -t proc proc /proc ; mount -t sysfs sys /sys ({}) ; umount2(/.oldroot)", if sys_ok { "ok" } else { "skip" }),
        "新 /proc 只显示本 PID namespace 的进程（沙箱里 ps 只看得到自己）；新 /sys 反映本 net namespace（只剩 lo）；\
         卸载旧根后彻底看不到宿主文件系统。",
    ));

    // 10) 进入工作目录。
    chdir("/box")?;
    Ok(())
}

/// 采集"被测程序真实看到的世界"：根目录、挂载点、网卡、已消失的宿主路径。
/// 在 pivot_root 完成后、execve 之前调用，用于前端的「隔离视图」。
pub fn snapshot() -> Event {
    Event::FsSnapshot {
        hostname: read_hostname(),
        root_entries: list_dir("/"),
        mounts: parse_mountinfo(),
        net_ifaces: list_net(),
        gone: ["/home", "/root", "/var", "/srv", "/opt", "/media"]
            .iter()
            .filter(|p| !path_exists(p))
            .map(|s| s.to_string())
            .collect(),
        euid: unsafe { libc::geteuid() },
    }
}

fn read_hostname() -> String {
    let mut buf = [0u8; 65];
    let rc = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, 64) };
    if rc != 0 {
        return "?".into();
    }
    let end = buf.iter().position(|&b| b == 0).unwrap_or(0);
    String::from_utf8_lossy(&buf[..end]).into_owned()
}

fn list_dir(path: &str) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(path)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// 从 /proc/net/dev 读网卡名（namespace 感知，隔离后只剩 lo）。
fn list_net() -> Vec<String> {
    let content = std::fs::read_to_string("/proc/net/dev").unwrap_or_default();
    content
        .lines()
        .skip(2) // 前两行是表头
        .filter_map(|l| l.split(':').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn parse_mountinfo() -> Vec<MountInfo> {
    let content = std::fs::read_to_string("/proc/self/mountinfo").unwrap_or_default();
    let mut out = vec![];
    for line in content.lines() {
        // 格式：… mountpoint mount-opts … - fstype source super-opts
        let parts: Vec<&str> = line.splitn(2, " - ").collect();
        if parts.len() < 2 {
            continue;
        }
        let left: Vec<&str> = parts[0].split_whitespace().collect();
        let right: Vec<&str> = parts[1].split_whitespace().collect();
        if left.len() < 6 || right.is_empty() {
            continue;
        }
        out.push(MountInfo {
            target: left[4].to_string(),
            fstype: right[0].to_string(),
            ro: left[5].split(',').any(|o| o == "ro"),
        });
    }
    out
}
