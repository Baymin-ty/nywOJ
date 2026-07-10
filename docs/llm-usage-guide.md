# LLM 使用指南

本文说明 nywOJ 的 LLM 出题助手与在线造数据面板如何使用。

## 配置模型

在 `/problem/ai/:pid` 或 `/problem/case/:pid` 中填写：

- `Base URL`：OpenAI 兼容接口地址，例如 `https://api.openai.com/v1`。
- `API Key`：用户自己的 Key，会保存在 `userLlmConfig` 表中。
- `模型`：例如 `gpt-4o-mini`，也可以填写私有网关中的模型名。

后端会优先使用用户保存的配置；`server/config.json` 中的 `LLM` / `llm` / `AI` / `OPENAI` 可作为默认 Base URL、默认模型、超时和 token 上限配置。

示例：

```json
{
  "LLM": {
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "timeout": 120000,
    "maxTokens": 8192
  }
}
```

## 出题助手

完整助手页面在：

```text
/problem/ai/<pid>
```

它可以生成并保存：

- 题面与样例。
- STD。
- 题解草稿。
- 测试数据方案。
- judgeProfile / `nywoj.yaml` / checker 等评测资产。

题面正文中的样例由结构化的 `statement.samples` 单独维护。Markdown 里不需要再写 `### 输入样例` / `### 输出样例` 和对应代码块；如需指定样例展示位置，单独放一行 `<!-- case -->`（兼容 `<!-- samples -->`）即可。

生成后先在页面中预览、修改，再分别点击保存。数据和评测流程建议分开保存：先保存评测配置，再生成数据，最后使用数据体检检查。

## LLM 数据生成

LLM 数据生成放在完整助手页面：

```text
/problem/ai/<pid>
```

助手的数据 Tab 只关注 STD 和测试数据：

1. 在提示词中选择“数据”和“STD”，让 LLM 生成 `std` + `data` 草稿。
2. 检查生成点、参数、子任务分数和 generator 源码。
3. 点击“运行预览”。
4. 确认 `.in/.out` 大小和截断内容。
5. 点击“保存测试数据”覆盖当前测试数据。

数据管理页 `/problem/case/<pid>` 另有“在线造数据”Tab，用于上传本地 generator/STD、粘贴 JSON、在线配置生成点并写入数据；它不包含 LLM 配置和提示词入口。

## 推荐给 LLM 的数据提示词

可以直接使用下面模板：

```text
请只生成 STD 和测试数据方案。

题目要点：
- 算法：
- 主要约束：
- 时间复杂度目标：
- 需要覆盖的边界：

数据要求：
- 使用 data.generator.source 和 data.generation.cases。
- 不要把大数据直接放进 data.cases。
- generator 是确定性的 C++14 程序。
- 协议固定为 per-case-stdout：
  ./ai-generator <name> <index> <subtaskId> <args...>
- generator 只向 stdout 输出输入文件，不写文件，不访问网络。
- STD 从 stdin 读取输入，向 stdout 输出标准答案。
- generation.cases 的 args 写规模、seed 和特殊性质。
- subtasks 总分必须为 100。
```

## JSON 结构

LLM 返回完整对象时推荐结构：

```json
{
  "std": {
    "language": "cpp",
    "fileName": "std.cpp",
    "source": "..."
  },
  "data": {
    "cases": [],
    "subtasks": [
      { "index": 1, "score": 30, "option": 0, "skip": false, "dependencies": [] },
      { "index": 2, "score": 70, "option": 1, "skip": true, "dependencies": [1] }
    ],
    "generator": {
      "language": "cpp",
      "fileName": "ai-generator.cpp",
      "source": "..."
    },
    "generation": {
      "mode": "per-case-stdout",
      "cases": [
        { "name": "small-1", "subtaskId": 1, "args": ["n=10", "seed=1"], "stdin": "", "note": "small random" },
        { "name": "max-1", "subtaskId": 2, "args": ["n=200000", "seed=17"], "stdin": "", "note": "max random" }
      ]
    },
    "notes": ""
  }
}
```

数据页的“解析 JSON”也接受只包含 `data` 内容的对象。

## Generator 规范

推荐 generator 模式：

```cpp
#include <bits/stdc++.h>
using namespace std;

int main(int argc, char **argv) {
    string name = argc > 1 ? argv[1] : "1";
    int index = argc > 2 ? atoi(argv[2]) : 1;
    int subtask = argc > 3 ? atoi(argv[3]) : 1;
    int n = 10;
    int seed = index;
    for (int i = 4; i < argc; i++) {
        string arg = argv[i];
        if (arg.rfind("n=", 0) == 0) n = stoi(arg.substr(2));
        if (arg.rfind("seed=", 0) == 0) seed = stoi(arg.substr(5));
    }
    mt19937 rng(seed);
    cout << n << "\n";
    for (int i = 1; i <= n; i++) {
        cout << (int)(rng() % 1000) << (i == n ? '\n' : ' ');
    }
    return 0;
}
```

如果使用 `testlib.h`，后端编译时会把 `server/comparer` 加入 include path，因此可直接：

```cpp
#include "testlib.h"
```

## 安全与成本

- 在线生成会通过 Rust sandbox 编译并运行 generator/STD，只给可信出题人开放题目管理权限。
- 不要让 LLM 生成访问网络、系统目录、长时间循环或读写文件的 generator。
- 大规模数据建议先用少量点预览，再扩大生成点。
- LLM 返回的代码必须人工检查后再写入。
- API Key 属于用户个人配置，不要写进题面、题解、generator 或公开文档。

## 提示词回归测试

修改系统提示词或评测接口后，可以在 `server/` 目录运行：

```bash
node scripts/aiAssistantE2E.js --list
node scripts/aiAssistantE2E.js --dry-run
node scripts/aiAssistantE2E.js traditional spj answer function interactive communication
```

`--dry-run` 只构建各题型消息，不调用模型；真调模型需要当前 uid 已保存 LLM Key，并启动 sandbox。临时没有 sandbox 时可加 `--skip-sandbox` 先检查模型返回结构与题型契约。

## 排错

- `请先配置自己的 LLM Key 和 Base URL`：保存 LLM 配置后重试。
- `在线生成需要 STD`：生成点模式必须提供 STD。
- `C++ 编译失败`：检查 C++14 语法、头文件和文件名。
- `执行超时或输出过大`：减少单点规模，或优化 generator/STD。
- `子任务分数之和应等于100分`：检查子任务分数；在线保存会尽量归一到单个 100 分子任务，正式数据建议单独校准分档。
