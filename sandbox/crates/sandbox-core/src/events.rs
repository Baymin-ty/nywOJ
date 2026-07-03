//! 结构化事件：贯穿沙箱搭建/运行的每一步，最终以 JSON 行的形式流到 Web 前端。
//!
//! 设计要点（教学）：沙箱被隔离进程（child）和监督进程（supervisor）是**两个进程**，
//! child 里产生的事件不能直接调用 supervisor 的回调，必须经一条 events 管道以
//! "一行一个 JSON" 的方式回传。本文件定义了双方共享的事件协议。

use serde::{Deserialize, Serialize};

use crate::SandboxResult;

/// 沙箱搭建/运行过程中的一个阶段标签，仅用于前端给步骤分组上色。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// 准备：建 cgroup、建管道、fork
    Setup,
    /// 命名空间隔离
    Namespace,
    /// 文件系统：bind mount / tmpfs / pivot_root
    Filesystem,
    /// 资源限制：rlimit / cgroup 写入
    Limits,
    /// 降权 + seccomp
    Security,
    /// execve 之后的运行期
    Run,
    /// 收尾、判定
    Teardown,
}

/// 一个会被推送到前端的事件。`kind` 作为 tag 便于前端 switch 渲染。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Event {
    /// 沙箱"做了一步"：title 一句话，detail 是具体参数，explain 是原理讲解。
    Step {
        phase: Phase,
        title: String,
        detail: String,
        explain: String,
    },
    /// 资源采样（监督者周期性读 cgroup）。
    ResourceSample {
        t_ms: u64,
        mem_kib: u64,
        peak_kib: u64,
        cpu_ms: u64,
        procs: u64,
    },
    /// 一次系统调用（仅 trace 模式，由 ptrace 解出）。
    Syscall {
        nr: i64,
        name: String,
        /// 是否被 seccomp 拦截。
        blocked: bool,
    },
    /// 被测程序的标准输出片段。
    Stdout { data: String },
    /// 被测程序的标准错误片段。
    Stderr { data: String },
    /// 隔离环境快照：被测程序真实看到的根目录/挂载/网卡（搭建完成、execve 前采集）。
    FsSnapshot {
        hostname: String,
        /// `ls /` 的结果。
        root_entries: Vec<String>,
        /// 当前 mount namespace 里的挂载点。
        mounts: Vec<MountInfo>,
        /// 可见网卡（隔离后通常只剩 lo）。
        net_ifaces: Vec<String>,
        /// 宿主上常见、但在沙箱里已"消失"的路径（演示文件系统隔离）。
        gone: Vec<String>,
        /// 当前 euid（userns 模式下沙箱内可为 0，却映射到宿主的非特权 uid）。
        euid: u32,
    },
    /// 最终判定。
    Result(SandboxResult),
    /// 判题结果（与预期输出比对，由 Web 层产生）。
    Judge { verdict: String, message: String },
    /// 沙箱内部错误（搭建失败等）→ 判定为 XX。
    Error { message: String },
}

/// 一条挂载信息（从 /proc/self/mountinfo 解析）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MountInfo {
    pub target: String,
    pub fstype: String,
    pub ro: bool,
}

impl Event {
    pub fn step(
        phase: Phase,
        title: impl Into<String>,
        detail: impl Into<String>,
        explain: impl Into<String>,
    ) -> Self {
        Event::Step {
            phase,
            title: title.into(),
            detail: detail.into(),
            explain: explain.into(),
        }
    }

    /// 序列化成一行 JSON（不含换行）。
    pub fn to_line(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|e| {
            format!("{{\"kind\":\"error\",\"message\":\"serialize event failed: {e}\"}}")
        })
    }
}

/// 监督者侧的事件回调（同进程，可直接调用）。
pub type Reporter<'a> = &'a mut dyn FnMut(Event);
