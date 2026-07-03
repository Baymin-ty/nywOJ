//! 语言定义：源文件名、（可选）编译命令、沙箱内运行命令。
//!
//! 路径约定：宿主工作目录会被 bind 成沙箱内的 `/box`，所以"运行命令"用沙箱内视角的
//! `/box/...` 路径；"编译命令"在容器内（宿主侧）执行，用宿主侧真实路径。

use std::path::Path;

pub struct Language {
    pub id: &'static str,
    pub source_name: &'static str,
}

pub fn lookup(id: &str) -> Option<Language> {
    match id {
        "c" => Some(Language {
            id: "c",
            source_name: "main.c",
        }),
        "cpp" => Some(Language {
            id: "cpp",
            source_name: "main.cpp",
        }),
        "python" => Some(Language {
            id: "python",
            source_name: "main.py",
        }),
        "shell" => Some(Language {
            id: "shell",
            source_name: "main.sh",
        }),
        _ => None,
    }
}

impl Language {
    /// 宿主侧编译命令（None = 解释型，无需编译）。`box_dir` 是宿主侧工作目录。
    pub fn compile_cmd(&self, box_dir: &Path) -> Option<Vec<String>> {
        let src = box_dir.join(self.source_name).to_string_lossy().to_string();
        let out = box_dir.join("a.out").to_string_lossy().to_string();
        match self.id {
            "c" => Some(vec![
                "gcc".into(),
                "-O2".into(),
                "-o".into(),
                out,
                src,
                "-lm".into(),
            ]),
            "cpp" => Some(vec!["g++".into(), "-O2".into(), "-o".into(), out, src]),
            _ => None,
        }
    }

    /// 沙箱内运行命令（用 /box 视角路径）。
    pub fn run_cmd(&self) -> Vec<String> {
        match self.id {
            "c" | "cpp" => vec!["/box/a.out".into()],
            "python" => vec!["/usr/bin/python3".into(), "/box/main.py".into()],
            "shell" => vec!["/bin/sh".into(), "/box/main.sh".into()],
            _ => vec!["/box/a.out".into()],
        }
    }
}
