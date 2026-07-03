//! 作业（一次提交）的生命周期与事件缓冲。
//!
//! 提交后：写源码 → 编译（C/C++）→ 把 SandboxConfig 通过 stdin 喂给 `sandbox-cli` 子进程 →
//! 逐行读它 stdout 上的事件 → 存进缓冲并 notify。WebSocket 端订阅同一缓冲做实时回放。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use sandbox_core::{Event, Phase, SandboxConfig, SandboxResult, SeccompAction};
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Notify;

use crate::languages;

/// 一个作业的共享状态。
pub struct Job {
    /// 已产生的事件（JSON 行），WS 端按索引增量读取。
    pub lines: Mutex<Vec<String>>,
    /// 新事件/完成的唤醒信号。
    pub notify: Notify,
    /// 是否结束。
    pub done: AtomicBool,
}

impl Job {
    fn new() -> Arc<Job> {
        Arc::new(Job {
            lines: Mutex::new(Vec::new()),
            notify: Notify::new(),
            done: AtomicBool::new(false),
        })
    }

    pub fn push(&self, line: String) {
        self.lines.lock().unwrap().push(line);
        self.notify.notify_waiters();
    }

    fn push_event(&self, ev: &Event) {
        self.push(ev.to_line());
    }

    fn finish(&self) {
        self.done.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }
}

#[derive(Clone)]
pub struct Jobs(Arc<Mutex<HashMap<String, Arc<Job>>>>);

impl Jobs {
    pub fn new() -> Jobs {
        Jobs(Arc::new(Mutex::new(HashMap::new())))
    }
    pub fn get(&self, id: &str) -> Option<Arc<Job>> {
        self.0.lock().unwrap().get(id).cloned()
    }
    fn insert(&self, id: String, job: Arc<Job>) {
        self.0.lock().unwrap().insert(id, job);
    }
}

/// 提交请求体。
#[derive(Debug, Deserialize)]
pub struct SubmitRequest {
    pub language: String,
    pub source: String,
    #[serde(default)]
    pub stdin: String,
    /// 可选预期输出：提供后与程序 stdout 比对，给出 AC/WA。
    #[serde(default)]
    pub expected_output: String,
    #[serde(default)]
    pub limits: Limits,
}

#[derive(Debug, Deserialize)]
pub struct Limits {
    #[serde(default = "d_wall")]
    pub wall_time_ms: u64,
    #[serde(default = "d_cpu")]
    pub cpu_time_ms: u64,
    #[serde(default = "d_mem")]
    pub mem_kib: u64,
    #[serde(default = "d_stack")]
    pub stack_kib: u64,
    #[serde(default = "d_procs")]
    pub max_procs: u64,
    #[serde(default = "d_true")]
    pub use_namespaces: bool,
    #[serde(default = "d_true")]
    pub use_cgroup: bool,
    #[serde(default = "d_seccomp")]
    pub seccomp: String,
    #[serde(default)]
    pub seccomp_allowlist: bool,
    #[serde(default)]
    pub use_user_ns: bool,
    #[serde(default)]
    pub share_net: bool,
    #[serde(default)]
    pub trace: bool,
}

impl Default for Limits {
    fn default() -> Self {
        serde_json::from_str("{}").unwrap()
    }
}

fn d_wall() -> u64 {
    5000
}
fn d_cpu() -> u64 {
    2000
}
fn d_mem() -> u64 {
    256 * 1024
}
fn d_stack() -> u64 {
    64 * 1024
}
fn d_procs() -> u64 {
    16
}
fn d_true() -> bool {
    true
}
fn d_seccomp() -> String {
    "errno".into()
}

/// 受理一次提交，返回 job_id，并在后台启动运行任务。
pub fn submit(
    jobs: &Jobs,
    cli_path: String,
    jobs_root: PathBuf,
    req: SubmitRequest,
) -> Result<String, String> {
    let lang = languages::lookup(&req.language)
        .ok_or_else(|| format!("不支持的语言: {}", req.language))?;
    let job_id = uuid::Uuid::new_v4().to_string();
    let job = Job::new();
    jobs.insert(job_id.clone(), job.clone());

    let box_dir = jobs_root.join(&job_id);
    tokio::spawn(run_job(job, cli_path, box_dir, lang, req));
    Ok(job_id)
}

async fn run_job(
    job: Arc<Job>,
    cli_path: String,
    box_dir: PathBuf,
    lang: languages::Language,
    req: SubmitRequest,
) {
    if let Err(e) = run_job_inner(&job, &cli_path, &box_dir, &lang, &req).await {
        job.push_event(&Event::Error { message: e.clone() });
        job.push_event(&Event::Result(SandboxResult::internal_error(e)));
    }
    job.finish();
}

async fn run_job_inner(
    job: &Arc<Job>,
    cli_path: &str,
    box_dir: &PathBuf,
    lang: &languages::Language,
    req: &SubmitRequest,
) -> Result<(), String> {
    // 1) 准备工作目录（0777：沙箱内降权后的用户也要能写）。
    tokio::fs::create_dir_all(box_dir)
        .await
        .map_err(|e| format!("建工作目录失败: {e}"))?;
    set_mode_777(box_dir);
    let src_path = box_dir.join(lang.source_name);
    tokio::fs::write(&src_path, &req.source)
        .await
        .map_err(|e| format!("写源码失败: {e}"))?;
    if !req.stdin.is_empty() {
        tokio::fs::write(box_dir.join("stdin.txt"), &req.stdin)
            .await
            .map_err(|e| format!("写 stdin 失败: {e}"))?;
    }

    job.push_event(&Event::step(
        Phase::Setup,
        "准备工作目录并写入源码",
        format!("{} ({} 字节)", src_path.display(), req.source.len()),
        "这个目录稍后会被 bind 成沙箱内的 /box（唯一可写处）。",
    ));

    // 2) 编译（如需要）。编译在容器内、宿主侧执行（教学项目从简；进阶可让编译也走沙箱）。
    if let Some(cmd) = lang.compile_cmd(box_dir) {
        job.push_event(&Event::step(
            Phase::Setup,
            "编译源码",
            cmd.join(" "),
            "对 C/C++ 先在宿主侧编译出可执行文件，再把它放进沙箱受限运行。",
        ));
        let out = tokio::process::Command::new(&cmd[0])
            .args(&cmd[1..])
            .output()
            .await
            .map_err(|e| format!("启动编译器失败: {e}"))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            job.push_event(&Event::Stderr {
                data: stderr.clone(),
            });
            return Err(format!("编译失败:\n{stderr}"));
        }
        set_mode_777(&box_dir.join("a.out"));
    }

    // 3) 组装 SandboxConfig。
    let seccomp = match req.limits.seccomp.as_str() {
        "off" => SeccompAction::Off,
        "kill" => SeccompAction::Kill,
        _ => SeccompAction::Errno,
    };
    let cfg = SandboxConfig {
        box_dir: box_dir.clone(),
        command: lang.run_cmd(),
        stdin_path: if req.stdin.is_empty() {
            None
        } else {
            Some(PathBuf::from("stdin.txt"))
        },
        wall_time_ms: req.limits.wall_time_ms,
        cpu_time_ms: req.limits.cpu_time_ms,
        mem_kib: req.limits.mem_kib,
        stack_kib: req.limits.stack_kib,
        max_procs: req.limits.max_procs,
        use_namespaces: req.limits.use_namespaces,
        use_cgroup: req.limits.use_cgroup,
        seccomp,
        seccomp_allowlist: req.limits.seccomp_allowlist,
        use_user_ns: req.limits.use_user_ns,
        share_net: req.limits.share_net,
        trace: req.limits.trace,
        ..SandboxConfig::default()
    };
    let cfg_json = serde_json::to_string(&cfg).map_err(|e| format!("序列化配置失败: {e}"))?;

    // 4) 拉起 sandbox-cli 子进程，喂配置、读事件流。
    let mut child = tokio::process::Command::new(cli_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 sandbox-cli({cli_path}) 失败: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(cfg_json.as_bytes()).await.ok();
        drop(stdin); // 关闭 stdin，cli 读到 EOF 后开始运行。
    }

    let stdout = child.stdout.take().ok_or("无法取得 cli stdout")?;
    let stderr = child.stderr.take();
    let mut reader = BufReader::new(stdout).lines();

    // 旁路收集 cli 自身 stderr（诊断用）。
    if let Some(stderr) = stderr {
        let job2 = job.clone();
        tokio::spawn(async move {
            let mut er = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = er.next_line().await {
                job2.push_event(&Event::Stderr {
                    data: format!("[cli] {line}\n"),
                });
            }
        });
    }

    let mut got_stdout = String::new();
    let mut result_ok = false;
    let mut have_result = false;
    while let Some(line) = reader
        .next_line()
        .await
        .map_err(|e| format!("读事件流失败: {e}"))?
    {
        // 顺手解析以便判题（同时原样转发给前端）。
        if let Ok(ev) = serde_json::from_str::<Event>(&line) {
            match &ev {
                Event::Stdout { data } => got_stdout.push_str(data),
                Event::Result(r) => {
                    have_result = true;
                    result_ok = matches!(r.status, sandbox_core::Status::Ok);
                }
                _ => {}
            }
        }
        job.push(line);
    }

    let _ = child.wait().await;

    // 判题：提供了预期输出才比对。
    if !req.expected_output.is_empty() {
        let verdict;
        let message;
        if !have_result || !result_ok {
            verdict = "WA".to_string();
            message = "程序未正常结束（非 OK），无法通过".to_string();
        } else if normalize(&got_stdout) == normalize(&req.expected_output) {
            verdict = "AC".to_string();
            message = "Accepted：输出与预期一致".to_string();
        } else {
            verdict = "WA".to_string();
            message = format!(
                "Wrong Answer\n--- 预期 ---\n{}\n--- 实际 ---\n{}",
                req.expected_output.trim_end(),
                got_stdout.trim_end()
            );
        }
        job.push_event(&Event::Judge { verdict, message });
    }
    Ok(())
}

/// 判题用的输出规范化：去掉行尾空白与结尾空行。
fn normalize(s: &str) -> String {
    s.lines()
        .map(|l| l.trim_end())
        .collect::<Vec<_>>()
        .join("\n")
        .trim_end()
        .to_string()
}

fn set_mode_777(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o777));
    }
}
