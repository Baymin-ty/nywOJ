# 统一评测流水线

当前 worker 只有一条评测路径：把题目的 `judgeProfile` 解释成编译、运行、管道和裁决步骤。数据库里还没有存 `judgeProfile` 的旧题，会在运行时由 `problem.type` 派生等价 preset，然后同样进入 profile 解释器。

## 1. 数据模型

`problem.judgeProfile` 存储 JSON profile。`problem.type` 仍保留，用于列表展示、导入导出和旧数据派生 preset；运行行为以 profile 为准。

`submissionFile` 存多文件提交的附加文件。主 source 槽仍镜像到 `submission.code` / `submission.lang`，保证列表、详情和重测查询不用跨表才能展示主代码。

出题人资产存放：

- `data/{pid}/checker.cpp`
- `data/{pid}/assets/<name>`

`checker.cpp` 保持顶层路径，其余资产进 `assets/`。文件名只允许安全字符，禁止绝对路径、`..` 和目录分隔符。

## 2. Profile Schema

```jsonc
{
  "version": 1,
  "preset": "traditional",
  "submit": {
    "mode": "code",
    "files": [
      { "label": "你的代码", "kind": "source", "maxKB": 100 }
    ]
  },
  "assets": [
    { "name": "checker.cpp", "role": "checker", "lang": "C++" }
  ],
  "compile": [
    { "id": "main", "command": "auto" }
  ],
  "run": {
    "perCase": [
      {
        "id": "run",
        "kind": "exec",
        "exec": "main",
        "args": [],
        "stdin": { "from": "case.input" },
        "limits": { "time": "problem", "mem": "problem" },
        "capture": ["stdout", "stderr"]
      },
      {
        "id": "check",
        "kind": "check",
        "checker": "default",
        "args": ["case.input", "step:run.stdout", "case.answer"]
      }
    ]
  }
}
```

## 3. Step Types

- `exec`: 运行一个编译产物，输入来自 `case.input`、资产、字面量、提交答案或前置步骤输出。
- `check`: 使用 `default`、`asset:<name>` 或某个 compile 产物作为 checker。testlib checker 按 `inf usr ans` 参数约定运行。
- `pipeGroup`: 同时运行多个成员，用 `pipes` 连接 fd，覆盖交互题和通信题。`verdictFrom` 指定裁决成员，`chargeTimeTo` 指定时间/内存归属成员。

## 4. Sandbox Mapping

后端统一通过 `server/api/judge/sandbox.js` 调用 Rust sandbox：

```jsonc
{
  "commands": [
    {
      "command": ["main"],
      "env": ["PATH=/usr/bin:/bin", "HOME=/tmp"],
      "stdio": [
        { "content": "input" },
        { "name": "stdout", "max": 67108864 },
        { "name": "stderr", "max": 67108864 }
      ],
      "limits": {
        "cpuMs": 1000,
        "wallMs": 2000,
        "memoryMB": 256,
        "stackMB": 256,
        "processes": 50
      },
      "inputFiles": {
        "main": { "cachedFile": "..." }
      },
      "outputFiles": ["stdout", "stderr"],
      "cachedOutputs": []
    }
  ],
  "pipes": [
    { "from": { "command": 0, "fd": 1 }, "to": { "command": 1, "fd": 0 } }
  ]
}
```

返回值使用 `exitCode`、`cpuTimeMs`、`memoryKb`、`wallTimeMs`、`outputFiles`、`cachedFiles`。

## 5. Presets

| preset | submit | compile | per-case flow |
|---|---|---|---|
| `traditional` | source | auto main | exec main -> default check |
| `spj` | source | auto main | exec main -> `asset:checker.cpp` |
| `answer` | answer files | none | default check |
| `answer-spj` | answer files | none | `asset:checker.cpp` |
| `function` | source header | grader + submit file | exec product -> check |
| `interactive` | source | main + interactor | pipeGroup user/judge |
| `communication` | source | manager + sides | pipeGroup multi-fd |

## 6. Error Classes

- Sandbox/backend/network faults become `System Error`.
- Missing data, invalid profile, checker compile failure, checker FAIL/crash and malformed assets become `Judgement Failed`.
- User compile failures become `Compilation Error`.
- User runtime statuses map through sandbox status strings: `Accepted`、`Wrong Answer`、`Time Limit Exceeded`、`Memory Limit Exceeded`、`Output Limit Exceeded`、`Nonzero Exit Status` 等。

## 7. Code Map

| file | responsibility |
|---|---|
| `server/api/problem/judgeProfile.js` | presets, profile validation, asset APIs, profile health, judge summary |
| `server/api/judge/worker.js` | profile interpreter, compile/run/check/pipeGroup execution, aggregation |
| `server/api/judge/core.js` | submit, submitMulti, submitAnswer, queue and result APIs |
| `server/api/judge/languages.js` | language compile/run commands and stdio helpers |
| `server/api/judge/sandbox.js` | Rust sandbox HTTP/WebSocket client |
| `server/api/judge/checkerCache.js` | SPJ checker cached-output metadata |
| `server/db/migrate_profiles.js` | idempotent profile backfill for type-only rows |
| `server/db/audit_profiles.js` | read-only profile and asset health audit |
| `web/src/components/problem/judge/` | visual profile editor |

## 8. Verification

```bash
node -c server/api/judge/worker.js
node -c server/api/problem/judgeProfile.js
curl -fsS http://127.0.0.1:5050/api/version
SANDBOX_URL=http://127.0.0.1:5050 sandbox/scripts/spj-smoke.mjs
SANDBOX_URL=http://127.0.0.1:5050 sandbox/scripts/pipe-smoke.mjs
SANDBOX_URL=http://127.0.0.1:5050 sandbox/scripts/security-smoke.mjs
SANDBOX_WS_URL=ws://127.0.0.1:5050/api/stream sandbox/scripts/stream-smoke.mjs
```
