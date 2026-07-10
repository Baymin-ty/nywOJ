use std::collections::HashMap;
use std::ffi::CString;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path as AxumPath, State,
    },
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use sandbox_core::{Event, FdMapping, FdMode, SandboxConfig, SandboxResult, SeccompAction, Status};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Notify;

use crate::AppState;

const DEFAULT_CAPTURE_MAX: usize = 64 * 1024 * 1024;
const HARD_CAPTURE_MAX: usize = 64 * 1024 * 1024;
/// 单个 /api/run 请求最多并发拉起多少个沙箱进程。挡住"一次请求 fork 上万个 sandbox-cli"
/// 把宿主打爆的 DoS——通信/交互题最多也就几个进程，这个上限足够宽松。
const MAX_COMMANDS_PER_REQUEST: usize = 64;
/// 单个请求最多多少条管道映射。每条管道要建一个 FIFO 并占宿主 fd，需有界。
const MAX_PIPES_PER_REQUEST: usize = 256;
const DEFAULT_STREAM_REQUEST_MAX: usize = 1024 * 1024;
const DEFAULT_STREAM_INPUT_CHUNK_MAX: usize = 64 * 1024;
const DEFAULT_STREAM_INPUT_TOTAL_MAX: usize = 16 * 1024 * 1024;

fn parse_size_bytes(value: &str) -> Option<usize> {
    let raw = value.trim();
    if raw.is_empty() {
        return None;
    }
    let split = raw
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(raw.len());
    let (digits, unit) = raw.split_at(split);
    let n = digits.parse::<usize>().ok()?;
    let unit = unit.trim().to_ascii_lowercase();
    let scale = match unit.as_str() {
        "" | "b" => 1,
        "k" | "kb" | "kib" => 1024,
        "m" | "mb" | "mib" => 1024 * 1024,
        "g" | "gb" | "gib" => 1024 * 1024 * 1024,
        _ => return None,
    };
    n.checked_mul(scale)
}

fn env_size_bytes(key: &str, fallback: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|value| parse_size_bytes(&value))
        .unwrap_or(fallback)
}

#[derive(Clone, Copy)]
struct StreamLimits {
    request_bytes: usize,
    input_chunk_bytes: usize,
    input_total_bytes: usize,
}

impl StreamLimits {
    fn from_env() -> Self {
        Self {
            request_bytes: env_size_bytes("SANDBOX_STREAM_REQUEST_LIMIT", DEFAULT_STREAM_REQUEST_MAX),
            input_chunk_bytes: env_size_bytes(
                "SANDBOX_STREAM_INPUT_CHUNK_LIMIT",
                DEFAULT_STREAM_INPUT_CHUNK_MAX,
            ),
            input_total_bytes: env_size_bytes(
                "SANDBOX_STREAM_INPUT_TOTAL_LIMIT",
                DEFAULT_STREAM_INPUT_TOTAL_MAX,
            ),
        }
    }

    fn ws_message_bytes(&self) -> usize {
        self.request_bytes.max(self.input_chunk_bytes.saturating_add(2))
    }
}

#[derive(Debug, Deserialize)]
pub struct RunRequest {
    pub commands: Vec<SandboxCommand>,
    #[serde(default)]
    pub pipes: Vec<PipeMapping>,
}

#[derive(Debug, Deserialize)]
pub struct SandboxCommand {
    pub command: Vec<String>,
    #[serde(default)]
    pub env: Vec<String>,
    #[serde(default)]
    pub stdio: Vec<Option<StdioFile>>,
    #[serde(default)]
    pub limits: CommandLimits,
    #[serde(rename = "inputFiles", default)]
    pub input_files: HashMap<String, InputFile>,
    #[serde(rename = "outputFiles", default)]
    pub output_files: Vec<String>,
    #[serde(rename = "cachedOutputs", default)]
    pub cached_outputs: Vec<String>,
    #[serde(rename = "cachePrefix", default)]
    pub cache_prefix: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct CommandLimits {
    #[serde(rename = "cpuMs", default)]
    pub cpu_ms: u64,
    #[serde(rename = "wallMs", default)]
    pub wall_ms: u64,
    #[serde(rename = "memoryMB", default)]
    pub memory_mb: u64,
    #[serde(rename = "stackMB", default)]
    pub stack_mb: u64,
    #[serde(default)]
    pub processes: u64,
}

impl CommandLimits {
    fn wall_ms(&self, fallback: u64) -> u64 {
        if self.wall_ms == 0 {
            fallback
        } else {
            self.wall_ms
        }
    }

    fn cpu_ms(&self, fallback: u64) -> u64 {
        if self.cpu_ms == 0 {
            fallback
        } else {
            self.cpu_ms
        }
    }

    fn mem_kib(&self, fallback: u64) -> u64 {
        if self.memory_mb == 0 {
            fallback
        } else {
            self.memory_mb.saturating_mul(1024)
        }
    }

    fn stack_kib(&self, fallback: u64) -> u64 {
        if self.stack_mb == 0 {
            fallback
        } else {
            self.stack_mb.saturating_mul(1024)
        }
    }

    fn processes(&self, fallback: u64) -> u64 {
        if self.processes == 0 {
            fallback
        } else {
            self.processes
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct PipeMapping {
    pub from: PipeEndpoint,
    pub to: PipeEndpoint,
}

#[derive(Debug, Deserialize)]
pub struct PipeEndpoint {
    pub command: usize,
    pub fd: u32,
}

#[derive(Debug, Deserialize)]
pub struct StdioFile {
    pub content: Option<String>,
    pub name: Option<String>,
    pub max: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct InputFile {
    pub content: Option<String>,
    #[serde(rename = "cachedFile")]
    pub cached_file: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RunResult {
    pub status: String,
    #[serde(rename = "exitCode", skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(rename = "exitSignal", skip_serializing_if = "Option::is_none")]
    pub exit_signal: Option<i32>,
    #[serde(rename = "cpuTimeMs")]
    pub cpu_time_ms: u64,
    #[serde(rename = "memoryKb")]
    pub memory_kb: u64,
    #[serde(rename = "wallTimeMs")]
    pub wall_time_ms: u64,
    #[serde(rename = "outputFiles")]
    pub output_files: HashMap<String, String>,
    #[serde(rename = "cachedFiles", skip_serializing_if = "HashMap::is_empty")]
    pub cached_files: HashMap<String, String>,
}

pub async fn version() -> impl IntoResponse {
    Json(json!({
        "name": "nywOJ-rust-sandbox",
        "buildVersion": env!("CARGO_PKG_VERSION"),
        "cachedOutputs": true,
        "optionalOutputs": true,
        "pipes": true,
        "stream": true,
        "streamMode": "basic-fifo",
        "procPeak": true,
        "memoryAccounting": "cgroup-v2-memory.peak-with-rusage-fallback",
        "security": {
            "namespaces": true,
            "cgroupV2": true,
            "pivotRoot": true,
            "seccomp": true,
            "networkDefault": "isolated"
        }
    }))
}

pub async fn run(State(state): State<AppState>, Json(req): Json<RunRequest>) -> impl IntoResponse {
    if req.commands.len() > MAX_COMMANDS_PER_REQUEST {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("too many commands (max {MAX_COMMANDS_PER_REQUEST})")
            })),
        )
            .into_response();
    }
    if req.pipes.len() > MAX_PIPES_PER_REQUEST {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("too many pipes (max {MAX_PIPES_PER_REQUEST})")
            })),
        )
            .into_response();
    }
    if !req.pipes.is_empty() {
        return match run_piped(&state, req.commands, req.pipes).await {
            Ok(out) => Json(out).into_response(),
            Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
        };
    }
    let mut out = Vec::with_capacity(req.commands.len());
    for cmd in req.commands {
        match run_one(&state, cmd).await {
            Ok(result) => out.push(result),
            Err(e) => out.push(RunResult {
                status: "Internal Error".into(),
                exit_code: None,
                exit_signal: None,
                cpu_time_ms: 0,
                memory_kb: 0,
                wall_time_ms: 0,
                output_files: HashMap::from([("stderr".into(), e)]),
                cached_files: HashMap::new(),
            }),
        }
    }
    Json(out).into_response()
}

pub async fn get_file(
    State(state): State<AppState>,
    AxumPath(file_id): AxumPath<String>,
) -> impl IntoResponse {
    match checked_file_path(&state.file_root, &file_id) {
        Ok(path) => match tokio::fs::read(path).await {
            Ok(bytes) => (StatusCode::OK, bytes).into_response(),
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        },
        Err(_) => StatusCode::BAD_REQUEST.into_response(),
    }
}

pub async fn delete_file(
    State(state): State<AppState>,
    AxumPath(file_id): AxumPath<String>,
) -> impl IntoResponse {
    let Ok(path) = checked_file_path(&state.file_root, &file_id) else {
        return StatusCode::BAD_REQUEST;
    };
    let _ = tokio::fs::remove_file(path).await;
    StatusCode::OK
}

pub async fn stream(State(state): State<AppState>, ws: WebSocketUpgrade) -> impl IntoResponse {
    let limits = StreamLimits::from_env();
    ws.max_message_size(limits.ws_message_bytes())
        .on_upgrade(move |socket| stream_socket(socket, state, limits))
}

async fn stream_socket(mut socket: WebSocket, state: AppState, limits: StreamLimits) {
    let Some(Ok(first)) = socket.recv().await else {
        return;
    };
    let Some(bytes) = ws_bytes(first) else {
        let _ = send_stream_result(
            &mut socket,
            internal_run_result("first stream frame must be binary"),
        )
        .await;
        return;
    };
    if bytes.len() > limits.request_bytes {
        let _ = send_stream_result(
            &mut socket,
            internal_run_result(format!(
                "stream request frame exceeds {} bytes",
                limits.request_bytes
            )),
        )
        .await;
        return;
    }
    if bytes.first().copied() != Some(1) {
        let _ = send_stream_result(
            &mut socket,
            internal_run_result("first stream frame must be type 1 exec request"),
        )
        .await;
        return;
    }

    let req: RunRequest = match serde_json::from_slice(&bytes[1..]) {
        Ok(req) => req,
        Err(e) => {
            let _ = send_stream_result(
                &mut socket,
                internal_run_result(format!("parse stream request failed: {e}")),
            )
            .await;
            return;
        }
    };
    if !req.pipes.is_empty() || req.commands.len() != 1 {
        let _ = send_stream_result(
            &mut socket,
            internal_run_result("stream supports exactly one command and no pipes"),
        )
        .await;
        return;
    }

    let mut cmd = req.commands.into_iter().next().unwrap();
    let stdout_max = file_max_for_fd(&cmd.stdio, 1, DEFAULT_CAPTURE_MAX);
    let stderr_max = file_max_for_fd(&cmd.stdio, 2, DEFAULT_CAPTURE_MAX);

    let setup = match prepare_stream_run(&state, &mut cmd).await {
        Ok(setup) => setup,
        Err(e) => {
            let _ = send_stream_result(&mut socket, internal_run_result(e)).await;
            return;
        }
    };
    let StreamRun {
        box_dir,
        mut stdin,
        mut child,
        stdout,
    } = setup;
    let mut reader = BufReader::new(stdout).lines();
    let mut result = None;
    let mut output_limited = false;
    let mut stdout_used = 0usize;
    let mut stderr_used = 0usize;
    let mut stdin_used = 0usize;

    loop {
        tokio::select! {
            line = reader.next_line() => {
                let line = match line {
                    Ok(Some(line)) => line,
                    Ok(None) => break,
                    Err(e) => {
                        result = Some(SandboxResult::internal_error(format!("read stream event failed: {e}")));
                        break;
                    }
                };
                let Ok(ev) = serde_json::from_str::<Event>(&line) else { continue; };
                match ev {
                    Event::Stdout { data } => {
                        let (chunk, limited) = stream_chunk(&mut stdout_used, &data, stdout_max);
                        output_limited |= limited;
                        if !chunk.is_empty() && send_stream_output(&mut socket, 1, chunk.as_bytes()).await.is_err() {
                            let _ = child.start_kill();
                            break;
                        }
                    }
                    Event::Stderr { data } => {
                        let (chunk, limited) = stream_chunk(&mut stderr_used, &data, stderr_max);
                        output_limited |= limited;
                        if !chunk.is_empty() && send_stream_output(&mut socket, 2, chunk.as_bytes()).await.is_err() {
                            let _ = child.start_kill();
                            break;
                        }
                    }
                    Event::Result(r) => result = Some(r),
                    Event::Error { message } => {
                        let (chunk, limited) = stream_chunk(&mut stderr_used, &message, stderr_max);
                        output_limited |= limited;
                        if !chunk.is_empty() && send_stream_output(&mut socket, 2, chunk.as_bytes()).await.is_err() {
                            let _ = child.start_kill();
                            break;
                        }
                    }
                    _ => {}
                }
            }
            msg = socket.recv() => {
                let Some(Ok(msg)) = msg else {
                    let _ = child.start_kill();
                    break;
                };
                let Some(bytes) = ws_bytes(msg) else { continue; };
                match bytes.first().copied() {
                    Some(2) => {
                        // Resize is accepted by the stream protocol. This
                        // basic FIFO stream does not allocate a PTY yet.
                    }
                    Some(3) => {
                        let payload_len = bytes.len().saturating_sub(2);
                        if payload_len > limits.input_chunk_bytes {
                            result = Some(SandboxResult::internal_error(format!(
                                "stream stdin chunk exceeds {} bytes",
                                limits.input_chunk_bytes
                            )));
                            let _ = child.start_kill();
                            break;
                        }
                        let next_stdin_used = stdin_used.saturating_add(payload_len);
                        if next_stdin_used > limits.input_total_bytes {
                            result = Some(SandboxResult::internal_error(format!(
                                "stream stdin total exceeds {} bytes",
                                limits.input_total_bytes
                            )));
                            let _ = child.start_kill();
                            break;
                        }
                        stdin_used = next_stdin_used;
                        if bytes.len() > 2 && stdin.write_all(&bytes[2..]).await.is_err() {
                            let _ = child.start_kill();
                            break;
                        }
                    }
                    Some(4) => {
                        let _ = child.start_kill();
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    let _ = stdin.shutdown().await;
    let _ = child.wait().await;
    let nywoj = result_to_run(
        result.unwrap_or_else(|| SandboxResult::internal_error("missing sandbox stream result")),
        HashMap::new(),
        HashMap::new(),
        output_limited,
    );
    let _ = send_stream_result(&mut socket, nywoj).await;
    let _ = tokio::fs::remove_dir_all(box_dir).await;
}

struct StreamRun {
    box_dir: PathBuf,
    stdin: tokio::fs::File,
    child: tokio::process::Child,
    stdout: tokio::process::ChildStdout,
}

async fn prepare_stream_run(
    state: &AppState,
    cmd: &mut SandboxCommand,
) -> Result<StreamRun, String> {
    if cmd.command.is_empty() {
        return Err("command is empty".into());
    }

    let run_id = uuid::Uuid::new_v4().to_string();
    let box_dir = state.jobs_root.join("nywoj-stream").join(&run_id);
    tokio::fs::create_dir_all(&box_dir)
        .await
        .map_err(|e| format!("create stream box dir failed: {e}"))?;
    set_mode_777(&box_dir);

    for (name, src) in &cmd.input_files {
        let content = if let Some(content) = &src.content {
            content.as_bytes().to_vec()
        } else if let Some(file_id) = &src.cached_file {
            tokio::fs::read(checked_file_path(&state.file_root, file_id)?)
                .await
                .map_err(|e| format!("read cached file {file_id} failed: {e}"))?
        } else {
            Vec::new()
        };
        let target = checked_box_path(&box_dir, name)?;
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("create stream inputFiles dir failed: {e}"))?;
        }
        tokio::fs::write(&target, content)
            .await
            .map_err(|e| format!("write stream inputFiles {name} failed: {e}"))?;
        set_mode_777(&target);
    }

    let fifo_name = "stdin.fifo";
    let fifo_path = box_dir.join(fifo_name);
    make_fifo(&fifo_path)?;
    set_mode_777(&fifo_path);
    let stdin = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&fifo_path)
        .map_err(|e| format!("open stream stdin fifo failed: {e}"))?;

    let sandbox_args = map_command_args(&box_dir, &cmd.command);
    let cfg = SandboxConfig {
        box_dir: box_dir.clone(),
        command: sandbox_args,
        env: parse_env(&cmd.env),
        stdin_path: Some(PathBuf::from(fifo_name)),
        wall_time_ms: cmd.limits.wall_ms(120_000),
        cpu_time_ms: cmd.limits.cpu_ms(cmd.limits.wall_ms(10_000).min(10_000)),
        mem_kib: cmd.limits.mem_kib(256 * 1024),
        stack_kib: cmd.limits.stack_kib(64 * 1024),
        max_procs: cmd.limits.processes(16),
        use_namespaces: true,
        use_cgroup: true,
        seccomp: SeccompAction::Errno,
        seccomp_allowlist: false,
        share_net: false,
        trace: false,
        ..SandboxConfig::default()
    };
    let cfg_json =
        serde_json::to_string(&cfg).map_err(|e| format!("serialize stream config failed: {e}"))?;
    let mut child = tokio::process::Command::new(&state.cli_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn sandbox-cli({}) failed: {e}", state.cli_path))?;
    if let Some(mut child_stdin) = child.stdin.take() {
        child_stdin
            .write_all(cfg_json.as_bytes())
            .await
            .map_err(|e| format!("write stream sandbox config failed: {e}"))?;
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "sandbox-cli stdout unavailable".to_string())?;

    Ok(StreamRun {
        box_dir,
        stdin: tokio::fs::File::from_std(stdin),
        child,
        stdout,
    })
}

struct PipedCommand {
    cmd: SandboxCommand,
    box_dir: PathBuf,
    cfg: SandboxConfig,
    stdout_max: usize,
    stderr_max: usize,
}

#[derive(Clone)]
struct StartupSignal {
    remaining: Arc<AtomicUsize>,
    notify: Arc<Notify>,
}

impl StartupSignal {
    fn new(count: usize) -> Self {
        Self {
            remaining: Arc::new(AtomicUsize::new(count)),
            notify: Arc::new(Notify::new()),
        }
    }

    fn mark_fd_mapped(&self) {
        if self
            .remaining
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
                (n > 0).then_some(n - 1)
            })
            .is_ok()
        {
            self.notify.notify_waiters();
        }
    }
}

async fn run_piped(
    state: &AppState,
    cmds: Vec<SandboxCommand>,
    pipes: Vec<PipeMapping>,
) -> Result<Vec<RunResult>, String> {
    if cmds.is_empty() {
        return Ok(Vec::new());
    }
    let run_id = uuid::Uuid::new_v4().to_string();
    let pipe_root = state.jobs_root.join("nywoj-pipe").join(&run_id);
    tokio::fs::create_dir_all(&pipe_root)
        .await
        .map_err(|e| format!("create pipe run dir failed: {e}"))?;
    set_mode_777(&pipe_root);

    let mut fd_mappings = vec![Vec::<FdMapping>::new(); cmds.len()];
    let mut fifo_anchors = Vec::with_capacity(pipes.len());
    for (idx, pipe) in pipes.iter().enumerate() {
        if pipe.from.command >= cmds.len() || pipe.to.command >= cmds.len() {
            return Err(format!("pipes index out of range at pipe {idx}"));
        }
        let fifo = pipe_root.join(format!("pipe{idx}.fifo"));
        make_fifo(&fifo)?;
        set_mode_777(&fifo);
        fifo_anchors.push(open_fifo_anchor(&fifo)?);
        fd_mappings[pipe.from.command].push(FdMapping {
            fd: pipe.from.fd,
            path: fifo.clone(),
            mode: FdMode::Write,
        });
        fd_mappings[pipe.to.command].push(FdMapping {
            fd: pipe.to.fd,
            path: fifo,
            mode: FdMode::Read,
        });
    }

    let startup = StartupSignal::new(pipes.len() * 2);
    let anchor_releaser = {
        let startup = startup.clone();
        tokio::spawn(async move {
            let deadline = tokio::time::sleep(std::time::Duration::from_secs(5));
            tokio::pin!(deadline);
            loop {
                if startup.remaining.load(Ordering::SeqCst) == 0 {
                    break;
                }
                tokio::select! {
                    _ = startup.notify.notified() => {},
                    _ = &mut deadline => break,
                }
            }
            drop(fifo_anchors);
        })
    };

    let mut prepared = Vec::with_capacity(cmds.len());
    for (idx, cmd) in cmds.into_iter().enumerate() {
        let box_dir = pipe_root.join(format!("cmd{idx}"));
        match prepare_piped_command(state, cmd, box_dir, fd_mappings[idx].clone()).await {
            Ok(p) => prepared.push(p),
            // 准备失败也要清理：中止持锚任务（释放 FIFO fd）、删掉整棵 pipe_root，
            // 否则失败的多命令请求会在宿主 /tmp 里留下带 FIFO 的目录树。
            Err(e) => {
                anchor_releaser.abort();
                let _ = tokio::fs::remove_dir_all(&pipe_root).await;
                return Err(e);
            }
        }
    }

    let mut handles = Vec::with_capacity(prepared.len());
    for item in &prepared {
        let cli_path = state.cli_path.clone();
        let cfg = item.cfg.clone();
        let stdout_max = item.stdout_max;
        let stderr_max = item.stderr_max;
        let startup = startup.clone();
        handles.push(tokio::spawn(async move {
            run_cli(&cli_path, &cfg, stdout_max, stderr_max, Some(startup)).await
        }));
    }

    let mut out = Vec::with_capacity(prepared.len());
    for (item, handle) in prepared.into_iter().zip(handles) {
        let run_result = match handle.await {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => {
                out.push(internal_run_result(e));
                continue;
            }
            Err(e) => {
                out.push(internal_run_result(format!(
                    "join sandbox task failed: {e}"
                )));
                continue;
            }
        };
        let (result, stdout, stderr, output_limited) = run_result;
        match finish_run_result(
            state,
            item.cmd,
            item.box_dir,
            result,
            stdout,
            stderr,
            output_limited,
        )
        .await
        {
            Ok(result) => out.push(result),
            Err(e) => out.push(internal_run_result(e)),
        }
    }
    let _ = anchor_releaser.await;
    let _ = tokio::fs::remove_dir_all(pipe_root).await;
    Ok(out)
}

async fn prepare_piped_command(
    state: &AppState,
    cmd: SandboxCommand,
    box_dir: PathBuf,
    fd_mappings: Vec<FdMapping>,
) -> Result<PipedCommand, String> {
    if cmd.command.is_empty() {
        return Err("command is empty".into());
    }
    tokio::fs::create_dir_all(&box_dir)
        .await
        .map_err(|e| format!("create pipe box dir failed: {e}"))?;
    set_mode_777(&box_dir);

    for (name, src) in &cmd.input_files {
        let content = if let Some(content) = &src.content {
            content.as_bytes().to_vec()
        } else if let Some(file_id) = &src.cached_file {
            tokio::fs::read(checked_file_path(&state.file_root, file_id)?)
                .await
                .map_err(|e| format!("read cached file {file_id} failed: {e}"))?
        } else {
            Vec::new()
        };
        let target = checked_box_path(&box_dir, name)?;
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("create pipe inputFiles dir failed: {e}"))?;
        }
        tokio::fs::write(&target, content)
            .await
            .map_err(|e| format!("write pipe inputFiles {name} failed: {e}"))?;
        set_mode_777(&target);
    }

    let stdin_piped = fd_mappings.iter().any(|m| m.fd == 0);
    let stdin_path = if stdin_piped {
        None
    } else if let Some(Some(file)) = cmd.stdio.get(0) {
        if let Some(content) = &file.content {
            let p = box_dir.join("stdin.txt");
            tokio::fs::write(&p, content)
                .await
                .map_err(|e| format!("write stdin failed: {e}"))?;
            Some(PathBuf::from("stdin.txt"))
        } else {
            file.name
                .as_deref()
                .map(checked_relative_path)
                .transpose()?
        }
    } else {
        None
    };

    let stdout_max = file_max_for_fd(&cmd.stdio, 1, DEFAULT_CAPTURE_MAX);
    let stderr_max = file_max_for_fd(&cmd.stdio, 2, DEFAULT_CAPTURE_MAX);
    let cfg = SandboxConfig {
        box_dir: box_dir.clone(),
        command: map_command_args(&box_dir, &cmd.command),
        env: parse_env(&cmd.env),
        stdin_path,
        fd_mappings,
        wall_time_ms: cmd.limits.wall_ms(5_000),
        cpu_time_ms: cmd.limits.cpu_ms(cmd.limits.wall_ms(2_000)),
        mem_kib: cmd.limits.mem_kib(256 * 1024),
        stack_kib: cmd.limits.stack_kib(64 * 1024),
        max_procs: cmd.limits.processes(16),
        use_namespaces: true,
        use_cgroup: true,
        seccomp: SeccompAction::Errno,
        seccomp_allowlist: false,
        share_net: false,
        trace: false,
        ..SandboxConfig::default()
    };

    Ok(PipedCommand {
        cmd,
        box_dir,
        cfg,
        stdout_max,
        stderr_max,
    })
}

async fn run_one(state: &AppState, cmd: SandboxCommand) -> Result<RunResult, String> {
    if cmd.command.is_empty() {
        return Err("command is empty".into());
    }

    let run_id = uuid::Uuid::new_v4().to_string();
    let box_dir = state.jobs_root.join("nywoj").join(&run_id);
    tokio::fs::create_dir_all(&box_dir)
        .await
        .map_err(|e| format!("create box dir failed: {e}"))?;
    set_mode_777(&box_dir);

    for (name, src) in &cmd.input_files {
        let content = if let Some(content) = &src.content {
            content.as_bytes().to_vec()
        } else if let Some(file_id) = &src.cached_file {
            tokio::fs::read(checked_file_path(&state.file_root, file_id)?)
                .await
                .map_err(|e| format!("read cached file {file_id} failed: {e}"))?
        } else {
            Vec::new()
        };
        let target = checked_box_path(&box_dir, name)?;
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("create inputFiles dir failed: {e}"))?;
        }
        tokio::fs::write(&target, content)
            .await
            .map_err(|e| format!("write inputFiles {name} failed: {e}"))?;
        set_mode_777(&target);
    }

    let stdin_path = if let Some(Some(file)) = cmd.stdio.get(0) {
        if let Some(content) = &file.content {
            let p = box_dir.join("stdin.txt");
            tokio::fs::write(&p, content)
                .await
                .map_err(|e| format!("write stdin failed: {e}"))?;
            Some(PathBuf::from("stdin.txt"))
        } else if let Some(name) = &file.name {
            Some(checked_relative_path(name)?)
        } else {
            None
        }
    } else {
        None
    };

    let stdout_max = file_max_for_fd(&cmd.stdio, 1, DEFAULT_CAPTURE_MAX);
    let stderr_max = file_max_for_fd(&cmd.stdio, 2, DEFAULT_CAPTURE_MAX);
    let sandbox_args = map_command_args(&box_dir, &cmd.command);
    let cfg = SandboxConfig {
        box_dir: box_dir.clone(),
        command: sandbox_args,
        env: parse_env(&cmd.env),
        stdin_path,
        wall_time_ms: cmd.limits.wall_ms(5_000),
        cpu_time_ms: cmd.limits.cpu_ms(cmd.limits.wall_ms(2_000)),
        mem_kib: cmd.limits.mem_kib(256 * 1024),
        stack_kib: cmd.limits.stack_kib(64 * 1024),
        max_procs: cmd.limits.processes(16),
        use_namespaces: true,
        use_cgroup: true,
        seccomp: SeccompAction::Errno,
        seccomp_allowlist: false,
        share_net: false,
        trace: false,
        ..SandboxConfig::default()
    };

    let (result, stdout, stderr, output_limited) =
        run_cli(&state.cli_path, &cfg, stdout_max, stderr_max, None).await?;
    finish_run_result(state, cmd, box_dir, result, stdout, stderr, output_limited).await
}

async fn finish_run_result(
    state: &AppState,
    cmd: SandboxCommand,
    box_dir: PathBuf,
    result: SandboxResult,
    stdout: String,
    stderr: String,
    mut output_limited: bool,
) -> Result<RunResult, String> {
    let mut files = HashMap::new();
    if should_return_stream(&cmd, 1, "stdout") {
        files.insert("stdout".into(), stdout);
    }
    if should_return_stream(&cmd, 2, "stderr") {
        files.insert("stderr".into(), stderr);
    }
    for name in cmd
        .output_files
        .iter()
        .filter(|x| *x != "stdout" && *x != "stderr")
    {
        let max = file_max_for_name(&cmd.stdio, name, DEFAULT_CAPTURE_MAX);
        if let Some(p) = resolve_existing_box_file(&box_dir, name).await? {
            if let Some((data, truncated)) = read_limited_text(&p, max).await? {
                output_limited |= truncated;
                files.insert(name.clone(), data);
            }
        }
    }

    let mut cached_files = HashMap::new();
    for name in &cmd.cached_outputs {
        if let Some(p) = resolve_existing_box_file(&box_dir, name).await? {
            let id = cache_file(&state.file_root, cmd.cache_prefix.as_deref(), &p).await?;
            cached_files.insert(name.clone(), id);
        }
    }

    let _ = tokio::fs::remove_dir_all(&box_dir).await;
    Ok(result_to_run(result, files, cached_files, output_limited))
}

fn should_return_stream(cmd: &SandboxCommand, fd: usize, name: &str) -> bool {
    cmd.output_files.is_empty()
        || cmd.output_files.iter().any(|x| x == name)
        || cmd
            .stdio
            .get(fd)
            .and_then(|f| f.as_ref())
            .and_then(|f| f.name.as_deref())
            == Some(name)
}

async fn run_cli(
    cli_path: &str,
    cfg: &SandboxConfig,
    stdout_max: usize,
    stderr_max: usize,
    startup: Option<StartupSignal>,
) -> Result<(SandboxResult, String, String, bool), String> {
    let cfg_json =
        serde_json::to_string(cfg).map_err(|e| format!("serialize sandbox config failed: {e}"))?;
    let mut child = tokio::process::Command::new(cli_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn sandbox-cli({cli_path}) failed: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(cfg_json.as_bytes())
            .await
            .map_err(|e| format!("write sandbox-cli stdin failed: {e}"))?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "sandbox-cli stdout unavailable".to_string())?;
    let mut reader = BufReader::new(stdout).lines();
    let mut out = String::new();
    let mut err = String::new();
    let mut output_limited = false;
    let mut result = None;
    while let Some(line) = reader
        .next_line()
        .await
        .map_err(|e| format!("read sandbox-cli event failed: {e}"))?
    {
        if let Ok(ev) = serde_json::from_str::<Event>(&line) {
            match ev {
                Event::Stdout { data } => {
                    output_limited |= push_limited(&mut out, &data, stdout_max)
                }
                Event::Stderr { data } => {
                    output_limited |= push_limited(&mut err, &data, stderr_max)
                }
                Event::Result(r) => result = Some(r),
                Event::Step { title, .. } if title == "重定向额外 fd" => {
                    if let Some(startup) = &startup {
                        startup.mark_fd_mapped();
                    }
                }
                Event::Error { message } => {
                    let mut data = String::new();
                    if !err.is_empty() && !err.ends_with('\n') {
                        data.push('\n');
                    }
                    data.push_str(&message);
                    output_limited |= push_limited(&mut err, &data, stderr_max);
                }
                _ => {}
            }
        }
    }
    let wait = child
        .wait()
        .await
        .map_err(|e| format!("wait sandbox-cli failed: {e}"))?;
    if result.is_none() && !wait.success() {
        if let Some(stderr) = child.stderr.take() {
            let mut er = BufReader::new(stderr);
            let mut s = String::new();
            let _ = er.read_to_string(&mut s).await;
            if !s.is_empty() {
                output_limited |= push_limited(&mut err, &s, stderr_max);
            }
        }
    }
    Ok((
        result.unwrap_or_else(|| SandboxResult::internal_error("missing sandbox result")),
        out,
        err,
        output_limited,
    ))
}

fn result_to_run(
    result: SandboxResult,
    output_files: HashMap<String, String>,
    cached_files: HashMap<String, String>,
    output_limited: bool,
) -> RunResult {
    RunResult {
        status: if output_limited {
            "Output Limit Exceeded"
        } else {
            match result.status {
                Status::Ok => "Accepted",
                Status::Re => "Nonzero Exit Status",
                Status::Sg => "Signalled",
                Status::To => "Time Limit Exceeded",
                Status::Mle => "Memory Limit Exceeded",
                Status::Xx => "Internal Error",
            }
        }
        .into(),
        exit_code: result.exit_code,
        exit_signal: result.exit_signal,
        cpu_time_ms: result.cpu_time_ms,
        memory_kb: result.cg_mem_kib.max(result.max_rss_kib),
        wall_time_ms: result.wall_time_ms,
        output_files,
        cached_files,
    }
}

fn map_command_args(box_dir: &Path, args: &[String]) -> Vec<String> {
    args.iter()
        .enumerate()
        .map(|(idx, arg)| {
            if idx == 0 {
                resolve_executable(box_dir, arg)
            } else if safe_relative_arg(arg) && box_dir.join(arg).exists() {
                format!("/box/{arg}")
            } else {
                arg.clone()
            }
        })
        .collect()
}

fn resolve_executable(box_dir: &Path, arg: &str) -> String {
    if arg == "/usr/bin/g++-9" {
        return "/usr/bin/g++".into();
    }
    if arg == "g++-9" {
        return "/usr/bin/g++".into();
    }
    if arg.starts_with('/') {
        return arg.into();
    }
    if safe_relative_arg(arg) && box_dir.join(arg).exists() {
        return format!("/box/{arg}");
    }
    match arg {
        "gcc" => "/usr/bin/gcc".into(),
        "g++" => "/usr/bin/g++".into(),
        "python3" => "/usr/bin/python3".into(),
        "sh" => "/bin/sh".into(),
        _ => arg.into(),
    }
}

fn parse_env(raw: &[String]) -> Vec<(String, String)> {
    let mut out = SandboxConfig::default().env;
    for item in raw {
        if let Some((k, v)) = item.split_once('=') {
            out.retain(|(existing, _)| existing != k);
            out.push((k.to_string(), v.to_string()));
        }
    }
    out
}

async fn cache_file(
    root: &Path,
    cache_prefix: Option<&str>,
    source: &Path,
) -> Result<String, String> {
    ensure_regular_output_file(source).await?;
    tokio::fs::create_dir_all(root)
        .await
        .map_err(|e| format!("create file cache failed: {e}"))?;
    let uuid = uuid::Uuid::new_v4().simple().to_string().to_uppercase();
    let id = match cache_prefix.and_then(safe_cache_prefix) {
        Some(prefix) => format!("{prefix}_{uuid}"),
        None => uuid,
    };
    let target = checked_file_path(root, &id)?;
    tokio::fs::copy(source, &target)
        .await
        .map_err(|e| format!("cache file failed: {e}"))?;
    Ok(id)
}

fn checked_box_path(box_dir: &Path, name: &str) -> Result<PathBuf, String> {
    let rel = checked_relative_path(name)?;
    Ok(box_dir.join(rel))
}

fn checked_relative_path(name: &str) -> Result<PathBuf, String> {
    let rel = Path::new(name);
    if name.is_empty()
        || rel.is_absolute()
        || name.contains("..")
        || name.bytes().any(|b| b == 0)
    {
        return Err(format!("unsafe sandbox path: {name}"));
    }
    Ok(rel.to_path_buf())
}

fn safe_relative_arg(arg: &str) -> bool {
    let rel = Path::new(arg);
    !rel.is_absolute() && !arg.contains("..")
}

fn checked_file_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty()
        || id.len() > 160
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        || id.contains("..")
    {
        return Err(format!("unsafe cached file id: {id}"));
    }
    Ok(root.join(id))
}

fn safe_cache_prefix(raw: &str) -> Option<String> {
    let prefix: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(*c, '.' | '_' | '-'))
        .take(48)
        .collect();
    if prefix.is_empty() {
        None
    } else {
        Some(prefix)
    }
}

fn file_max_for_fd(files: &[Option<StdioFile>], fd: usize, default: usize) -> usize {
    files
        .get(fd)
        .and_then(|f| f.as_ref())
        .and_then(|f| f.max)
        .map(|m| m.min(HARD_CAPTURE_MAX as u64) as usize)
        .unwrap_or(default)
}

fn file_max_for_name(files: &[Option<StdioFile>], name: &str, default: usize) -> usize {
    files
        .iter()
        .filter_map(|f| f.as_ref())
        .find(|f| f.name.as_deref() == Some(name))
        .and_then(|f| f.max)
        .map(|m| m.min(HARD_CAPTURE_MAX as u64) as usize)
        .unwrap_or(default)
}

fn push_limited(target: &mut String, data: &str, max: usize) -> bool {
    let max = max.min(HARD_CAPTURE_MAX);
    let mut used = target.len();
    if used >= max {
        return !data.is_empty();
    }
    for ch in data.chars() {
        let len = ch.len_utf8();
        if used + len > max {
            return true;
        }
        target.push(ch);
        used += len;
    }
    false
}

async fn read_limited_text(path: &Path, max: usize) -> Result<Option<(String, bool)>, String> {
    match ensure_regular_output_file(path).await {
        Ok(()) => {}
        Err(e) if e.starts_with("output file not found:") => return Ok(None),
        Err(e) => return Err(e),
    }
    let file = match tokio::fs::File::open(path).await {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("read output file failed: {e}")),
    };
    let max = max.min(HARD_CAPTURE_MAX);
    let mut buf = Vec::with_capacity(max.min(1024));
    let mut reader = file.take(max.saturating_add(1) as u64);
    reader
        .read_to_end(&mut buf)
        .await
        .map_err(|e| format!("read output file failed: {e}"))?;
    let truncated = buf.len() > max;
    if truncated {
        buf.truncate(max);
    }
    Ok(Some((
        String::from_utf8_lossy(&buf).into_owned(),
        truncated,
    )))
}

/// 解析 box 内的产物文件，用于读取 stdout 之外的 outputFiles / cachedOutputs。
///
/// 安全要点：被测程序对 `/box` 可写，可能留下**软链接**试图把读取重定向到宿主文件
/// （例如把 `sub/out.txt` 里的 `sub` 做成指向 `/etc` 的软链）。这里逐层设防：
///   1. `symlink_metadata` 拒绝**最终分量**是软链或非普通文件；
///   2. `canonicalize` 解析全部中间软链后，要求真实路径仍落在 box_dir 内，
///      挡住"中间目录软链指向 box 外"这条越权读取路径。
/// 文件不存在时返回 `Ok(None)`（视作未产出，非错误）。
async fn resolve_existing_box_file(box_dir: &Path, name: &str) -> Result<Option<PathBuf>, String> {
    let target = checked_box_path(box_dir, name)?;
    match tokio::fs::symlink_metadata(&target).await {
        Ok(meta) => {
            let ty = meta.file_type();
            if ty.is_symlink() {
                return Err(format!("refuse to read output symlink: {}", target.display()));
            }
            if !ty.is_file() {
                return Err(format!(
                    "refuse to read non-regular output: {}",
                    target.display()
                ));
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("inspect output file failed: {e}")),
    }
    let real = tokio::fs::canonicalize(&target)
        .await
        .map_err(|e| format!("canonicalize output file failed: {e}"))?;
    let root = tokio::fs::canonicalize(box_dir)
        .await
        .map_err(|e| format!("canonicalize box dir failed: {e}"))?;
    if !real.starts_with(&root) {
        return Err(format!(
            "refuse to read output escaping box: {}",
            target.display()
        ));
    }
    Ok(Some(real))
}

async fn ensure_regular_output_file(path: &Path) -> Result<(), String> {
    let meta = tokio::fs::symlink_metadata(path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("output file not found: {}", path.display())
        } else {
            format!("inspect output file failed: {e}")
        }
    })?;
    let ty = meta.file_type();
    if ty.is_symlink() {
        return Err(format!("refuse to read output symlink: {}", path.display()));
    }
    if !ty.is_file() {
        return Err(format!(
            "refuse to read non-regular output: {}",
            path.display()
        ));
    }
    Ok(())
}

fn ws_bytes(msg: Message) -> Option<Vec<u8>> {
    match msg {
        Message::Binary(bytes) => Some(bytes),
        Message::Text(text) => Some(text.into_bytes()),
        _ => None,
    }
}

async fn send_stream_output(socket: &mut WebSocket, fd: u8, data: &[u8]) -> Result<(), String> {
    let mut frame = Vec::with_capacity(data.len() + 2);
    frame.push(2);
    frame.push(fd);
    frame.extend_from_slice(data);
    socket
        .send(Message::Binary(frame))
        .await
        .map_err(|e| format!("send stream output failed: {e}"))
}

async fn send_stream_result(socket: &mut WebSocket, result: RunResult) -> Result<(), String> {
    let payload = serde_json::to_vec(&json!({ "result": result }))
        .map_err(|e| format!("serialize stream result failed: {e}"))?;
    let mut frame = Vec::with_capacity(payload.len() + 1);
    frame.push(1);
    frame.extend_from_slice(&payload);
    socket
        .send(Message::Binary(frame))
        .await
        .map_err(|e| format!("send stream result failed: {e}"))
}

fn internal_run_result(message: impl Into<String>) -> RunResult {
    RunResult {
        status: "Internal Error".into(),
        exit_code: None,
        exit_signal: None,
        cpu_time_ms: 0,
        memory_kb: 0,
        wall_time_ms: 0,
        output_files: HashMap::from([("stderr".into(), message.into())]),
        cached_files: HashMap::new(),
    }
}

fn stream_chunk(used: &mut usize, data: &str, max: usize) -> (String, bool) {
    let max = max.min(HARD_CAPTURE_MAX);
    if *used >= max {
        return (String::new(), !data.is_empty());
    }
    let mut out = String::new();
    let mut limited = false;
    for ch in data.chars() {
        let len = ch.len_utf8();
        if *used + len > max {
            limited = true;
            break;
        }
        out.push(ch);
        *used += len;
    }
    (out, limited)
}

fn make_fifo(path: &Path) -> Result<(), String> {
    let cpath = CString::new(path.to_string_lossy().as_bytes())
        .map_err(|_| format!("fifo path contains nul byte: {}", path.display()))?;
    let rc = unsafe { libc::mkfifo(cpath.as_ptr(), 0o666) };
    if rc == 0 {
        Ok(())
    } else {
        Err(format!(
            "mkfifo({}) failed: {}",
            path.display(),
            std::io::Error::last_os_error()
        ))
    }
}

fn open_fifo_anchor(path: &Path) -> Result<std::fs::File, String> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| format!("open fifo anchor {} failed: {e}", path.display()))
}

fn set_mode_777(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o777));
    }
}
