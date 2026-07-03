#!/usr/bin/env node
// LLM 出题助手端到端测试：对每种题型真调模型 → 解析草稿 → sandbox 编译/试造数据/
// 校验评测配置，自检失败按线上逻辑回喂修复。用于验证提示词改动后所有题型仍然可用。
//
// 用法（在 server/ 目录下）：
//   node scripts/aiAssistantE2E.js                          # 全部题型
//   node scripts/aiAssistantE2E.js spj interactive          # 指定题型
//   node scripts/aiAssistantE2E.js answer-static-math edit-title-only
//   node scripts/aiAssistantE2E.js --model gpt-5.3-codex-spark --uid 1
//
// 需要：MySQL（读 userLlmConfig 的 key）、sandbox（127.0.0.1:5050）。

const aiPrompt = require('../api/problem/aiPrompt');
const { runDraftChecks } = require('../api/problem/aiValidate');
const { validateProfile } = require('../api/problem/judgeProfile');
const { _internals } = require('../api/problem/ai');

const fs = require('fs');
const path = require('path');

const {
  buildMessages, extractJson, extractCompletePayloadSections, normalizeDraft,
  mergeDraftSections, draftSectionKeys, chatCompletionStream, loadUserLlmConfig,
} = _internals;

const DUMP_DIR = path.join(__dirname, '..', '..', 'sandboxout-ai-e2e');

// 线上同款兜底：整体 JSON 解析失败时逐 section 恢复（applyPartialDraftFromRaw 的行为）。
const parseModelContent = (content, label) => {
  try {
    return { parsed: extractJson(content), recovered: false };
  } catch (err) {
    const { payload, found } = extractCompletePayloadSections(content);
    fs.mkdirSync(DUMP_DIR, { recursive: true });
    const dumpPath = path.join(DUMP_DIR, `${label}-${Date.now()}.raw.txt`);
    fs.writeFileSync(dumpPath, content);
    console.log(`  ⚠️  整体 JSON 解析失败（${err.message}），已恢复 section: ${found.join(',') || '无'}；原始输出: ${dumpPath}`);
    if (!found.length) throw err;
    return { parsed: payload, recovered: true };
  }
};

const ALL_SECTIONS = ['statement', 'std', 'solution', 'data', 'judge'];
const MAX_REPAIR_ROUNDS = 2;

const SCENARIOS = {
  traditional: {
    preset: 'traditional',
    prompt: '出一道普及组难度的传统题：给定 n 个整数和整数 k，问有多少个连续子段的和恰好等于 k。n ≤ 2×10^5，数值绝对值 ≤ 10^9。要求完整题面、std、题解、生成器造 12 个左右测试点（含边界和极限），传统评测。',
    expects: { generator: true },
  },
  spj: {
    preset: 'spj',
    prompt: '出一道答案不唯一、需要 SPJ 的题：给定无向连通图（n ≤ 1e5, m ≤ 2e5），输出任意一棵生成树的边编号列表。需要 testlib checker 验证选手输出确实是生成树。生成完整题面、std、题解、数据和 SPJ 评测配置。',
    expects: { generator: true, asset: 'checker.cpp' },
  },
  answer: {
    preset: 'answer',
    prompt: '出一道提交答案题（answer 模式，不评测代码）：给出 5 个固定测试点，每个点是一个 4×4 拉丁方残缺表（0 表示空格），选手直接提交每个点的完整 4×4 解。必须用静态数据（直接给 input/output），不要使用生成器，默认逐字节比较即可。',
    expects: { staticOnly: true, staticCases: 5 },
  },
  'answer-spj': {
    preset: 'answer-spj',
    prompt: '出一道提交答案 + SPJ 的题：每个测试点给一个 n ≤ 50 的无向图，选手提交一个尽量大的独立集（顶点列表），checker 验证合法性并按大小给部分分（quitp）。必须用静态数据直接给 4 个点，不要使用生成器。',
    expects: { staticOnly: true, staticCases: 4, asset: 'checker.cpp' },
  },
  function: {
    preset: 'function',
    prompt: '出一道函数题：实现 solution.h 中的函数 long long solve(int n, std::vector<int> a)，返回数组的最大子段和（n ≤ 1e5）。提供 grader.cpp（读输入、调 solve、输出返回值）和 problem.h（声明），std 用于造数据（独立可运行版本）。生成器造 10 个点。',
    expects: { generator: true, generationCases: 10, asset: 'grader.cpp' },
  },
  interactive: {
    preset: 'interactive',
    prompt: '出一道交互题：评测器心里想一个 1..n 的整数（n ≤ 1e6，从测试点输入读），选手每次输出 "? x" 询问大小关系（回答 "<"、">" 或 "="），最多 25 次，猜中后输出 "! x"。需要 testlib interactor，完整题面（写清交互协议和 flush 要求）、std（离线输出答案本身作为参考答案）、生成器和交互评测配置。',
    expects: { generator: true, asset: 'interactor.cpp' },
  },
  communication: {
    preset: 'communication',
    prompt: '出一道通信题：两个程序 A、B 分别拿到一个 0..10^9 的整数 x 和 y（分别在输入文件第一行、第二行），A 只能给 B 发送不超过 40 个 bit（每次一行 0/1），B 收到后要输出 x+y。manager 负责转发并裁判。提供 manager.cpp、以 -DSIDE_A/-DSIDE_B 区分的选手示例说明、完整题面、std（离线读入 x y 输出 x+y 作为参考答案）、生成器和通信评测配置。',
    expects: { generator: true, asset: 'manager.cpp' },
  },
  'answer-static-math': {
    preset: 'answer',
    prompt: '压力测试：出一道提交答案题，题目给出 6 个固定整数序列，选手只提交每个序列的最长上升子序列长度。必须是 answer 模式；必须全部用 data.cases 静态数据直接写 input/output；不要写 generator，不要写 generation.cases，不要改成传统题。',
    expects: { staticOnly: true, staticCases: 6 },
  },
  'traditional-static': {
    preset: 'traditional',
    prompt: '压力测试：出一道传统题，给定一个小图求最短路，只需要 5 个手写静态测试点，必须全部放在 data.cases 里，明确不要生成器、不要 generation.cases。仍需完整 std、题解和传统评测配置。',
    expects: { staticOnly: true, staticCases: 5, std: true },
  },
  'spj-construct-static': {
    preset: 'spj',
    prompt: '压力测试：出一道 SPJ 构造题，给定 n≤30，输出任意一个长度为 n 的 01 串且 1 的个数恰好为 k。必须用 6 个静态测试点，不要生成器；checker.cpp 用 testlib 验证长度、字符和 1 的数量。',
    expects: { staticOnly: true, staticCases: 6, asset: 'checker.cpp', std: true },
  },
  'edit-title-only': {
    preset: 'traditional',
    prompt: '多轮测试第一轮：出一道传统题，给定 n 个整数，求最大子段和。n≤200000，生成器造 10 个点，完整题面、std、题解、数据和传统评测。',
    expects: { generator: true, generationCases: 10, std: true },
    edit: {
      sections: ['statement'],
      prompt: '只把题目标题改成「最大连续和」，并润色题面第一段；不要修改 STD、题解、测试数据、评测配置。',
      expectedSections: ['statement'],
    },
  },
};

const PRESET_PROMPTS = Object.fromEntries(Object.entries(SCENARIOS).map(([key, item]) => [key, item.prompt]));

const FAKE_PROBLEM = {
  pid: 9999,
  title: '',
  description: '',
  timeLimit: 1000,
  memoryLimit: 256,
  tags: [],
  level: 0,
  samples: [],
};

const parseArgs = () => {
  const argv = process.argv.slice(2);
  const opts = { presets: [], model: '', uid: 1, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') opts.model = argv[++i];
    else if (a === '--uid') opts.uid = Number(argv[++i]);
    else if (a === '-v' || a === '--verbose') opts.verbose = true;
    else opts.presets.push(a);
  }
  if (!opts.presets.length) {
    opts.presets = ['traditional', 'spj', 'answer', 'answer-spj', 'function', 'interactive', 'communication'];
  }
  return opts;
};

const callLlm = async (llm, messages, label) => {
  let content = '';
  let lastLog = Date.now();
  await chatCompletionStream(llm, { messages, temperature: 0.3, model: llm.model }, {
    onToken: (text) => {
      content += text;
      if (Date.now() - lastLog > 5000) {
        process.stdout.write(`\r  [${label}] 已接收 ${(content.length / 1024).toFixed(1)}KB ...`);
        lastLog = Date.now();
      }
    },
    onReasoning: () => {},
    onStatus: () => {},
  });
  process.stdout.write('\r');
  return content;
};

const summarizeDraft = (draft) => {
  const bits = [];
  const s = draft.statement || {};
  if (s.description) bits.push(`题面《${s.title || '?'}》${(s.samples || []).length}样例`);
  if (draft.std && draft.std.source) bits.push(`std ${draft.std.source.split('\n').length}行`);
  if (draft.solution && draft.solution.markdown) bits.push(`题解${draft.solution.markdown.length}字`);
  const d = draft.data || {};
  const gen = (d.generation && d.generation.cases) || [];
  if (gen.length) bits.push(`生成点${gen.length}`);
  if ((d.cases || []).length) bits.push(`静态点${d.cases.length}`);
  const j = draft.judge || {};
  bits.push(`judge=${j.preset}${(j.assets || []).filter((a) => a.content).length ? `+${j.assets.filter((a) => a.content).length}资产` : ''}`);
  return bits.join(' | ');
};

const staticDraftIssues = (preset, draft) => {
  const issues = [];
  const s = draft.statement || {};
  if (!s.description || !s.description.trim()) issues.push('statement.description 为空');
  if (!s.title || !s.title.trim()) issues.push('statement.title 为空');
  if (!(draft.solution && draft.solution.markdown && draft.solution.markdown.trim())) issues.push('题解为空');
  const d = draft.data || {};
  const gen = (d.generation && d.generation.cases) || [];
  const staticCases = d.cases || [];
  if (!gen.length && !staticCases.length) issues.push('既无生成点也无静态数据');
  if (preset !== 'answer' && preset !== 'answer-spj') {
    if (!(draft.std && draft.std.source && draft.std.source.trim())) issues.push('std 为空');
  }
  const j = draft.judge || {};
  if ((j.preset || 'traditional') !== preset) issues.push(`judge.preset=${j.preset}，期望 ${preset}`);
  if (j.profile) {
    const { ok, errors } = validateProfile(j.profile);
    if (!ok) issues.push(`profile 校验失败: ${errors.slice(0, 3).join('；')}`);
  } else {
    issues.push('judge.profile 缺失');
  }
  return issues;
};

const scenarioDraftIssues = (scenario, draft) => {
  const issues = [];
  const expects = scenario.expects || {};
  const data = draft.data || {};
  const genCases = (data.generation && data.generation.cases) || [];
  const staticCases = data.cases || [];
  const hasGeneratorSource = !!(data.generator && data.generator.source && data.generator.source.trim());
  if (expects.staticOnly) {
    if (!staticCases.length) issues.push('用户明确要求静态数据，但 data.cases 为空');
    if (genCases.length) issues.push('用户明确要求不要生成器，但 generation.cases 非空');
    if (hasGeneratorSource) issues.push('用户明确要求不要生成器，但 data.generator.source 非空');
  }
  if (expects.staticCases != null && staticCases.length !== expects.staticCases) {
    issues.push(`用户明确要求 ${expects.staticCases} 个静态测试点，但实际是 ${staticCases.length} 个`);
  }
  if (expects.generator) {
    if (!genCases.length) issues.push('期望在线生成数据，但 generation.cases 为空');
    if (!hasGeneratorSource) issues.push('期望在线生成数据，但生成器源码为空');
  }
  if (expects.generationCases != null && genCases.length !== expects.generationCases) {
    issues.push(`用户明确要求 ${expects.generationCases} 个生成点，但实际是 ${genCases.length} 个`);
  }
  if (expects.std && !(draft.std && draft.std.source && draft.std.source.trim())) {
    issues.push('期望有 std，但 std.source 为空');
  }
  if (expects.asset) {
    const names = (draft.judge && draft.judge.assets || []).map((a) => a && a.name);
    if (!names.includes(expects.asset)) issues.push(`期望评测资产 ${expects.asset}，实际为 ${names.join(',') || '无'}`);
  }
  return issues;
};

const runPreset = async (preset, llm, opts) => {
  const scenario = SCENARIOS[preset];
  const prompt = scenario.prompt;
  const t0 = Date.now();
  const report = { preset, ok: false, repairRounds: 0, issues: [], checks: [], seconds: 0 };
  try {
    const messages = buildMessages(prompt, ALL_SECTIONS, FAKE_PROBLEM, {});
    const content = await callLlm(llm, messages, `${preset}:生成`);
    const { parsed } = parseModelContent(content, `${preset}-gen`);
    let draft = normalizeDraft(parsed, FAKE_PROBLEM);
    let outputSections = draftSectionKeys(parsed);
    report.summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 200) : '';
    report.sections = outputSections.join(',');

    for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
      const staticIssues = [
        ...staticDraftIssues(scenario.preset, draft),
        ...scenarioDraftIssues(scenario, draft),
      ];
      const result = await runDraftChecks(draft, ALL_SECTIONS, (text) => {
        if (opts.verbose) console.log(`  [${preset}] ${text}`);
      });
      // 静态问题合并进 checks 报告，一并喂给修复轮
      for (const issue of staticIssues) {
        result.checks.push({ id: 'static', label: '草稿完整性', status: 'fail', detail: issue });
      }
      report.checks = result.checks;
      report.repairRounds = round;
      const failed = result.checks.filter((c) => c.status === 'fail');
      if (!failed.length) {
        report.ok = true;
        break;
      }
      if (round === MAX_REPAIR_ROUNDS) {
        report.issues = failed.map((c) => `${c.label}: ${String(c.detail || '').slice(0, 400)}`);
        break;
      }
      console.log(`  [${preset}] 自检失败 ${failed.length} 项，修复第 ${round + 1} 轮: ${failed.map((c) => c.label).join('、')}`);
      const repairPrompt = aiPrompt.buildRepairPrompt(result.checks);
      const repairMessages = buildMessages(repairPrompt, ALL_SECTIONS, FAKE_PROBLEM, {
        currentDraft: draft,
        promptHistory: [prompt],
        mode: 'repair',
      });
      const repairContent = await callLlm(llm, repairMessages, `${preset}:修复${round + 1}`);
      const { parsed: repairParsed } = parseModelContent(repairContent, `${preset}-repair${round + 1}`);
      const repairSections = draftSectionKeys(repairParsed);
      if (repairSections.length) {
        const generated = normalizeDraft(repairParsed, FAKE_PROBLEM);
        draft = mergeDraftSections(draft, generated, repairSections);
      }
    }
    report.draftSummary = summarizeDraft(draft);

    if (report.ok && scenario.edit) {
      console.log(`  [${preset}] 增量修改测试: ${scenario.edit.prompt}`);
      const editMessages = buildMessages(scenario.edit.prompt, scenario.edit.sections || ALL_SECTIONS, FAKE_PROBLEM, {
        currentDraft: draft,
        promptHistory: [prompt],
        mode: 'edit',
      });
      const editContent = await callLlm(llm, editMessages, `${preset}:增量修改`);
      const { parsed: editParsed } = parseModelContent(editContent, `${preset}-edit`);
      const editSections = draftSectionKeys(editParsed);
      report.editSections = editSections.join(',');
      const allowed = new Set(scenario.edit.expectedSections || scenario.edit.sections || []);
      const unexpected = editSections.filter((key) => !allowed.has(key));
      const missing = [...allowed].filter((key) => !editSections.includes(key));
      if (unexpected.length || missing.length) {
        report.ok = false;
        if (unexpected.length) report.issues.push(`增量修改输出了不该改的 section: ${unexpected.join(',')}`);
        if (missing.length) report.issues.push(`增量修改缺少期望 section: ${missing.join(',')}`);
      } else {
        const generated = normalizeDraft(editParsed, FAKE_PROBLEM);
        draft = mergeDraftSections(draft, generated, editSections);
        report.draftSummary = summarizeDraft(draft);
      }
    }
  } catch (err) {
    report.issues.push(`异常: ${err.message}`);
  }
  report.seconds = Math.round((Date.now() - t0) / 1000);
  return report;
};

const main = async () => {
  const opts = parseArgs();
  const llm = await loadUserLlmConfig(opts.uid);
  if (!llm.enabled) {
    console.error(`uid=${opts.uid} 没有配置 LLM key`);
    process.exit(1);
  }
  if (opts.model) llm.model = opts.model;
  llm.maxTokens = Math.max(llm.maxTokens, 20000);
  llm.timeout = Math.max(llm.timeout, 300000);
  console.log(`模型: ${llm.model} @ ${llm.baseUrl}\n题型: ${opts.presets.join(', ')}\n`);

  const reports = [];
  for (const preset of opts.presets) {
    if (!PRESET_PROMPTS[preset]) {
      console.log(`跳过未知题型: ${preset}`);
      continue;
    }
    console.log(`== ${preset} ==`);
    const report = await runPreset(preset, llm, opts);
    reports.push(report);
    console.log(`  ${report.ok ? '✅ 通过' : '❌ 失败'}（${report.seconds}s，修复 ${report.repairRounds} 轮）`);
    if (report.sections) console.log(`  输出: ${report.sections}`);
    if (report.draftSummary) console.log(`  草稿: ${report.draftSummary}`);
    if (report.editSections) console.log(`  增量输出: ${report.editSections || '无'}`);
    if (report.summary) console.log(`  summary: ${report.summary}`);
    for (const c of report.checks || []) {
      console.log(`    [${c.status}] ${c.label}${c.detail ? ` — ${String(c.detail).slice(0, 200).replace(/\n/g, ' ⏎ ')}` : ''}`);
    }
    for (const issue of report.issues) console.log(`    ⚠️  ${issue.replace(/\n/g, ' ⏎ ')}`);
    console.log('');
  }

  console.log('==== 总结 ====');
  for (const r of reports) console.log(`${r.ok ? '✅' : '❌'} ${r.preset}（${r.seconds}s，修复 ${r.repairRounds} 轮）`);
  const failed = reports.filter((r) => !r.ok);
  process.exit(failed.length ? 2 : 0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
