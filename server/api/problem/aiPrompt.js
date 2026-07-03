// LLM 出题助手的提示词构建。独立成模块的原因：
//   1. 评测预设模板直接取自 judgeProfile.buildPreset —— 与 validateProfile 永远同步，
//      模型照抄模板就能通过校验，不再靠自然语言描述结构。
//   2. 测试脚本可以 require 本模块直接构建消息调模型，不必起 HTTP 服务。
//
// 输出协议（与 ai.js 的流式解析配合）：
//   JSON 顶层键顺序固定 plan → (statement|std|solution|data|judge 子集) → summary。
//   前端在每个顶层键闭合时立即渲染，所以每个 section 必须一次写完整。
//   增量修改时模型只输出需要变化的 section；summary 是给用户的一段话。

const yaml = require('js-yaml');
const { buildPreset } = require('./judgeProfile');

const DRAFT_SECTIONS = ['statement', 'std', 'solution', 'data', 'judge'];

const SECTION_LABEL = {
  statement: '题面', std: 'STD', solution: '题解', data: '数据', judge: '评测',
};

const PRESET_IDS = ['traditional', 'spj', 'answer', 'answer-spj', 'function', 'interactive', 'communication'];

// 各预设的官方 profile 模板（一行 JSON），模型直接复制后按需微调。
const presetTemplates = () => PRESET_IDS
  .map((id) => `${id}: ${JSON.stringify(buildPreset(id))}`)
  .join('\n');

const GENERATOR_SKELETON = [
  '#include <bits/stdc++.h>',
  'using namespace std;',
  'int main(int argc, char** argv) {',
  '  // 平台调用方式固定: ./gen <name> <index> <subtaskId> [k=v ...]',
  '  map<string, string> opt;',
  '  for (int i = 4; i < argc; i++) {',
  '    string s = argv[i]; auto p = s.find(\'=\');',
  '    if (p == string::npos) opt[s] = "1"; else opt[s.substr(0, p)] = s.substr(p + 1);',
  '  }',
  '  auto num = [&](const string& k, long long d) { return opt.count(k) ? stoll(opt[k]) : d; };',
  '  mt19937_64 rng(num("seed", atoll(argv[2])));',
  '  long long n = num("n", 10);',
  '  // ... 按 opt 构造数据，printf/cout 输出到 stdout，结尾换行 ...',
  '  return 0;',
  '}',
].join('\n');

const SYSTEM_PROMPT_HEAD = [
  '你是 OI/ACM 在线评测平台 nywOJ 的资深出题人兼助手，替用户完成一道题的配置：题面、标准程序、题解、测试数据、评测流程。',
  '只返回一个合法 JSON 对象，不要 Markdown 围栏，不要 JSON 之外的任何文字。',
  '',
  '## 输出协议（键的顺序必须严格遵守，前端按流式顺序逐键渲染）',
  '1. 第一个键 "plan"：3~8 条字符串，第一人称短句，像出题人的操作日志（例："设计一道二分答案题"、"编写 std.cpp"、"写生成器覆盖边界+随机+极限"）。修改任务的 plan 要描述本次要改什么。',
  '2. 中间按顺序输出需要的部分：statement → std → solution → data → judge。每个部分必须一次性写完整（前端检测到键闭合立即渲染）。',
  '3. 最后一个键 "summary"：给用户的一段话（中文，2~5 句），说明这次做了什么、有什么假设或需要用户确认的点。像同事交接工作一样自然。',
  '',
  '## 全新生成 vs 增量修改',
  '- 用户消息里若有「当前页面草稿」，本次是增量修改：以草稿为准（它比数据库上下文新），只输出真正需要变化的 section，未变化的 section 一律不要输出（平台会自动保留）。',
  '- 每个输出的 section 都必须是完整的可替换版本，不能只写差量。',
  '- 修改某个 section 时注意连带一致性：改了题面的数据范围就要检查 data/std 是否要跟着改；改了评测方式就要同步 statement 的判定说明。需要连带修改的 section 也要输出。',
  '- 如果用户的要求不需要改任何内容（例如提问、确认），可以只输出 plan 和 summary，在 summary 里回答。',
  '- 全新生成时输出「本次请求的部分」列出的全部 section。',
].join('\n');

const SYSTEM_PROMPT_CONTENT = [
  '## 内容质量要求',
  '- 所有产物必须自洽：std 对全部数据可 AC；题解与 std 思路一致；评测配置与题面承诺的判定规则一致；样例与 std 的实际输出一致（手算验证）。',
  '- 对传统题/提交答案题/函数题，样例必须能被 std.source 直接运行并得到 statement.samples 中完全一致的输出；不确定时用一个小静态点作为样例。',
  '- 不编造不可验证的事实；题意不足时用合理假设，并在 summary 与 data.notes 里说明。',
  '- 图片/外链只能用用户明确给出的 URL，不要虚构。',
  '',
  '## 题面 Markdown（nywOJ 风格）',
  '- statement.description 只写正文，不写一级标题、不重复题目名。',
  '- 用三级标题组织：可选 ### 题目背景、### 题目描述、### 输入格式、### 输出格式、样例、可选 ### 样例解释、### 数据范围。',
  '- 单组样例用 ### 输入样例 / ### 输出样例；多组用 ### 样例 1 输入 / ### 样例 1 输出，编号从 1 起。样例内容用 fenced code block，且必须与 statement.samples 完全一致。',
  '- 数据范围写全部约束；分档用 $\\text{Subtask 1 (20pts)}$ 或 Markdown 表格，最后写「对于全部数据 ...」。',
  '- 公式用行内 $...$；输出的固定字符串用反引号如 `Yes`。',
  '- 交互题题面必须写清：交互流程、每步输出格式、必须 flush、询问次数限制、何时退出。',
  '- SPJ/提交答案题必须写清输出的等价判定条件（精度、任意解规则等）。',
  '- 题解 markdown 包含思路、正确性说明、复杂度分析。',
].join('\n');

const SYSTEM_PROMPT_DATA = [
  '## 测试数据协议（重要，生成的代码会真的被编译运行）',
  '- 默认 data.cases 留空数组，测试数据一律用「生成器 + 生成计划」在线生成，除非用户明确要求静态数据。',
  '- 如果用户明确要求「静态数据 / 固定测试点 / 不要生成器」，必须只填 data.cases；data.generator.source 必须为空字符串，generation.cases 必须为空数组。',
  '- 用户明确说了测试点数量（例如 4 个静态点、10 个生成点）时，这是硬约束，data.cases 或 generation.cases 的数量必须严格等于该数字。',
  '- 平台流程：用 `/usr/bin/g++-9 -O2 -std=c++14 -DONLINE_JUDGE` 编译 data.generator.source 和 std.source（cwd 提供 testlib.h），然后对 generation.cases 的每个条目执行：',
  '  `./gen <name> <index> <subtaskId> <args...>`（stdin 为条目的 stdin 字段），生成器 stdout 即该点 .in；再把 .in 喂给 std，stdout 即 .out。',
  '- 生成器硬性要求：单文件 C++14；只向 stdout 输出输入文件内容；不写文件、不输出日志、不访问网络；同样参数必须产生同样输出（用 seed 决定随机性）；单点 8 秒内跑完。',
  '- generation.cases[].args 一律用 key=value 形式（如 ["n=100000","type=chain","seed=7"]），不要位置参数。生成器骨架（建议照用）：',
  '```',
  GENERATOR_SKELETON,
  '```',
  '- 用 args 表达每个点的意图并覆盖：最小/边界点、小规模点（可对拍）、随机点、特殊结构点（链/星/全同值等）、极限点。10~20 个点为宜（上限 50）。note 写一句该点考察什么。',
  '- generation.cases 里不要放 input/output 内容；stdin 字段几乎总是空串。',
  '- std.source 必须是可独立编译运行的完整程序：从 stdin 读题面格式的输入、向 stdout 写标准答案。函数题也要给独立可运行的 std（把参考实现和读入 main 合在一起），因为它要用来造 .out。',
  '- 交互/通信题的 .out 是给 interactor/manager 的参考答案（case.answer）：std 是离线程序，读 .in 输出该参考答案；若协议不需要参考答案，也要输出一个占位行。',
  '- subtasks 的 score 总和必须为 100；generation.cases 的 subtaskId 必须存在于 subtasks。单 subtask 时就写 [{"index":1,"score":100,"option":0,"skip":false,"dependencies":[]}]。',
  '- 单点数据 ≤ 16MB，总量 ≤ 128MB；极限点规模按数据范围算好字节数，别超。',
].join('\n');

const systemPromptJudge = () => [
  '## 评测配置（judgeProfile v1）',
  '- judge.preset 只能是 traditional/spj/answer/answer-spj/function/interactive/communication/custom。',
  '- judge.profile 直接从下面的官方模板复制，再按需微调（通常只需要改 submit 槽的 label/maxKB 或 pipeGroup 的 limits）。不要自创结构：',
  presetTemplates(),
  '- 引用只能用：case.input、case.answer、submit.answer、asset:<name>、step:<id>.stdout/stderr、{"literal":"..."}。',
  '- 不要输出 judge.yaml，平台会从 judge.profile 自动生成。',
  '- 只要 preset 不是 traditional/answer：judge.profile.assets 声明的每个文件都必须在 judge.assets 里给出同名条目，content 是完整可编译的源码。缺内容 = 保存失败。',
  '- 传统题不要无故加 checker/interactor；模板已含 default check。',
  '',
  '### 各题型资产写法（testlib.h 可用，已在编译 cwd）',
  '- SPJ checker.cpp：`registerTestlibCmd(argc, argv)`，inf/ouf/ans 分别是输入/选手输出/标准答案；结论用 quitf(_ok/_wa/_pe, ...)，部分分用 quitp(分数0~1, ...)。',
  '- 交互题 interactor.cpp：`registerInteraction(argc, argv)`；argv 固定为 case.input、tout.txt（占位）、case.answer（模板已写好）；从 inf 读测试点输入，与选手通过 stdout/stdin 实时交互（printf 后必须 fflush(stdout)），从 ouf 读选手的回复；结束用 quitf。',
  '- 通信题 manager.cpp：用 fdopen(3,"r")/fdopen(4,"w") 与 sideA 通信、fdopen(5,"r")/fdopen(6,"w") 与 sideB 通信（写完要 fflush）；argv[1]=输入文件、argv[2]=参考答案文件；verdict 用 exit code 0 表 AC（或 testlib quitf）。选手代码用 -DSIDE_A/-DSIDE_B 各编译一份。',
  '- 函数题：选手交 solution.h；assets 提供 grader.cpp（含 main，读输入、调选手函数、输出）和 problem.h（函数声明）；grader.cpp 里 #include "problem.h" 和 #include "solution.h"。',
  '- 提交答案题（answer/answer-spj）：submit.mode="answer" 无编译；check 的第 2 个参数是 submit.answer。',
].join('\n');

const SYSTEM_PROMPT_SCHEMA = [
  '## JSON Schema（未请求/未变化的键省略；plan 最前，summary 最后）',
  '{"plan":["..."],' +
  '"statement":{"title":"","description":"","tags":[],"timeLimit":1000,"memoryLimit":256,"level":0,"samples":[{"inputData":"","outputData":""}]},' +
  '"std":{"language":"cpp","fileName":"std.cpp","source":"","explanation":"一句话说明做法"},' +
  '"solution":{"title":"","markdown":""},' +
  '"data":{"cases":[],"subtasks":[{"index":1,"score":100,"option":0,"skip":false,"dependencies":[]}],' +
  '"generator":{"language":"cpp","fileName":"ai-generator.cpp","source":""},' +
  '"generation":{"mode":"per-case-stdout","cases":[{"name":"01-min","subtaskId":1,"args":["n=1","seed=1"],"stdin":"","note":"最小边界"}]},"notes":""},' +
  '"judge":{"preset":"traditional","profile":{},"assets":[{"name":"checker.cpp","role":"checker","language":"cpp","content":""}],"notes":""},' +
  '"summary":""}',
  '- level：0 未评级 1 入门 2 普及 3 提高 4 省选 5 NOI。timeLimit 毫秒，memoryLimit MB。',
  '- 文件名只用字母数字点下划线短横线。',
  '',
  '## 输出前自查（逐条过一遍再输出）',
  '1. std 读的输入格式 = generator 输出格式 = 题面输入格式？',
  '2. 样例的输出真的是 std 对样例输入的运行结果？',
  '3. subtask 分数总和 = 100？每个生成点的 subtaskId 都存在？',
  '4. judge.profile.assets 声明的文件在 judge.assets 里都有完整 content？',
  '5. 生成器对极限参数不会超时/爆内存？输出规模在限制内？',
].join('\n');

let cachedSystemPrompt = '';
const systemPrompt = () => {
  if (!cachedSystemPrompt) {
    cachedSystemPrompt = [
      SYSTEM_PROMPT_HEAD,
      SYSTEM_PROMPT_CONTENT,
      SYSTEM_PROMPT_DATA,
      systemPromptJudge(),
      SYSTEM_PROMPT_SCHEMA,
    ].join('\n\n');
  }
  return cachedSystemPrompt;
};

// options: { currentDraftText, promptHistory, mode: 'create'|'edit'|'repair' }
const buildUserMessage = (prompt, sections, problemContext, options = {}) => {
  const wanted = sections.map((key) => `${key}（${SECTION_LABEL[key] || key}）`).join('、');
  const hasDraft = !!(options.currentDraftText && options.currentDraftText.trim());
  const mode = options.mode || (hasDraft ? 'edit' : 'create');
  const promptHistory = Array.isArray(options.promptHistory) ? options.promptHistory : [];
  const lines = [];
  if (mode === 'repair') {
    lines.push('任务模式：自动修复。刚才生成的草稿没有通过平台自检，请根据自检报告修复问题。只输出需要修改的 section 和 summary。');
  } else if (mode === 'edit') {
    lines.push(`任务模式：增量修改。基于「当前页面草稿」继续，只输出需要变化的 section。本次允许修改的范围：${wanted}。`);
  } else {
    lines.push(`任务模式：全新生成。请输出全部这些部分：${wanted}。`);
  }
  lines.push('', '题目在数据库中的现状（仅供参考，草稿优先）：', JSON.stringify(problemContext, null, 1));
  if (promptHistory.length) {
    lines.push('', '之前几轮用户的要求（从旧到新，修改时保持这些约束仍然成立）：', JSON.stringify(promptHistory, null, 1));
  }
  if (hasDraft) {
    lines.push('', '当前页面草稿（含用户未保存的手动编辑，增量修改必须以此为基础）：', options.currentDraftText);
  }
  lines.push('', mode === 'repair' ? '自检报告与修复要求：' : '用户本次的要求：', prompt);
  return lines.join('\n');
};

const buildMessages = (prompt, sections, problemContext, options = {}) => ([
  { role: 'system', content: systemPrompt() },
  { role: 'user', content: buildUserMessage(prompt, sections, problemContext, options) },
]);

// 自检失败后回喂模型的修复提示词。checks 是 runDraftChecks 的结果数组。
const buildRepairPrompt = (checks) => {
  const failed = (checks || []).filter((c) => c.status === 'fail');
  const lines = ['平台自检结果（fail 的必须修复）：'];
  for (const c of checks || []) {
    lines.push(`- [${c.status}] ${c.label}${c.detail ? `：${c.detail}` : ''}`);
  }
  lines.push('', '修复要求：');
  lines.push('- 逐条分析 fail 的原因（编译错误看报错行号；运行失败看 stderr；配置校验看提示）。');
  lines.push('- 必须继续遵守原始用户要求和当前草稿的题型设定；如果用户明确要求静态数据/生成器/SPJ/交互/通信，不要在修复时悄悄换方案。');
  lines.push('- 只输出需要修改的 section（完整版本），其余不要动。');
  lines.push('- 不要为了绕过检查而删功能（比如删掉生成点、清空资产）；要修根因。');
  if (failed.some((c) => c.id && String(c.id).startsWith('gen'))) {
    lines.push('- 生成器修复后自查：argv 契约 `<name> <index> <subtaskId> [k=v...]`、只写 stdout、确定性、别超 8 秒。');
  }
  return lines.join('\n');
};

const dumpYaml = (obj) => {
  const dump = yaml.dump || yaml.safeDump;
  return dump(obj, { indent: 2, lineWidth: 120 });
};

module.exports = {
  DRAFT_SECTIONS,
  SECTION_LABEL,
  systemPrompt,
  buildMessages,
  buildRepairPrompt,
  dumpYaml,
};
