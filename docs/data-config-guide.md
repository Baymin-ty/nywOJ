# 数据配置指南

本文说明 nywOJ 测试数据目录、`config.json`、ZIP 导入和在线造数据面板的约定。

## 数据目录结构

题目 `pid = 1` 的测试数据存放在：

```text
server/data/1/
├── config.json
├── 1.in
├── 1.out
├── ai/
│   ├── small-1.in
│   └── small-1.out
├── assets/
│   └── ai-generator.cpp
└── checker.cpp
```

`config.json` 是评测读取测试点与子任务的入口；`.in` 是输入，`.out` 是标准答案。`assets/` 用于保存 generator、checker、interactor、grader、头文件等出题资产。

## config.json

最小示例：

```json
{
  "cases": [
    { "index": 1, "input": "1.in", "output": "1.out", "subtaskId": 1 },
    { "index": 2, "input": "2.in", "output": "2.out", "subtaskId": 1 }
  ],
  "subtask": [
    { "index": 1, "score": 100, "option": 0, "skip": false, "dependencies": [] }
  ]
}
```

字段规则：

- `cases[].index` 从 1 开始连续递增。
- `cases[].input` / `cases[].output` 是数据目录内的相对路径，不能是绝对路径或 `../`。
- `cases[].subtaskId` 必须指向 `subtask[].index`。
- `subtask[].index` 从 1 开始连续递增。
- `subtask[].score` 是 1 到 100 的整数，所有子任务总分必须为 100。
- `subtask[].option = 0` 表示测试点等分；`option = 1` 表示该子任务全过得分。
- `subtask[].skip` 仅在 `option = 1` 时生效，表示遇到 TLE 后跳过该子任务后续测试点。
- `subtask[].dependencies` 只能依赖编号更小的子任务。

## ZIP 导入

在 `/problem/case/:pid` 的 ZIP 导入区上传 `.zip`。

ZIP 可以包含 `config.json`。有配置时，后端会校验并使用它；没有配置时，后端会扫描所有成对的 `.in/.out` 文件并自动生成一个 100 分子任务。

示例 ZIP：

```text
1.in
1.out
2.in
2.out
config.json
checker.cpp
assets/helper.h
nywoj.yaml
```

导入规则：

- ZIP 解压后总大小默认不超过 200 MB，拥有全局题目管理权限的用户可跳过该大小上限。
- ZIP 内不能包含绝对路径、`../` 路径或符号链接。
- 单层根目录会自动展开，例如 `data/1.in` 会变成 `1.in`。
- `__MACOSX` 和 `.DS_Store` 会被清理。
- ZIP 导入会替换该题数据目录，但如果 ZIP 没带 `checker.cpp` 或 `assets/` 中某些在线资产，会尽量保留已有资产。
- 如果 ZIP 包含 `nywoj.yaml`、`nywoj.yml`、`judgeProfile.yaml`、`nywoj.config.json`、`judgeProfile.json` 等文件，会尝试同步导入评测流程。

## 在线造数据

数据页 `/problem/case/<pid>` 的“在线造数据”Tab 支持两种来源：

- 上传本地 C++14 Generator 和 STD。
- 粘贴完整 `{ "std": ..., "data": ... }` JSON，或只粘贴 `data` 对象。

LLM 生成数据方案放在 `/problem/ai/<pid>` 的 LLM 出题助手中；生成后可在助手的数据 Tab 内预览并保存，也可以导出 JSON 后贴到在线造数据 Tab 继续修改。

当前在线生成协议为 `per-case-stdout`：

```text
./ai-generator <name> <index> <subtaskId> <args...>
```

每个生成点会运行一次 generator：

- `name` 是测试点名称。
- `index` 是测试点序号。
- `subtaskId` 是子任务编号。
- `args...` 来自网页“参数”输入框，按空格分割。
- `stdin` 可由 JSON 的 `generation.cases[].stdin` 提供。
- generator 的 `stdout` 会写入该测试点 `.in`。
- STD 从 stdin 读取该 `.in` 内容，STD 的 `stdout` 会写入 `.out`。

写入后，文件默认落在：

```text
server/data/<pid>/ai/<case-name>.in
server/data/<pid>/ai/<case-name>.out
server/data/<pid>/assets/<generator-file-name>
```

## 生成限制

当前后端限制：

- 最多 50 个测试点。
- Generator 源码不超过 1 MB。
- 单个生成输入或输出不超过 16 MB。
- 一次生成总数据量不超过 128 MB。
- C++ 编译超时 20 秒。
- 单个 generator 运行超时 8 秒。
- 单个 STD 运行超时 8 秒。

“运行预览”会真实编译并执行 generator/STD，但只返回每个测试点的大小和截断预览；“生成并写入”会重新执行一次并覆盖 `config.json`。

## 建议

- generator 保持确定性：同一组参数必须产生同一份输入。
- 把随机种子显式放进参数，例如 `n=100000 seed=17 chain`。
- 小数据点用于暴力对拍，大数据点用于压力和边界。
- 子任务分数先在网页上配好，再运行“数据体检”检查配置。
