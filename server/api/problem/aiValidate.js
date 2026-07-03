// LLM 出题助手的草稿自检：把「生成完直接交给用户」变成「先在 sandbox 里真编译、
// 真造数据、真校验评测配置，失败的喂回模型修复」。这是解决"返回的代码没法造数据"
// 的关键一环，也被 previewData/saveData 复用（buildSandboxGeneratedCases）。

const { getFile } = require('../../file');
const sandboxClient = require('../judge/sandbox');
const { DEFAULT_ENV, COMPILE_LIMITS } = require('../judge/languages');

const MAX_CASES = 50;
const MAX_GENERATED_CASE_BYTES = 16 * 1024 * 1024;
const MAX_GENERATED_TOTAL_BYTES = 128 * 1024 * 1024;
const LOCAL_COMPILE_TIMEOUT_MS = 20000;
const LOCAL_GENERATOR_TIMEOUT_MS = 8000;
const LOCAL_STD_TIMEOUT_MS = 8000;
const TRIAL_CASE_LIMIT = 3;

const byteLen = (value) => Buffer.byteLength(String(value || ''), 'utf-8');

const cleanText = (value, maxBytes = 4096) => {
  const text = String(value == null ? '' : value).replace(/\r\n/g, '\n');
  if (byteLen(text) <= maxBytes) return text;
  return `${Buffer.from(text, 'utf-8').subarray(0, maxBytes).toString('utf-8')}\n...(truncated)`;
};

const sanitizeAssetName = (value, fallback) => {
  const raw = String(value || fallback).trim().slice(0, 80).replace(/[\\/]/g, '-');
  const name = raw.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || fallback;
  return name.slice(0, 64);
};

const sandboxStdFiles = (input = '', stdoutMax = MAX_GENERATED_CASE_BYTES, stderrMax = 1024 * 1024) => [
  { content: input },
  { name: 'stdout', max: stdoutMax },
  { name: 'stderr', max: stderrMax },
];

const sandboxErrorText = (result) => {
  const stdout = result && result.outputFiles && result.outputFiles.stdout ? result.outputFiles.stdout : '';
  const stderr = result && result.outputFiles && result.outputFiles.stderr ? result.outputFiles.stderr : '';
  return cleanText([stderr, stdout].filter(Boolean).join('\n'), 4096);
};

// 编译单个 C++ 文件（cwd 提供 testlib.h 和 extraFiles），产物以缓存文件形式返回。
const compileSandboxCpp = async (source, sourceName, outputName, extraFiles = {}) => {
  const fileName = sanitizeAssetName(sourceName, `${outputName}.cpp`);
  const inputFiles = { [fileName]: { content: source } };
  const testlib = await getFile('./comparer/testlib.h').catch(() => null);
  if (testlib) inputFiles['testlib.h'] = { content: testlib };
  for (const [name, content] of Object.entries(extraFiles || {})) {
    if (name && content != null && !inputFiles[name]) inputFiles[name] = { content: String(content) };
  }
  const result = await sandboxClient.runOne({
    command: ['/usr/bin/g++-9', '-O2', '-std=c++14', '-DONLINE_JUDGE', fileName, '-o', outputName],
    env: DEFAULT_ENV,
    stdio: sandboxStdFiles('', 1024 * 1024, 1024 * 1024),
    ...COMPILE_LIMITS,
    limits: { ...COMPILE_LIMITS.limits, wallMs: LOCAL_COMPILE_TIMEOUT_MS },
    inputFiles,
    outputFiles: ['stdout', 'stderr'],
    cachedOutputs: [outputName],
    cachePrefix: `nywOJ_ai_data_${Date.now().toString(36)}`,
  });
  if (!result || result.status !== 'Accepted' || result.exitCode !== 0) {
    throw new Error(`C++ 编译失败：${sandboxErrorText(result) || (result && result.status) || 'sandbox 无返回'}`);
  }
  const fileId = result.cachedFiles && result.cachedFiles[outputName];
  if (!fileId) throw new Error(`C++ 编译失败：sandbox 未返回 ${outputName} 缓存文件`);
  return { fileId, binName: outputName };
};

// 只做编译期语法/头文件检查，不链接。函数题 grader 需要选手的
// solution.h 才能链接；syntax-only 仍能提前发现 include/API/语法错误。
const compileSandboxCppSyntax = async (source, sourceName, extraFiles = {}) => {
  const fileName = sanitizeAssetName(sourceName, 'asset.cpp');
  const inputFiles = { [fileName]: { content: source } };
  const testlib = await getFile('./comparer/testlib.h').catch(() => null);
  if (testlib) inputFiles['testlib.h'] = { content: testlib };
  for (const [name, content] of Object.entries(extraFiles || {})) {
    if (name && content != null && !inputFiles[name]) inputFiles[name] = { content: String(content) };
  }
  const result = await sandboxClient.runOne({
    command: ['/usr/bin/g++-9', '-O2', '-std=c++14', '-DONLINE_JUDGE', '-c', fileName, '-o', 'asset-check.o'],
    env: DEFAULT_ENV,
    stdio: sandboxStdFiles('', 1024 * 1024, 1024 * 1024),
    ...COMPILE_LIMITS,
    limits: { ...COMPILE_LIMITS.limits, wallMs: LOCAL_COMPILE_TIMEOUT_MS },
    inputFiles,
    outputFiles: ['stdout', 'stderr'],
  });
  if (!result || result.status !== 'Accepted' || result.exitCode !== 0) {
    throw new Error(`C++ 编译失败：${sandboxErrorText(result) || (result && result.status) || 'sandbox 无返回'}`);
  }
};

const runSandboxBinary = async (binary, args, input, timeoutMs, label) => {
  const result = await sandboxClient.runOne({
    command: [binary.binName, ...args],
    env: DEFAULT_ENV,
    stdio: sandboxStdFiles(input || ''),
    limits: { cpuMs: timeoutMs, wallMs: timeoutMs * 2, memoryMB: 512, stackMB: 512, processes: 50 },
    inputFiles: { [binary.binName]: { cachedFile: binary.fileId } },
    outputFiles: ['stdout', 'stderr'],
  });
  if (!result || result.status !== 'Accepted' || result.exitCode !== 0) {
    throw new Error(`${label} 运行失败：${sandboxErrorText(result) || (result && result.status) || 'sandbox 无返回'}`);
  }
  return result.outputFiles && result.outputFiles.stdout ? result.outputFiles.stdout : '';
};

// 生成计划 → 真实测试数据（previewData / saveData 用，也是自检"试造数据"的全量版）。
const buildSandboxGeneratedCases = async (data, std) => {
  const plan = data.generation || {};
  if (!plan.cases || !plan.cases.length) return null;
  if (!data.generator || !data.generator.source || !data.generator.source.trim()) {
    throw new Error('在线生成需要造数据程序');
  }
  if (!std || !std.source || !std.source.trim()) {
    throw new Error('在线生成需要 STD，用于根据输入生成标准输出');
  }
  const mode = String(plan.mode || 'per-case-stdout').trim();
  if (mode !== 'per-case-stdout') {
    throw new Error(`暂不支持的在线生成模式：${mode}`);
  }
  let generatorBin = null;
  let stdBin = null;
  try {
    generatorBin = await compileSandboxCpp(data.generator.source, data.generator.fileName || 'ai-generator.cpp', 'ai-generator');
    stdBin = await compileSandboxCpp(std.source, std.fileName || 'std.cpp', 'std');
    const cases = [];
    let totalBytes = 0;
    for (const item of plan.cases) {
      const args = [
        item.name,
        String(item.index),
        String(item.subtaskId || 1),
        ...(Array.isArray(item.args) ? item.args : []),
      ].map((arg) => String(arg));
      const input = await runSandboxBinary(generatorBin, args, item.stdin || '', LOCAL_GENERATOR_TIMEOUT_MS, `生成器 case ${item.name}`);
      if (!input.trim()) throw new Error(`生成器没有为 case ${item.name} 输出输入数据`);
      const output = await runSandboxBinary(stdBin, [], input, LOCAL_STD_TIMEOUT_MS, `STD case ${item.name}`);
      totalBytes += byteLen(input) + byteLen(output);
      if (byteLen(input) > MAX_GENERATED_CASE_BYTES || byteLen(output) > MAX_GENERATED_CASE_BYTES) {
        throw new Error(`case ${item.name} 数据超过单点大小限制`);
      }
      if (totalBytes > MAX_GENERATED_TOTAL_BYTES) {
        throw new Error('在线生成的数据总量超过限制');
      }
      cases.push({
        index: cases.length + 1,
        name: item.name,
        input,
        output,
        subtaskId: item.subtaskId || 1,
      });
    }
    return cases;
  } finally {
    if (generatorBin && generatorBin.fileId) await sandboxClient.deleteFile(generatorBin.fileId);
    if (stdBin && stdBin.fileId) await sandboxClient.deleteFile(stdBin.fileId);
  }
};

const isCppLike = (block) => {
  const text = `${block && block.language || ''} ${block && block.fileName || ''}`.toLowerCase();
  return !/python|\.py|java(?!script)|\.java|javascript|\.js/.test(text);
};

const formatBytes = (bytes) => {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)}MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${value}B`;
};

// 挑首、中、尾三个生成点试造（首点最常错；尾点通常是极限点）。
const pickTrialCases = (cases) => {
  const picked = [];
  const n = cases.length;
  if (!n) return picked;
  const idx = new Set([0, Math.floor(n / 2), n - 1]);
  for (const i of [...idx].sort((a, b) => a - b).slice(0, TRIAL_CASE_LIMIT)) picked.push(cases[i]);
  return picked;
};

const check = (id, label, status, detail = '') => ({ id, label, status, detail: cleanText(detail, 2600) });

const normalizeOutput = (value) => String(value || '').replace(/\r\n/g, '\n').trimEnd();

const shouldCheckSamples = (judge) => {
  const preset = String(judge && judge.preset || judge && judge.profile && judge.profile.preset || 'traditional');
  return preset === 'traditional' || preset === 'answer' || preset === 'function';
};

// 对草稿做全套自检。draft 是 normalizeDraft 之后的结构；sections 是本轮涉及的部分
// （只检查涉及的内容，多轮小改动不重复全量体检）。onProgress(text) 用于流式状态。
const runDraftChecks = async (draft, sections, onProgress = () => {}) => {
  const checks = [];
  const scope = new Set(Array.isArray(sections) && sections.length ? sections : ['std', 'data', 'judge']);
  const data = (draft && draft.data) || {};
  const std = (draft && draft.std) || {};
  const judge = (draft && draft.judge) || {};
  const generation = data.generation || {};
  const genCases = Array.isArray(generation.cases) ? generation.cases : [];
  const staticCases = Array.isArray(data.cases) ? data.cases : [];
  const hasGeneratorWork = !!(data.generator && data.generator.source && data.generator.source.trim()) || genCases.length > 0;
  const wantData = scope.has('data') || scope.has('std');
  const wantJudge = scope.has('judge');

  // ---- 数据链路：编译生成器 + STD，试造数据 ----
  let stdBin = null;
  const wantStdCompile = wantData && std.source && std.source.trim();
  if (wantStdCompile) {
    if (isCppLike(std)) {
      onProgress('自检：编译 STD…');
      try {
        stdBin = await compileSandboxCpp(std.source, std.fileName || 'std.cpp', 'std');
        checks.push(check('std-compile', '编译 STD', 'pass'));
      } catch (err) {
        checks.push(check('std-compile', '编译 STD', 'fail', err.message));
      }
    } else {
      checks.push(check('std-compile', '编译 STD', 'skip', '非 C++ 源码，跳过编译检查'));
    }
  } else if (wantData && hasGeneratorWork && genCases.length) {
    checks.push(check('std-compile', '编译 STD', 'fail', '在线造数据需要 STD 来生成 .out，但 std.source 为空'));
  }

  const samples = Array.isArray(draft && draft.statement && draft.statement.samples) ? draft.statement.samples : [];
  if (wantData && stdBin && samples.length && shouldCheckSamples(judge)) {
    onProgress(`自检：校验 ${Math.min(samples.length, 3)} 组样例…`);
    let sampleFailed = false;
    for (let i = 0; i < Math.min(samples.length, 3); i++) {
      const sample = samples[i] || {};
      try {
        const got = await runSandboxBinary(stdBin, [], sample.inputData || '', LOCAL_STD_TIMEOUT_MS, `STD 样例 ${i + 1}`);
        const expected = sample.outputData || '';
        if (normalizeOutput(got) !== normalizeOutput(expected)) {
          checks.push(check(
            'sample-run',
            `样例校验（#${i + 1}）`,
            'fail',
            `STD 输出与题面样例不一致。期望：${cleanText(expected, 500)} 实际：${cleanText(got, 500)}`
          ));
          sampleFailed = true;
          break;
        }
      } catch (err) {
        checks.push(check('sample-run', `样例校验（#${i + 1}）`, 'fail', err.message));
        sampleFailed = true;
        break;
      }
    }
    if (!sampleFailed) {
      checks.push(check('sample-run', `样例校验（${Math.min(samples.length, 3)}/${samples.length} 组）`, 'pass'));
    }
  }

  if (wantData && hasGeneratorWork) {
    let generatorBin = null;
    try {
      if (!genCases.length) {
        checks.push(check('gen-plan', '生成计划', 'fail', '有生成器但 generation.cases 为空，无法造出任何数据'));
      }
      if (!isCppLike(data.generator)) {
        checks.push(check('gen-compile', '编译数据生成器', 'fail', '生成器必须是 C++14 单文件（平台只支持 g++ 编译生成器）'));
      } else if (data.generator && data.generator.source && data.generator.source.trim()) {
        onProgress('自检：编译数据生成器…');
        try {
          generatorBin = await compileSandboxCpp(data.generator.source, data.generator.fileName || 'ai-generator.cpp', 'ai-generator');
          checks.push(check('gen-compile', '编译数据生成器', 'pass'));
        } catch (err) {
          checks.push(check('gen-compile', '编译数据生成器', 'fail', err.message));
        }
      } else {
        checks.push(check('gen-compile', '编译数据生成器', 'fail', 'generation.cases 非空但没有生成器源码'));
      }

      if (generatorBin && stdBin && genCases.length) {
        const trial = pickTrialCases(genCases);
        onProgress(`自检：试造 ${trial.length} 个测试点…`);
        const produced = [];
        for (const item of trial) {
          const args = [item.name, String(item.index), String(item.subtaskId || 1), ...(Array.isArray(item.args) ? item.args : [])].map(String);
          try {
            const input = await runSandboxBinary(generatorBin, args, item.stdin || '', LOCAL_GENERATOR_TIMEOUT_MS, `生成器 case ${item.name}`);
            if (!input.trim()) throw new Error(`生成器对 case ${item.name} 没有输出任何内容（必须写 stdout）`);
            const output = await runSandboxBinary(stdBin, [], input, LOCAL_STD_TIMEOUT_MS, `STD case ${item.name}`);
            produced.push(`${item.name}: in ${formatBytes(byteLen(input))} / out ${formatBytes(byteLen(output))}`);
          } catch (err) {
            checks.push(check('gen-run', `试造数据（${item.name}）`, 'fail', err.message));
            break;
          }
        }
        if (!checks.some((c) => c.id === 'gen-run' && c.status === 'fail')) {
          checks.push(check('gen-run', `试造数据（抽查 ${trial.length}/${genCases.length} 点）`, 'pass', produced.join('；')));
        }
      }
    } finally {
      if (generatorBin && generatorBin.fileId) await sandboxClient.deleteFile(generatorBin.fileId);
    }

  } else if (wantData && scope.has('data') && !genCases.length && !(Array.isArray(data.cases) && data.cases.length)) {
    checks.push(check('gen-plan', '测试数据', 'skip', '本轮没有生成测试数据'));
  }

  if (wantData && staticCases.length) {
    const needsAnswer = judge && (judge.preset === 'answer' || judge.preset === 'answer-spj');
    const bad = [];
    let totalBytes = 0;
    for (const item of staticCases) {
      const name = item && (item.name || item.index) || '?';
      const inputBytes = byteLen(item && item.input);
      const outputBytes = byteLen(item && item.output);
      totalBytes += inputBytes + outputBytes;
      if (!String(item && item.input || '').trim()) bad.push(`${name} 输入为空`);
      if (needsAnswer && !String(item && item.output || '').trim()) bad.push(`${name} 标准答案为空`);
      if (inputBytes > MAX_GENERATED_CASE_BYTES || outputBytes > MAX_GENERATED_CASE_BYTES) bad.push(`${name} 超过单点大小限制`);
    }
    if (totalBytes > MAX_GENERATED_TOTAL_BYTES) bad.push(`总量 ${formatBytes(totalBytes)} 超过限制`);
    checks.push(bad.length
      ? check('static-cases', '静态测试数据', 'fail', bad.slice(0, 8).join('；'))
      : check('static-cases', '静态测试数据', 'pass', `${staticCases.length} 点，总量 ${formatBytes(totalBytes)}`));
  }

  if (wantData) {
    const subtasks = Array.isArray(data.subtasks) ? data.subtasks : [];
    const score = subtasks.reduce((sum, item) => sum + Number(item && item.score || 0), 0);
    if (subtasks.length && score !== 100) {
      checks.push(check('subtask-score', '子任务分数', 'fail', `score 总和是 ${score}，必须为 100`));
    }
  }
  if (stdBin && stdBin.fileId) await sandboxClient.deleteFile(stdBin.fileId);

  // ---- 评测链路：profile 校验 + 资产编译 ----
  if (wantJudge && judge && (judge.profile || (Array.isArray(judge.assets) && judge.assets.length))) {
    const { validateProfile } = require('./judgeProfile');
    if (judge.profile) {
      const { ok, errors } = validateProfile(judge.profile);
      checks.push(ok
        ? check('judge-profile', '评测配置校验', 'pass')
        : check('judge-profile', '评测配置校验', 'fail', errors.slice(0, 6).join('；')));
    } else if (judge.preset && judge.preset !== 'traditional') {
      checks.push(check('judge-profile', '评测配置校验', 'fail', 'judge.profile 缺失或无法解析'));
    }

    const assetContent = new Map();
    for (const asset of (Array.isArray(judge.assets) ? judge.assets : [])) {
      if (asset && asset.name) assetContent.set(asset.name, String(asset.content || ''));
    }
    const declared = judge.profile && Array.isArray(judge.profile.assets) ? judge.profile.assets : [];
    const missing = declared
      .map((a) => a && a.name)
      .filter((name) => name && !(assetContent.get(name) || '').trim());
    if (missing.length) {
      checks.push(check('judge-assets', '评测资产完整性', 'fail', `以下资产没有内容：${missing.join('、')}`));
    } else if (declared.length) {
      checks.push(check('judge-assets', '评测资产完整性', 'pass'));
    }

    // headers 供 grader/interactor include；grader.cpp 需要选手的 solution.h 才能编译
    const headers = {};
    for (const [name, content] of assetContent.entries()) {
      if (name.endsWith('.h')) headers[name] = content;
    }
    for (const [name, content] of assetContent.entries()) {
      if (!name.endsWith('.cpp') || !content.trim()) continue;
      const role = String((judge.assets.find((a) => a && a.name === name) || {}).role || '');
      if (role === 'grader' || /grader/i.test(name)) {
        const syntaxHeaders = { ...headers };
        if (syntaxHeaders['solution.h'] == null) {
          syntaxHeaders['solution.h'] = '#pragma once\n#include "problem.h"\n';
        }
        onProgress(`自检：语法检查评测资产 ${name}…`);
        try {
          await compileSandboxCppSyntax(content, name, syntaxHeaders);
          checks.push(check(`judge-compile-${name}`, `编译 ${name}`, 'pass', 'syntax-only，未链接选手 solution.h'));
        } catch (err) {
          checks.push(check(`judge-compile-${name}`, `编译 ${name}`, 'fail', err.message));
        }
        continue;
      }
      onProgress(`自检：编译评测资产 ${name}…`);
      try {
        const bin = await compileSandboxCpp(content, name, 'asset-check', headers);
        if (bin.fileId) await sandboxClient.deleteFile(bin.fileId);
        checks.push(check(`judge-compile-${name}`, `编译 ${name}`, 'pass'));
      } catch (err) {
        checks.push(check(`judge-compile-${name}`, `编译 ${name}`, 'fail', err.message));
      }
    }
  }

  return {
    checks,
    ok: !checks.some((c) => c.status === 'fail'),
  };
};

module.exports = {
  MAX_CASES,
  MAX_GENERATED_CASE_BYTES,
  MAX_GENERATED_TOTAL_BYTES,
  compileSandboxCpp,
  compileSandboxCppSyntax,
  runSandboxBinary,
  buildSandboxGeneratedCases,
  runDraftChecks,
  sandboxErrorText,
};
