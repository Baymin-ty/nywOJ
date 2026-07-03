//! sandbox-cli —— 沙箱引擎的独立可执行入口。
//!
//! 为什么单独做一个进程？因为 `sandbox-core::run` 会 `unshare(NEWPID)` + `fork`，
//! 这在**多线程**进程里是不安全的（fork 后只能用 async-signal-safe 操作）。Web 服务用
//! tokio 是多线程的，所以它把本程序作为**单线程子进程**拉起来，再读它 stdout 上的事件流。
//!
//! 用法：
//!   - 从 stdin 读一段 JSON（= SandboxConfig），或用 `--config <file>`；
//!   - 把每个 Event 以"一行一个 JSON"写到 stdout；
//!   - 也可作为脱离 Web 的命令行沙箱单独使用（对应 isolate 的 CLI 形态）。
//!
//! 例：
//!   echo '{"box_dir":"/box","command":["/box/a.out"],"wall_time_ms":2000, ...}' | sandbox-cli

use std::io::{Read, Write};

use sandbox_core::{run, SandboxConfig};

fn main() {
    let mut raw = String::new();
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--config") {
        let path = args.get(i + 1).expect("--config 需要文件路径");
        raw = std::fs::read_to_string(path).expect("读取 config 文件失败");
    } else {
        std::io::stdin()
            .read_to_string(&mut raw)
            .expect("从 stdin 读取 config 失败");
    }

    let cfg: SandboxConfig = match serde_json::from_str(&raw) {
        Ok(c) => c,
        Err(e) => {
            // 直接打印一个 error 事件，方便上游统一处理。
            println!("{{\"kind\":\"error\",\"message\":\"解析配置失败: {e}\"}}");
            std::process::exit(2);
        }
    };

    let stdout = std::io::stdout();
    let mut report = |ev: sandbox_core::Event| {
        let mut handle = stdout.lock();
        let _ = writeln!(handle, "{}", ev.to_line());
        let _ = handle.flush();
    };

    let result = run(&cfg, &mut report);

    // 退出码：让命令行使用者也能从 $? 判断（0=OK，其余非零）。
    let code = match result.status {
        sandbox_core::Status::Ok => 0,
        _ => 1,
    };
    std::process::exit(code);
}
