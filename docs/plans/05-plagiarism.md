# 方案 05：代码查重（算法层 + LLM 判读 / 码风一致性）

> 类型：新功能 · 规模：L · 前置：无 · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景

作业赛制已落地，抄袭检测是老师刚需。设计为两层：**本地算法层**（无 LLM 也完整可用）先全量筛，**LLM 层**（发起者自己的 key，复用现有出题助手的用户 LLM 配置读取逻辑，见 server/api/problem/ai.js）只对高疑似对做判读 + 对单个用户做码风前后一致性评估。

## 数据模型（新建 `server/db/add_plagiarism.sql`，幂等写法参照 add_judgeProfile.sql）

```sql
CREATE TABLE IF NOT EXISTS plagiarismRun (
  runId INT AUTO_INCREMENT PRIMARY KEY,
  cid INT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'running',  -- running / done / failed
  params TEXT NULL,          -- JSON：threshold、是否启用 LLM 等
  progress TEXT NULL,        -- JSON：{ phase, done, total }
  createdBy INT NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finishedAt DATETIME NULL,
  summary TEXT NULL          -- JSON：pair 总数、疑似数、码风风险用户列表
);
CREATE TABLE IF NOT EXISTS plagiarismPair (
  id INT AUTO_INCREMENT PRIMARY KEY,
  runId INT NOT NULL,
  pid INT NOT NULL,
  uidA INT NOT NULL, sidA INT NOT NULL,
  uidB INT NOT NULL, sidB INT NOT NULL,
  similarity DOUBLE NOT NULL,        -- 0~1
  detail TEXT NULL,                  -- JSON：匹配片段行号区间、llmVerdict{suspect,reason}
  KEY idx_run (runId, similarity)
);
```

## M1：算法层（新建 `server/api/judge/plagiarism.js`）

1. **取样**：给定 cid，每人每题取「最后一次 score>0 的提交」（正式提交，排除 virtualId 非空）；答案题（无代码）跳过。
2. **归一化 tokenize**（按 submission.lang 分派，先支持 C/C++/Python/Java，其余按 C-like 兜底）：去注释、字符串/字符字面量归一为占位 token、数字归一、标识符统一映射为 `ID`（保留关键字表）。不追求完整 lexer，正则 + 小状态机即可，函数保持纯（可单测）。
3. **指纹**：k-gram（k=5 token）哈希 + winnowing（窗口 w=4）取指纹集合；相似度 = 指纹 Jaccard。代码过短（<30 token）跳过并标注。
4. **两两比较**：同题内 O(n²)（校内规模每题 ≤ 200 人，可接受）；similarity ≥ 0.5 才落 plagiarismPair；detail 里存双方匹配指纹对应的行号区间（tokenize 时记录 token→行号映射），供前端高亮。
5. **异步执行**：startRun 后在主进程 `setImmediate` 分批跑（每批让出事件循环），进度写 plagiarismRun.progress；不 fork（纯 CPU 但量小；若实测卡事件循环再改 fork，注释写明）。

## M2：LLM 层（可选开关，无 key 时跳过）

1. **疑似对判读**：similarity ≥ threshold（默认 0.7）的 top 50 对，把双方归一化前源码喂 LLM，要求输出 JSON `{suspect: bool, confidence, reason}`（中文 reason，指出具体雷同点），写入 pair.detail.llmVerdict。提示词放 aiPrompt.js 同风格的独立模块。
2. **码风一致性**：对本场每个交了题的用户，取其**历史**（本场之前、非本场）最近 3 份 AC 代码 + 本场代码喂 LLM，评估命名习惯/缩进风格/惯用法是否突变，输出 `{risk: low|mid|high, reason}` 进 run.summary.styleRisks。历史不足 2 份的跳过。
3. 控制成本：并发 2、单次输入截断（每份代码 ≤ 8KB）、总调用数上限进 params。

## 端点与前端

- 端点（router.js；权限 = policy 比赛管理 capability）：`startPlagiarismRun { cid, threshold?, useLlm? }`（同场有 running 的拒绝）、`getPlagiarismRun { runId }`、`listPlagiarismPairs { runId, page }`、`getPairDetail { id }`（返回双方源码 + 匹配区间 + llmVerdict）。
- 前端：比赛管理页新 tab「查重」（`web/src/components/contest/components/` 下新组件）：发起表单（阈值/LLM 开关）、进度条（轮询 getRun）、报表（相似度降序表格，llm 判读列，码风风险列表）、点开 pair → 弹窗并排 diff——monacoEditor.vue 已有 monaco，用 `monaco.editor.createDiffEditor` 只读模式，匹配区间高亮。

## 验收标准

- [ ] logic 测试：三组样本断言——照抄（similarity > 0.9）、改名换空行（> 0.7）、独立实现（< 0.4）；跨语言不比较；tokenize 纯函数单测
- [ ] 异步 run：进度推进、重复发起被拒、failed 状态可重跑
- [ ] 无 LLM key 时算法层完整可用，UI 明确提示 LLM 列不可用
- [ ] LLM 层（有 key 时手测）：判读 JSON 解析健壮（模型输出不合法时降级为「解析失败」不炸 run）
- [ ] 权限：非比赛管理者全部 403

## 注意

- 查重结果是敏感数据：pair 源码接口做权限双检（run 所属 cid 的管理 capability）。
- 不做全站历史查重（只按比赛/作业维度），跨场景需求记 backlog。
