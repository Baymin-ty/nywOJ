//! cgroup v2 管理。
//!
//! 教学要点：cgroup v2 就是 `/sys/fs/cgroup` 下的一棵目录树，"限制/计量"全是
//! **对普通文件的读写**——
//!   - 写 `memory.max` / `pids.max` 限额；
//!   - 把 pid 写进 `cgroup.procs` 把进程"放进笼子"；
//!   - 读 `memory.current` / `memory.peak` / `memory.events` / `pids.current` 看用量。
//!
//! 容器内的坑（isolate README 也提到）：cgroup v2 有"**no internal process**"规则——
//! 一个**非根**且**有进程**的 cgroup 不能在 `cgroup.subtree_control` 里启用控制器。
//! 容器命名空间根 `/sys/fs/cgroup` 恰好既非真正的根、又装着容器自己的进程，
//! 所以要先把现有进程挪到一个叶子 cgroup（这里叫 `_keeper`），腾空根，
//! 再启用控制器、建本次运行用的子 cgroup。失败则**优雅降级**到 rlimit 限内存。

use std::fs;
use std::path::{Path, PathBuf};

use crate::events::{Event, Phase, Reporter};
use crate::SandboxConfig;

pub struct Cgroup {
    /// 本次运行专属的 cgroup 目录；None 表示降级（cgroup 不可用）。
    run_path: Option<PathBuf>,
    pub enabled: bool,
    pub has_memory: bool,
    pub has_pids: bool,
    pub has_cpu: bool,
}

fn write_file(path: &Path, content: &str) -> std::io::Result<()> {
    fs::write(path, content)
}

fn read_first_u64(path: &Path) -> Option<u64> {
    let s = fs::read_to_string(path).ok()?;
    s.split_whitespace().next()?.parse().ok()
}

/// 从 `key value\n...` 形式的文件里取某个 key 的值。
fn read_kv_u64(path: &Path, key: &str) -> Option<u64> {
    let s = fs::read_to_string(path).ok()?;
    for line in s.lines() {
        let mut it = line.split_whitespace();
        if it.next() == Some(key) {
            return it.next()?.parse().ok();
        }
    }
    None
}

impl Cgroup {
    /// 尝试搭建 cgroup；任何关键步骤失败都会降级（返回 `enabled=false`）。
    pub fn create(cfg: &SandboxConfig, report: Reporter) -> Cgroup {
        if !cfg.use_cgroup {
            return Cgroup::disabled();
        }
        let base = &cfg.cgroup_root;
        let controllers = fs::read_to_string(base.join("cgroup.controllers")).unwrap_or_default();
        let has_memory = controllers.split_whitespace().any(|c| c == "memory");
        let has_pids = controllers.split_whitespace().any(|c| c == "pids");
        let has_cpu = controllers.split_whitespace().any(|c| c == "cpu");
        if !has_memory {
            report(Event::step(
                Phase::Limits,
                "cgroup 不可用，降级到 rlimit",
                format!("{}/cgroup.controllers 中没有 memory 控制器", base.display()),
                "容器未把 memory 控制器委派进来。内存限制改用 RLIMIT_AS（限地址空间，\
                 不如 cgroup 精确，且对 JIT/多线程程序可能误伤），这正是 isolate 警告的容器委派问题。",
            ));
            return Cgroup::disabled();
        }

        // 1) 腾空命名空间根：把根 cgroup.procs 里的进程挪到 _keeper 叶子。
        let keeper = base.join("_keeper");
        let _ = fs::create_dir_all(&keeper);
        if let Ok(procs) = fs::read_to_string(base.join("cgroup.procs")) {
            for pid in procs.split_whitespace() {
                let _ = write_file(&keeper.join("cgroup.procs"), pid);
            }
        }

        // 2) 在根的 subtree_control 启用控制器（供子 cgroup 使用）。
        //    cpu 控制器用于整组 CPU 计量（cpu.stat.usage_usec）——防止 fork 多个进程
        //    把 CPU 预算翻倍：只读主进程 /proc/<pid>/stat 会漏掉子进程的 CPU。
        let subtree = base.join("cgroup.subtree_control");
        let build_enable = |with_cpu: bool| {
            let mut s = String::from("+memory");
            if has_pids {
                s.push_str(" +pids");
            }
            if with_cpu && has_cpu {
                s.push_str(" +cpu");
            }
            s
        };
        // 先尝试连 +cpu 一起启用；失败则退回不带 cpu（内存/进程数限制仍要保住）。
        let mut cpu_enabled = has_cpu;
        if write_file(&subtree, &build_enable(true)).is_err() {
            cpu_enabled = false;
            if let Err(e) = write_file(&subtree, &build_enable(false)) {
                report(Event::step(
                    Phase::Limits,
                    "启用 cgroup 控制器失败，降级",
                    format!("写 {}/cgroup.subtree_control 失败: {e}", base.display()),
                    "通常是 no-internal-process 规则（根里仍有进程没挪干净）或权限不足。降级到 rlimit。",
                ));
                return Cgroup::disabled();
            }
        }
        let has_cpu = cpu_enabled;

        // 3) 建本次运行专属 cgroup，写限额。
        let run_path = base.join(format!("run_{}", std::process::id()));
        if let Err(e) = fs::create_dir_all(&run_path) {
            report(Event::step(
                Phase::Limits,
                "创建运行 cgroup 失败，降级",
                format!("mkdir {} 失败: {e}", run_path.display()),
                "无法创建子 cgroup，降级到 rlimit。",
            ));
            return Cgroup::disabled();
        }

        let mem_bytes = cfg.mem_kib.saturating_mul(1024);
        let _ = write_file(&run_path.join("memory.max"), &mem_bytes.to_string());
        // memory.swap.max=0：禁止用 swap 绕过内存限制。
        let _ = write_file(&run_path.join("memory.swap.max"), "0");
        if has_pids {
            let _ = write_file(&run_path.join("pids.max"), &cfg.max_procs.to_string());
        }

        report(Event::step(
            Phase::Limits,
            "创建 cgroup v2 并写入限额",
            format!(
                "{}  memory.max={} KiB  pids.max={}  cpu.stat={}",
                run_path.display(),
                cfg.mem_kib,
                if has_pids {
                    cfg.max_procs.to_string()
                } else {
                    "n/a".into()
                },
                if has_cpu { "整组计量" } else { "n/a" }
            ),
            "进程一旦放进这个 cgroup，内核会在它（及其所有子孙）总用量触顶时触发 OOM kill；\
             pids.max 挡住 fork 炸弹；cpu 控制器让我们按整组 cpu.stat 计 CPU 时间，\
             这样 fork 多个进程也无法绕过 CPU 限制。这就是 isolate 用 cgroup 做'整组限额'的核心。",
        ));

        Cgroup {
            run_path: Some(run_path),
            enabled: true,
            has_memory,
            has_pids,
            has_cpu,
        }
    }

    fn disabled() -> Cgroup {
        Cgroup {
            run_path: None,
            enabled: false,
            has_memory: false,
            has_pids: false,
            has_cpu: false,
        }
    }

    /// 把进程放进本次 cgroup（写 cgroup.procs）。
    pub fn add_pid(&self, pid: i32) -> std::io::Result<()> {
        if let Some(p) = &self.run_path {
            write_file(&p.join("cgroup.procs"), &pid.to_string())?;
        }
        Ok(())
    }

    /// 采样：返回 (当前内存 KiB, 峰值内存 KiB, 当前进程数)。
    pub fn sample(&self) -> (u64, u64, u64) {
        let Some(p) = &self.run_path else {
            return (0, 0, 0);
        };
        let cur = read_first_u64(&p.join("memory.current")).unwrap_or(0) / 1024;
        let peak = read_first_u64(&p.join("memory.peak")).unwrap_or(cur * 1024) / 1024;
        let procs = read_first_u64(&p.join("pids.current")).unwrap_or(0);
        (cur, peak, procs)
    }

    /// 整组 CPU 累计时间（毫秒），取自 cgroup v2 `cpu.stat` 的 `usage_usec`。
    ///
    /// 关键：这是**整个 cgroup（含所有 fork 出来的子孙进程/线程）**的 CPU 时间，
    /// 而不是只看主进程的 `/proc/<pid>/stat`。否则把工作分散到多个进程就能让 CPU
    /// 限制形同虚设——主进程 CPU≈0，实际整组烧了 N 倍。未启用 cpu 控制器时返回 None。
    pub fn cpu_usage_ms(&self) -> Option<u64> {
        if !self.has_cpu {
            return None;
        }
        let p = self.run_path.as_ref()?;
        read_kv_u64(&p.join("cpu.stat"), "usage_usec").map(|us| us / 1000)
    }

    /// 内存峰值（KiB）。
    pub fn peak_kib(&self) -> u64 {
        self.run_path
            .as_ref()
            .and_then(|p| read_first_u64(&p.join("memory.peak")))
            .map(|b| b / 1024)
            .unwrap_or(0)
    }

    /// 是否发生过 OOM kill。
    pub fn oom_killed(&self) -> bool {
        let Some(p) = &self.run_path else {
            return false;
        };
        let ev = p.join("memory.events");
        let oom = read_kv_u64(&ev, "oom_kill").unwrap_or(0);
        let oom_group = read_kv_u64(&ev, "oom_group_kill").unwrap_or(0);
        oom > 0 || oom_group > 0
    }

    /// 杀死 cgroup 内全部进程（cgroup.kill 是 v2 的"一键全杀"）。
    pub fn kill_all(&self) {
        if let Some(p) = &self.run_path {
            let _ = write_file(&p.join("cgroup.kill"), "1");
        }
    }

    /// 收尾：杀光并删除本次 cgroup 目录。
    pub fn cleanup(&self) {
        if let Some(p) = &self.run_path {
            self.kill_all();
            // 进程退出后才能 rmdir；重试几次。
            for _ in 0..50 {
                if fs::remove_dir(p).is_ok() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    }
}
