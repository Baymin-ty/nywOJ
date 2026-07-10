# 方案 12：LLM 出题助手增强（对拍 / validator / 题面一致性）

> 类型：新功能 · 规模：M · 前置：无 · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景与现状（已核实）

出题助手已有相当完整的地基：`server/api/problem/ai.js`（SSE 流式、每用户自己的 LLM key/baseUrl）、`aiPrompt.js`（提示词，含 plan 先行 + 分段生成）、`aiValidate.js`（**草稿自检已存在**：sandbox 真编译、真造数据、失败喂回模型修复，且被 previewData/saveData 复用）、`problemDataGeneratorPanel.vue`（在线造数据 Tab）。本方案是三个增量，全部复用 aiValidate.js 的编译/运行 helper 与限额常量、`server/api/judge/sandbox.js` 客户端。

## 功能 ①：一键对拍（stress test）

- **端点** `stressTest`（题目管理权）：输入 `{ pid, std, brute, generator, rounds≤50, useChecker }`——std 默认取题目已有 STD 资产，brute/generator 可手填或点「让 AI 写」（走现有助手对话生成，提示词加 brute/generator 专用段：brute 强调朴素正确性优先，generator 参数化随机 + 接受 argv seed）。
- **执行**：sandbox 循环：`generator seed_i → input → std/brute 各跑一遍 → 比对`（默认 comparer 宽松比对；useChecker 时用该题 judgeProfile 的 checker，复用 worker 之外的独立调用路径——参照 aiValidate 的做法，不碰判题热路径）。任一轮不一致即停，返回 `{ found: true, seed, input(截断64KB), stdOut, bruteOut, diffHint }`；全轮通过返回 found:false。单轮超时 8s、总时长上限 120s（对齐 aiValidate 的限额风格）。
- **进度**：SSE 或轮询（ai.js 已有 SSE 模式，照抄）。
- **前端**：problemDataGeneratorPanel.vue 加「对拍」区：三个代码框（std 预填）+ 轮数 + 开始按钮 + 进度 + 反例展示（一键把反例 input 存为测试点草稿）。

## 功能 ②：validator 生成与数据体检

- **生成**：aiPrompt.js 加 validator 段——从题面约束生成 testlib validator.cpp（读 stdin 校验格式与范围，`registerValidation` 风格）；生成后走 aiValidate 的真编译自检；保存为出题人资产 `validator.cpp`（资产机制现成）。
- **体检**：端点 `runValidator { pid }`（题目管理权）：编译资产 validator.cpp（无则明确报错），对该题全部 `.in` 逐个运行，汇总 `{ case, ok, message }`；违规列表落到数据页体检展示。**无 LLM key 也可用**（手工上传 validator.cpp 一样跑）。
- **接线**：`getProblemCaseHealth` 增加「有 validator 且体检通过」的加分项提示（不作为 error，warn 级）。

## 功能 ③：题面样例一致性检查

- 端点 `checkSamples { pid }`（题目管理权）：把题面 samples 的 input 喂给 STD 资产（编译复用缓存），输出与题面 sample output 用 comparer 宽松比对；SPJ/交互题给出「不适用」明确提示（交互样例无法直接重放）。返回逐样例 `{ idx, ok, expected, actual }`。
- 前端：problemEdit 样例区 / caseManage 概览条加「校验样例」按钮，结果内联展示。
- LLM 助手生成题面后的自检流程（aiValidate）里追加这一步：样例过不了 STD 时喂回模型修复——与现有「造数据失败喂回」同一模式。

## 验收标准（e2e 层为主，需活沙箱；有 LLM key 的部分单独标注）

- [ ] 对拍：埋一个已知 off-by-one bug 的 std vs 正确 brute + 随机 generator → 50 轮内找到反例且 input/双输出正确；正确 std 对拍全绿返回 found:false；超时不挂进程
- [ ] validator：一份含非法 case 的数据集 → 体检准确指出违规 case 与原因；无 validator 资产时报错文案清晰
- [ ] 样例一致性：故意改错一个样例输出 → 检查标红该样例；SPJ 题按宽松比对不误报
- [ ] LLM 生成 brute/generator/validator（有 key 手测）：编译失败自动喂回修复的既有循环生效
- [ ] 限额：rounds/时长/输出截断全部生效；判题热路径零改动（grep 确认未 import worker）

## 注意

- 三个功能全是题目管理权限内的工具，消耗的是沙箱资源：都挂方案 11 的 rateLimit（每 uid 每 10 分钟 5 次对拍）；11 未合入先内联节流。
- LLM 调用一律用户自己的 key（现有机制），无 key 时 UI 隐藏「让 AI 写」按钮但保留手填路径。
