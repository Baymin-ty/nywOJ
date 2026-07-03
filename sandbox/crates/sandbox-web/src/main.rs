//! sandbox-web —— 教学沙箱的 Web 前端 + WebSocket 实时事件流。
//!
//! 路由：
//!   GET  /                 静态前端（frontend/index.html）
//!   POST /api/submit       接收 {language, source, limits}，落盘+编译+拉起 sandbox-cli
//!   GET  /ws/:job_id       WebSocket，把该作业的事件流实时推给浏览器
//!
//! 引擎为何是独立子进程：见 sandbox-cli 的说明（fork 不能在多线程进程里做）。

mod api;
mod job;
mod languages;

use std::path::PathBuf;
use std::sync::atomic::Ordering;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use tower_http::services::ServeDir;

use job::{Jobs, SubmitRequest};

#[derive(Clone)]
struct AppState {
    jobs: Jobs,
    cli_path: String,
    jobs_root: PathBuf,
    file_root: PathBuf,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()))
        .init();

    let frontend_dir = std::env::var("FRONTEND_DIR").unwrap_or_else(|_| "frontend".into());
    let cli_path = std::env::var("SANDBOX_CLI").unwrap_or_else(|_| "sandbox-cli".into());
    let jobs_root =
        PathBuf::from(std::env::var("JOBS_ROOT").unwrap_or_else(|_| "/tmp/sandbox-jobs".into()));
    let file_root = PathBuf::from(
        std::env::var("SANDBOX_FILE_ROOT").unwrap_or_else(|_| "/tmp/sandbox-files".into()),
    );
    std::fs::create_dir_all(&jobs_root).ok();
    std::fs::create_dir_all(&file_root).ok();

    let state = AppState {
        jobs: Jobs::new(),
        cli_path,
        jobs_root,
        file_root,
    };

    let app = Router::new()
        .route("/api/submit", post(submit))
        .route("/api/languages", get(list_languages))
        .route("/api/run", post(api::run))
        .route("/api/version", get(api::version))
        .route("/api/stream", get(api::stream))
        .route(
            "/api/file/:file_id",
            get(api::get_file).delete(api::delete_file),
        )
        .route("/ws/:job_id", get(ws_handler))
        .fallback_service(ServeDir::new(&frontend_dir).append_index_html_on_directories(true))
        .with_state(state);

    let addr = std::env::var("BIND").unwrap_or_else(|_| "0.0.0.0:1145".into());
    tracing::info!("listening on http://{addr}  (frontend={frontend_dir})");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn list_languages() -> impl IntoResponse {
    Json(json!({
        "languages": [
            {"id": "c", "name": "C (gcc)"},
            {"id": "cpp", "name": "C++ (g++)"},
            {"id": "python", "name": "Python 3"},
            {"id": "shell", "name": "Shell (sh)"}
        ]
    }))
}

async fn submit(
    State(state): State<AppState>,
    Json(req): Json<SubmitRequest>,
) -> impl IntoResponse {
    match job::submit(
        &state.jobs,
        state.cli_path.clone(),
        state.jobs_root.clone(),
        req,
    ) {
        Ok(job_id) => (
            axum::http::StatusCode::OK,
            Json(json!({ "job_id": job_id })),
        ),
        Err(e) => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({ "error": e })),
        ),
    }
}

async fn ws_handler(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| stream_job(socket, state, job_id))
}

async fn stream_job(mut socket: WebSocket, state: AppState, job_id: String) {
    let Some(job) = state.jobs.get(&job_id) else {
        let _ = socket
            .send(Message::Text(
                json!({"kind":"error","message":"未知 job_id"}).to_string(),
            ))
            .await;
        return;
    };

    let mut idx = 0usize;
    loop {
        // 先登记唤醒，再取增量，避免漏掉两者之间产生的事件。
        let notified = job.notify.notified();

        let (batch, done) = {
            let lines = job.lines.lock().unwrap();
            let batch: Vec<String> = lines[idx..].to_vec();
            idx = lines.len();
            (batch, job.done.load(Ordering::SeqCst))
        };

        for line in batch {
            if socket.send(Message::Text(line)).await.is_err() {
                return; // 客户端断开
            }
        }

        if done {
            break;
        }
        notified.await;
    }

    let _ = socket.send(Message::Close(None)).await;
}
