# Rust Sandbox API Contract

nywOJ 后端现在直接调用仓库内 Rust sandbox 的 `/api/*` 协议。本文记录当前请求/返回形状，避免后端再出现旧执行层兼容字段。

## Endpoints

- `GET /api/version`
- `POST /api/run`
- `GET /api/file/:file_id`
- `DELETE /api/file/:file_id`
- `WS /api/stream`

## Run Request

```jsonc
{
  "commands": [
    {
      "command": ["/usr/bin/python3", "-c", "print(1)"],
      "env": ["PATH=/usr/bin:/bin", "HOME=/tmp"],
      "stdio": [
        { "content": "" },
        { "name": "stdout", "max": 1048576 },
        { "name": "stderr", "max": 1048576 }
      ],
      "limits": {
        "cpuMs": 1000,
        "wallMs": 2000,
        "memoryMB": 128,
        "stackMB": 128,
        "processes": 20
      },
      "inputFiles": {
        "main.py": { "content": "print(1)" },
        "runner": { "cachedFile": "cache-id" }
      },
      "outputFiles": ["stdout", "stderr"],
      "cachedOutputs": ["runner"],
      "cachePrefix": "nywOJ_compile"
    }
  ],
  "pipes": [
    { "from": { "command": 0, "fd": 1 }, "to": { "command": 1, "fd": 0 } }
  ]
}
```

字段约定：

- `commands[]` 中每个命令独立运行在 sandbox box 中；同一请求内的命令不共享 `/box`
- `command` 是 argv 数组
- `stdio[0]` 是 stdin；`stdio[1]` / `stdio[2]` 是 stdout/stderr 捕获配置；管道占用的 fd 可填 `null`
- `limits.cpuMs` / `wallMs` 用毫秒，`memoryMB` / `stackMB` 用 MB
- `inputFiles.*.content` 写入文本内容
- `inputFiles.*.cachedFile` 从 sandbox 文件缓存取编译产物
- `outputFiles` 返回文本输出
- `cachedOutputs` 把 sandbox 内文件保存到缓存，并在返回值中给出 id
- `pipes` 以命令下标和 fd 连接多个命令

## Run Result

```jsonc
[
  {
    "status": "Accepted",
    "exitCode": 0,
    "exitSignal": null,
    "cpuTimeMs": 12,
    "memoryKb": 4096,
    "wallTimeMs": 18,
    "outputFiles": {
      "stdout": "1\n",
      "stderr": ""
    },
    "cachedFiles": {
      "runner": "cache-id"
    }
  }
]
```

`status` 使用 OJ 层判定文本，例如 `Accepted`、`Time Limit Exceeded`、`Memory Limit Exceeded`、`Output Limit Exceeded`、`Nonzero Exit Status`、`Internal Error`。

## Stream

`WS /api/stream` 使用二进制帧：

- type `1`: 首帧执行请求，payload 是 `RunRequest` JSON；只允许一个 command，且不能包含 pipes
- type `2`: sandbox stdout/stderr 输出，第二个字节是 fd
- type `3`: stdin 输入
- type `4`: cancel

最终返回帧 type `1`，payload：

```json
{ "result": { "status": "Accepted", "exitCode": 0, "outputFiles": {} } }
```

## 验证

```bash
curl -fsS http://127.0.0.1:5050/api/version
SANDBOX_URL=http://127.0.0.1:5050 sandbox/scripts/spj-smoke.mjs
SANDBOX_URL=http://127.0.0.1:5050 sandbox/scripts/pipe-smoke.mjs
SANDBOX_URL=http://127.0.0.1:5050 sandbox/scripts/security-smoke.mjs
SANDBOX_WS_URL=ws://127.0.0.1:5050/api/stream sandbox/scripts/stream-smoke.mjs
```
