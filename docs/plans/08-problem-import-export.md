# 方案 08：题目导入导出（完整题 archive + FPS XML）

> 类型：新功能 · 规模：M · 前置：无 · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景与现状（已核实）

`server/api/problem/archive.js` 已有 **数据层** 归档格式 `nywoj.problem-data.v1`（config.json + judgeProfile yaml + 测试数据 zip，含多种 profile 文件名兼容导入）。缺的是：① **完整题**（题面/样例/标签/限制 一起）的导出与导入；② 通用格式 **FPS XML** 的批量导入。存储走 `server/storage.js` 抽象（local/s3），上传路径参考 `server/api/problem/upload.js` 现有 zip 数据导入。

## M1：完整题 archive v2

- 扩展 archive.js：格式 `nywoj.problem.v2` = 在 v1 zip 基础上增加 `problem.json`：
  ```json
  { "format": "nywoj.problem.v2",
    "statement": { "title", "description", "samples": [{"input","output"}], "tags": [], "difficulty": 0,
                    "timeLimit": 1000, "memoryLimit": 256, "langMask": <位掩码> } }
  ```
  数据文件、资产（checker/interactor/grader 等出题人资产）、judgeProfile yaml 沿用 v1 的布局与读写代码。
- 端点：
  - `exportProblem { pid }`（题目管理权，与测试数据下载同级权限）→ 生成 zip 流式下载（大数据题注意流式，不整包进内存；signed URL 机制已有，复用 createFileAccess 模式）。
  - `importProblem`（`problem.create` 权限）：上传 zip → **dry-run 预览**（解析出题面摘要/测试点数/资产清单/profile 体检结果，profile 体检用 judgeProfile.js 现有 profileHealth）→ 用户确认 → createProblem + 写题面 + 落数据与资产 + saveJudgeProfile。默认导入为私有题。
- 兼容：v1 包（纯数据）导入到**已有题**的路径保持不变；v2 包走新题创建。

## M2：FPS XML 批量导入

- FPS（Free Problem Set，`<fps><item>...`）字段映射：`title→title`，`description/input/output/hint` 拼接为题面 markdown（保留原 HTML 段落，经 sanitize），`sample_input/sample_output→samples`，`test_input/test_output`（CDATA 或 base64）→ `.in/.out`，`time_limit/memory_limit`（注意单位属性 s/ms、MB）、`spj` 存在时 → checker 资产 + spj preset profile，否则 traditional preset（buildPreset 已有）。
- 解析：不引重依赖，用轻量 XML parser（`fast-xml-parser`，server/package.json 加一个依赖；若想零依赖需自写 CDATA 处理，不值得）。
- 端点 `importFps`：上传 xml（≤ 50MB）→ dry-run 列表（每题：标题/测试点数/是否 SPJ/预计 pid）→ 确认 → 逐题创建（失败的题跳过并汇报，不整体回滚）。权限 `problem.create`；批量 > 20 题额外要求 `problem.manage.any`（防误操作）。
- 数据落盘走 storage.js（provider=s3 时同样可用——沿用现有数据上传代码路径，验收里明确测 local 即可，s3 标注未测）。

## 前端

- 题目管理页（caseManage 或 problemEdit 的合适位置）加「导出题目包」按钮。
- 题库页（有 problem.create 权限时）加「导入」入口：选 v2 zip 或 FPS xml → dry-run 预览表格 → 确认导入 → 结果汇报（成功 pid 列表 + 失败原因）。

## 验收标准

- [ ] round-trip：任选一道现有 SPJ 题导出 → 新库导入 → 题面/样例/限制/数据/资产/profile 全等（写脚本断言，进 logic 层；判题结果一致进 e2e 层：同一份 AC 代码两边都 AC）
- [ ] FPS：用一份真实 FPS 样例文件（含 SPJ 题与普通题各一）导入成功且可评测；单位换算正确（s→ms、MB）
- [ ] dry-run 不落任何数据；确认后才写库
- [ ] 权限矩阵：无 problem.create 403；批量阈值生效
- [ ] 恶意包防御：zip 路径穿越（`../`）拒绝、超大解压（zip bomb，解压后总量上限 512MB）拒绝、XML 实体注入关闭

## 注意

- 导入题一律私有 + 归属导入者，避免批量导入直接进公开题库。
- Hydro/HOJ 等其他格式不做，记 backlog（v2 archive + FPS 已覆盖主流交换需求）。
