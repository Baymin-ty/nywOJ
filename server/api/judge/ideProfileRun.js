// Profile-aware Online IDE runs.
//
// Unlike /api/judge/submit, this endpoint never creates a submission and never
// updates problem statistics. It executes one user-supplied input/answer pair
// through the same judgeProfile primitives used by the judge worker, so function,
// interactive, and communication problems can be debugged from /ide.

const async = require('async');
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { handler, fail, ok } = require('../../db/util');
const { getFile, setFile, delFile } = require('../../file');
const { getLanguage, stdioFiles, COMPILE_LIMITS, DEFAULT_ENV } = require('./languages');
const { problemAuth, getProblemLang } = require('../problem/core');
const { profileForType, summarizeJudge, validateProfile } = require('../problem/judgeProfile');
const { getCompareResult } = require('./core');
const { judgeRes } = require('../../db/format');
const spjCache = require('./checkerCache');
const artifactCache = require('./artifactCache');
const sandboxClient = require('./sandbox');

const MAX_SUBMIT_BYTES = 100 * 1024;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_OUTPUT = 64 * 1024;
const SPJ_CPU_MS = 5_000;
const SPJ_MEM_MB = 512;

const RES = {
  Accepted: 4,
  'Wrong Answer': 5,
  'Time Limit Exceeded': 6,
  'Memory Limit Exceeded': 7,
  'Nonzero Exit Status': 8,
  Signalled: 9,
  'Output Limit Exceeded': 10,
  'Dangerous Syscall': 11,
  'Internal Error': 12,
};

const AC = 4;
const WA = 5;
const SYSTEM_ERROR = 12;
const PARTIALLY_CORRECT = 15;
const JUDGEMENT_FAILED = 16;

class IdeJudgeError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'IdeJudgeError';
    this.kind = kind;
  }
}

const runSandbox = (cmds, extra = {}) =>
  sandboxClient.run(cmds, extra);

const deleteSandboxFile = (cachedFile) => sandboxClient.deleteFile(cachedFile);

const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

const truncate = (value, max = MAX_OUTPUT) => {
  const text = String(value || '');
  return text.length > max ? text.slice(0, max) : text;
};

const clipped = (value, max = MAX_OUTPUT) => {
  const text = String(value || '');
  return { text: truncate(text, max), truncated: text.length > max };
};

const sandboxSummary = (r) => ({
  status: r && r.status,
  exitCode: r && r.exitCode,
  time: Math.max(0, (r && r.cpuTimeMs) || 0),
  memory: Math.max(0, (r && r.memoryKb) || 0),
  stdout: truncate(r && r.outputFiles && r.outputFiles.stdout),
  stderr: truncate(r && r.outputFiles && r.outputFiles.stderr),
});

const parseChecker = (stderr, exitCode) => {
  const raw = String(stderr || '').replace(/^\s+/, '');
  const head = raw.toLowerCase();
  if (head.startsWith('ok')) return { kind: 'ok', ratio: 1 };
  if (head.startsWith('points')) {
    const m = raw.match(/points\s+(-?\d+(?:\.\d+)?)/i);
    const p = m ? parseFloat(m[1]) : 0;
    const ratio = clamp01(p > 1 ? p / 100 : p);
    if (ratio >= 1) return { kind: 'ok', ratio: 1 };
    if (ratio <= 0) return { kind: 'wa', ratio: 0 };
    return { kind: 'partial', ratio };
  }
  if (head.startsWith('partially correct')) {
    const m = raw.match(/partially correct\s*\((\d+)\)/i);
    const ratio = clamp01((m ? parseInt(m[1], 10) : 0) / 100);
    if (ratio >= 1) return { kind: 'ok', ratio: 1 };
    if (ratio <= 0) return { kind: 'wa', ratio: 0 };
    return { kind: 'partial', ratio };
  }
  if (head.startsWith('wrong answer') || head.startsWith('wrong output format') ||
      head.startsWith('unexpected eof')) {
    return { kind: 'wa', ratio: 0 };
  }
  if (head.startsWith('fail')) return { kind: 'fail', ratio: 0 };
  if (exitCode == null) return { kind: 'wa', ratio: 0 };
  switch (exitCode) {
    case 0: return { kind: 'ok', ratio: 1 };
    case 1: case 2: case 4: case 7: case 8: return { kind: 'wa', ratio: 0 };
    default: return { kind: 'fail', ratio: 0 };
  }
};

const verdictToRes = (kind) =>
  kind === 'ok' ? AC : kind === 'partial' ? PARTIALLY_CORRECT : WA;

const limitVal = (v, problemVal) => (v === 'problem' || v == null ? problemVal : v);

const profileAssetContent = (pid, name) =>
  name === 'checker.cpp' ? getFile(`./data/${pid}/checker.cpp`) : getFile(`./data/${pid}/assets/${name}`);

const loadEffectiveProfile = (row) => {
  if (row && row.judgeProfile) {
    try {
      const profile = JSON.parse(row.judgeProfile);
      if (profile && typeof profile === 'object') return profile;
    } catch (_) { /* fall through */ }
  }
  return profileForType(row ? row.type : 0);
};

const resolveLanguage = async (langId) => {
  const row = await db.one('SELECT name FROM languages WHERE id=?', [langId]);
  const cfg = row && getLanguage(row.name);
  if (!cfg) return null;
  return { name: row.name, ...cfg };
};

const materializeSlots = (profile) => {
  const slots = ((profile.submit && profile.submit.files) || [])
    .filter((f) => f && (f.kind === 'source' || f.kind === 'file'));
  const primaryIndex = slots.findIndex((f) => f.kind === 'source');
  return slots.map((slot, i) => ({
    name: slot.name || '',
    label: slot.label || slot.name || `文件 ${i + 1}`,
    kind: slot.kind,
    maxKB: slot.maxKB || 100,
    optional: !!slot.optional,
    primary: i === primaryIndex,
  }));
};

const validateTextBytes = (value, max, label) => {
  if (Buffer.byteLength(String(value || ''), 'utf-8') > max) {
    throw new IdeJudgeError('user', `${label} 不能超过 ${Math.floor(max / 1024)}KB`);
  }
};

const loadSubmitFromBody = (profile, bodyFiles) => {
  const slots = materializeSlots(profile);
  const files = Array.isArray(bodyFiles) ? bodyFiles : [];
  const primaryIndex = slots.findIndex((slot) => slot.kind === 'source');
  if (primaryIndex < 0) throw new IdeJudgeError('judgement', '该题无代码提交槽');

  const byName = new Map();
  let primaryCode = '';
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const content = files[i] == null ? '' : String(files[i]);
    if (!content && !slot.optional) throw new IdeJudgeError('user', `请填写文件「${slot.label || slot.name || ('文件' + (i + 1))}」`);
    const cap = Math.min((slot.maxKB || 100) * 1024, MAX_SUBMIT_BYTES);
    validateTextBytes(content, cap, `文件「${slot.label || slot.name || ('文件' + (i + 1))}」`);
    if (i === primaryIndex) primaryCode = content;
    if (slot.name) byName.set(slot.name, content);
  }
  if (!primaryCode) throw new IdeJudgeError('user', '请至少填写主文件');
  return { byName, primaryCode };
};

const resolveCompileInputWithMeta = async (pid, name, submit) => {
  const asset = await profileAssetContent(pid, name);
  if (asset !== null) return { content: asset, source: 'asset' };
  if (submit.byName.has(name)) return { content: submit.byName.get(name), source: 'submit' };
  throw new IdeJudgeError('judgement', `编译输入 ${name} 不存在`);
};

const resolveCompileInput = async (pid, name, submit) =>
  (await resolveCompileInputWithMeta(pid, name, submit)).content;

const compileProfileStep = async (pid, runId, step, lang, submit) => {
  const base = { env: DEFAULT_ENV, stdio: stdioFiles(), ...COMPILE_LIMITS, outputFiles: ['stdout', 'stderr'] };
  let result;
  if (step.command === 'auto') {
    result = (await runSandbox({
      ...base,
      env: lang.compileEnv || DEFAULT_ENV,
      command: lang.compileArgs,
      inputFiles: { [lang.sourceFile]: { content: submit.primaryCode } },
      cachedOutputs: [lang.binary],
      cachePrefix: `nywOJ_ide_${runId}_${step.id}`,
    }))[0];
    if (result.status === 'Internal Error') throw new IdeJudgeError('system', '该语言的运行环境不可用，请联系管理员');
    if (result.status !== 'Accepted' || result.exitCode !== 0) return { ce: result };
    return {
      product: {
        fileId: result.cachedFiles && result.cachedFiles[lang.binary],
        runArgs: lang.runArgs,
        runEnv: lang.runEnv || DEFAULT_ENV,
        binName: lang.binary,
      },
    };
  }

  const inputFiles = {};
  const inputMeta = [];
  for (const name of step.inputs || []) {
    const resolved = await resolveCompileInputWithMeta(pid, name, submit);
    inputFiles[name] = { content: resolved.content };
    inputMeta.push({ name, ...resolved });
  }
  if (!inputFiles['testlib.h']) {
    const testlib = await getFile('./comparer/testlib.h');
    if (testlib) {
      inputFiles['testlib.h'] = { content: testlib };
      inputMeta.push({ name: 'testlib.h', content: testlib, source: 'implicit_asset' });
    }
  }
  const cacheable = inputMeta.length > 0 && inputMeta.every((input) => input.source !== 'submit');
  let cacheHash = null;
  if (cacheable) {
    cacheHash = artifactCache.compileHash(step, inputMeta);
    const cached = artifactCache.get(pid, step.id, cacheHash);
    if (cached) {
      if (await sandboxClient.fileExists(cached)) {
        return {
          product: {
            fileId: cached,
            runArgs: [step.id],
            runEnv: DEFAULT_ENV,
            binName: step.id,
            cached: true,
          },
        };
      }
      artifactCache.invalidate(pid, step.id);
    }
  }
  result = (await runSandbox({
    ...base,
    command: step.command,
    inputFiles,
    cachedOutputs: [step.id],
    cachePrefix: `nywOJ_ide_${runId}_${step.id}`,
  }))[0];
  if (result.status === 'Internal Error') throw new IdeJudgeError('system', '评测机编译环境不可用');
  if (result.status !== 'Accepted' || result.exitCode !== 0) return { ce: result };
  const fileId = result.cachedFiles && result.cachedFiles[step.id];
  if (cacheable && fileId) artifactCache.set(pid, step.id, cacheHash, fileId);
  return { product: { fileId, runArgs: [step.id], runEnv: DEFAULT_ENV, binName: step.id, cached: cacheable } };
};

const runProduct = (product, inputFile, timeMs, memoryLimitMB) =>
  runSandbox({
    command: product.runArgs,
    env: product.runEnv || DEFAULT_ENV,
    stdio: stdioFiles({ content: inputFile }),
    limits: { cpuMs: timeMs, wallMs: timeMs * 2, memoryMB: memoryLimitMB, stackMB: memoryLimitMB, processes: 50 },
    inputFiles: { [product.binName]: { cachedFile: product.fileId } },
  }).then((r) => r[0]);

const resolveProfileRef = async (ref, ctx) => {
  if (ref && typeof ref === 'object') return ref.literal || '';
  if (ref === 'case.input') return ctx.inputFile;
  if (ref === 'case.answer') return ctx.outputFile;
  if (ref === 'submit.answer') return ctx.outputFile;
  if (typeof ref === 'string' && ref.startsWith('asset:')) {
    return (await profileAssetContent(ctx.pid, ref.slice(6))) || '';
  }
  const m = /^step:([A-Za-z0-9_-]+)\.(stdout|stderr)$/.exec(String(ref || ''));
  if (m) {
    const art = ctx.artifacts[m[1]];
    return art ? (m[2] === 'stdout' ? art.stdout : art.stderr) : '';
  }
  return '';
};

const FD = { stdin: 0, stdout: 1, stderr: 2 };
const PIPE_STDERR_MAX = 64 * 1024 * 1024;

const fdOf = (token) => {
  if (Object.prototype.hasOwnProperty.call(FD, token)) return FD[token];
  const n = Number(token);
  if (Number.isInteger(n) && n >= 0 && n <= 255) return n;
  throw new IdeJudgeError('judgement', `pipeGroup 非法 fd: ${token}`);
};

const buildPipeFiles = (pipedSet) => {
  const maxFd = Math.max(2, ...pipedSet);
  const files = [];
  for (let i = 0; i <= maxFd; i++) {
    if (pipedSet.has(i)) files[i] = null;
    else if (i === 1) files[i] = { name: 'stdout', max: PIPE_STDERR_MAX };
    else if (i === 2) files[i] = { name: 'stderr', max: PIPE_STDERR_MAX };
    else files[i] = { content: '' };
  }
  return files;
};

const pipeChargeTargets = (step) => {
  const raw = step.chargeTimeTo != null ? step.chargeTimeTo : step.verdictFrom;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((id) => id != null && id !== '');
};

const pipeGroupStep = async (pid, step, ctx, products, pinfo) => {
  const members = step.members || [];
  const idxById = {};
  members.forEach((m, i) => { idxById[m.id] = i; });

  const pipedFds = members.map(() => new Set());
  const pipes = (step.pipes || []).map((p) => {
    const [fromId, fromFd] = String(p.from).split('.');
    const [toId, toFd] = String(p.to).split('.');
    if (idxById[fromId] == null || idxById[toId] == null) {
      throw new IdeJudgeError('judgement', `pipeGroup 管道端点非法: ${p.from} -> ${p.to}`);
    }
    const inFd = fdOf(fromFd);
    const outFd = fdOf(toFd);
    pipedFds[idxById[fromId]].add(inFd);
    pipedFds[idxById[toId]].add(outFd);
    return { from: { command: idxById[fromId], fd: inFd }, to: { command: idxById[toId], fd: outFd } };
  });

  const cmds = [];
  for (let mi = 0; mi < members.length; mi++) {
    const m = members[mi];
    const product = products[m.exec];
    if (!product) throw new IdeJudgeError('judgement', `pipeGroup 成员 ${m.id} 引用了未编译的产物 ${m.exec}`);
    const timeLimit = limitVal(m.limits && m.limits.time, pinfo.timeLimit);
    const memoryLimit = limitVal(m.limits && m.limits.mem, pinfo.memoryLimit);
    const inputFiles = { [product.binName]: { cachedFile: product.fileId } };
    const args = [...product.runArgs];
    let seq = 0;
    for (const raw of m.args || []) {
      if (raw && typeof raw === 'object' && typeof raw.literal === 'string') {
        args.push(raw.literal);
        continue;
      }
      const content = await resolveProfileRef(raw, ctx);
      const fname = `arg${seq++}_${path.basename(String(raw)).replace(/[^A-Za-z0-9._-]/g, '_')}`;
      inputFiles[fname] = { content };
      args.push(fname);
    }
    cmds.push({
      command: args,
      env: product.runEnv || DEFAULT_ENV,
      stdio: buildPipeFiles(pipedFds[mi]),
      limits: { cpuMs: timeLimit, wallMs: timeLimit * 2, memoryMB: memoryLimit, stackMB: memoryLimit, processes: 50 },
      inputFiles,
    });
  }

  const res = await runSandbox(cmds, { pipes });
  const vIdx = idxById[step.verdictFrom];
  const chargeIndices = pipeChargeTargets(step).map((id) => idxById[id]).filter((idx) => idx != null);
  const vRes = res[vIdx];
  const chargeResults = chargeIndices.length ? chargeIndices.map((idx) => res[idx]) : [vRes];
  const time = Math.max(1, chargeResults.reduce((sum, r) => sum + ((r && r.cpuTimeMs) || 0), 0));
  const memory = Math.max(1, chargeResults.reduce((max, r) => Math.max(max, (r && r.memoryKb) || 0), 0));

  const RESOURCE_FAULT = new Set(['Time Limit Exceeded', 'Memory Limit Exceeded', 'Output Limit Exceeded']);
  const faultRes = chargeResults.find((r) => r && RESOURCE_FAULT.has(r.status));
  if (faultRes) {
    return {
      caseRes: RES[faultRes.status],
      ratio: 0,
      time,
      memory,
      detail: (faultRes.outputFiles && faultRes.outputFiles.stderr) || '',
      members: res.map((r, i) => ({ id: members[i] && members[i].id, ...sandboxSummary(r) })),
    };
  }
  if (!vRes || vRes.status === 'Internal Error') throw new IdeJudgeError('system', 'interactor/manager sandbox internal error');
  const verdict = (vRes.status === 'Accepted' || vRes.status === 'Nonzero Exit Status')
    ? parseChecker((vRes.outputFiles && vRes.outputFiles.stderr) || '', vRes.exitCode)
    : { kind: 'fail', ratio: 0 };
  if (verdict.kind === 'fail') {
    throw new IdeJudgeError('judgement', 'Interactor Error\n' + truncate((vRes.outputFiles && vRes.outputFiles.stderr) || `status: ${vRes.status}`, 4096));
  }
  return {
    caseRes: verdictToRes(verdict.kind),
    ratio: verdict.ratio,
    time,
    memory,
    detail: (vRes.outputFiles && vRes.outputFiles.stderr) || '',
    members: res.map((r, i) => ({ id: members[i] && members[i].id, ...sandboxSummary(r) })),
  };
};

const compileSPJ = async (source) => {
  const testlib = await getFile('./comparer/testlib.h');
  const result = (await runSandbox({
    command: ['/usr/bin/g++-9', '-O2', '-std=c++14', '-DONLINE_JUDGE', 'spj.cpp', '-o', 'spj'],
    env: ['PATH=/usr/bin:/bin'],
    stdio: stdioFiles(),
    ...COMPILE_LIMITS,
    inputFiles: { 'spj.cpp': { content: source }, 'testlib.h': { content: testlib || '' } },
    outputFiles: ['stdout', 'stderr'],
    cachedOutputs: ['spj'],
    cachePrefix: 'nywOJ_ide_spj',
  }))[0];
  if (result.status === 'Internal Error') throw new IdeJudgeError('system', 'SPJ 编译环境不可用');
  if (result.status !== 'Accepted' || result.exitCode !== 0) {
    throw new IdeJudgeError('judgement', 'SPJ Error\n' + ((result.outputFiles && result.outputFiles.stderr) || ''));
  }
  return result.cachedFiles && result.cachedFiles.spj;
};

const ensureSPJ = async (pid) => {
  const source = await getFile(`data/${pid}/checker.cpp`);
  if (!source) throw new IdeJudgeError('judgement', 'No checker.cpp found, please contact the problem publisher.');
  const cached = spjCache.get(pid, source);
  if (cached) return { fileId: cached, fromCache: true, source };
  const fileId = await compileSPJ(source);
  spjCache.set(pid, source, fileId);
  return { fileId, fromCache: false, source };
};

const runSPJ = (fileId, inputFile, usrOutput, outputFile) =>
  runSandbox({
    command: ['spj', 'data.in', 'usr.out', 'data.out'],
    env: ['PATH=/usr/bin:/bin'],
    stdio: stdioFiles(),
    limits: { cpuMs: SPJ_CPU_MS, wallMs: SPJ_CPU_MS * 2, memoryMB: SPJ_MEM_MB, stackMB: SPJ_MEM_MB, processes: 50 },
    inputFiles: {
      spj: { cachedFile: fileId },
      'data.in': { content: inputFile },
      'usr.out': { content: usrOutput },
      'data.out': { content: outputFile },
    },
  }).then((r) => r[0]);

const judgeWithSPJ = async (pid, spjState, inputFile, usrOutput, outputFile) => {
  let out;
  try {
    out = await runSPJ(spjState.fileId, inputFile, usrOutput, outputFile);
  } catch (err) {
    if (!spjState.fromCache) throw err;
    spjCache.invalidate(pid);
    const fresh = await ensureSPJ(pid);
    spjState.fileId = fresh.fileId;
    spjState.fromCache = false;
    out = await runSPJ(spjState.fileId, inputFile, usrOutput, outputFile);
  }
  if (out.status === 'Internal Error') throw new IdeJudgeError('system', 'SPJ sandbox internal error');
  const verdict = (out.status === 'Accepted' || out.status === 'Nonzero Exit Status')
    ? parseChecker((out.outputFiles && out.outputFiles.stderr) || '', out.exitCode)
    : { kind: 'fail', ratio: 0 };
  if (verdict.kind === 'fail') {
    throw new IdeJudgeError('judgement', 'SPJ Error\n' + truncate((out.outputFiles && out.outputFiles.stderr) || `checker status: ${out.status}`, 4096));
  }
  return { ...verdict, raw: (out.outputFiles && out.outputFiles.stderr) || '' };
};

let compareSeq = 1;
const compareDefault = async (usrOutput, outputFile) => {
  fs.mkdirSync(path.join(__dirname, '..', '..', 'comparer', 'tmp'), { recursive: true });
  const fileSuf = `./comparer/tmp/ide-${Date.now()}-${compareSeq++}_`;
  await setFile(`${fileSuf}usr.out`, usrOutput);
  await setFile(`${fileSuf}data.out`, outputFile);
  try {
    return await getCompareResult(fileSuf);
  } finally {
    try { await delFile(`${fileSuf}usr.out`); } catch (_) { /* best effort */ }
    try { await delFile(`${fileSuf}data.out`); } catch (_) { /* best effort */ }
  }
};

const runProfileOnce = async ({ pid, profile, pinfo, lang, files, input, answer, answerProvided }) => {
  const valid = validateProfile(profile);
  if (!valid.ok) throw new IdeJudgeError('judgement', '题目评测配置校验失败: ' + valid.errors.slice(0, 5).join('；'));

  const submit = loadSubmitFromBody(profile, files);
  const runId = `${pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const products = {};
  const ownedFileIds = [];
  const steps = [];

  try {
    for (const step of profile.compile || []) {
      const compiled = await compileProfileStep(pid, runId, step, lang, submit);
      if (compiled.ce) {
        const filesOut = compiled.ce.outputFiles || {};
        return {
          ce: true,
          compileStep: step.id,
          status: compiled.ce.status,
          compileOutput: truncate((filesOut.stderr || '') + (filesOut.stdout ? '\n' + filesOut.stdout : '')),
        };
      }
      if (!compiled.product || !compiled.product.fileId) throw new IdeJudgeError('system', `编译产物 ${step.id} 缺失`);
      products[step.id] = compiled.product;
      if (!compiled.product.cached) ownedFileIds.push(compiled.product.fileId);
      steps.push({ kind: 'compile', id: step.id, status: 'Accepted' });
    }

    const perCase = (profile.run && profile.run.perCase) || [];
    const ctx = { pid, inputFile: input, outputFile: answer, artifacts: {} };
    const spjState = { fileId: '', fromCache: false };
    let caseRes = AC;
    let ratio = 1;
    let time = 1;
    let memory = 1;
    let stdout = '';
    let stderr = '';
    let compare = '';
    let checked = false;
    let outputTruncated = false;

    for (const step of perCase) {
      if (step.kind === 'exec') {
        const product = products[step.exec];
        if (!product) throw new IdeJudgeError('judgement', `运行步骤引用了未编译的产物 ${step.exec}`);
        const stdinRef = step.stdin && step.stdin.from != null ? step.stdin.from : (step.stdin || 'case.input');
        const stdin = await resolveProfileRef(stdinRef, ctx);
        const run = await runProduct(
          product,
          stdin,
          limitVal(step.limits && step.limits.time, pinfo.timeLimit),
          limitVal(step.limits && step.limits.mem, pinfo.memoryLimit),
        );
        const out = clipped(run.outputFiles && run.outputFiles.stdout);
        const err = clipped(run.outputFiles && run.outputFiles.stderr);
        outputTruncated = outputTruncated || out.truncated || err.truncated;
        const runTime = Math.max(1, run.cpuTimeMs || 0);
        const runMem = Math.max(1, run.memoryKb || 0);
        ctx.artifacts[step.id] = {
          stdout: (run.outputFiles && run.outputFiles.stdout) || '',
          stderr: (run.outputFiles && run.outputFiles.stderr) || '',
          status: run.status,
          time: runTime,
          memory: runMem,
        };
        time = Math.max(time, runTime);
        memory = Math.max(memory, runMem);
        stdout = out.text;
        stderr = err.text;
        steps.push({ kind: 'exec', id: step.id, ...sandboxSummary(run) });
        if (run.status !== 'Accepted') {
          caseRes = RES[run.status] || SYSTEM_ERROR;
          ratio = 0;
          compare = err.text;
          break;
        }
      } else if (step.kind === 'check') {
        if (!answerProvided) {
          steps.push({ kind: 'check', id: step.id, skipped: true, reason: '未提供预期输出/答案' });
          continue;
        }
        const args = step.args || ['case.input', 'case.answer', 'case.answer'];
        const inf = await resolveProfileRef(args[0] != null ? args[0] : 'case.input', ctx);
        const usr = await resolveProfileRef(args[1] != null ? args[1] : 'case.answer', ctx);
        const ans = await resolveProfileRef(args[2] != null ? args[2] : 'case.answer', ctx);
        let verdict;
        if (step.checker === 'default') {
          compare = await compareDefault(usr, ans);
          verdict = parseChecker(compare);
        } else if (step.checker === 'asset:checker.cpp') {
          if (!spjState.fileId) Object.assign(spjState, await ensureSPJ(pid));
          verdict = await judgeWithSPJ(pid, spjState, inf, usr, ans);
          compare = verdict.raw || '';
        } else {
          throw new IdeJudgeError('judgement', `暂不支持的 checker: ${step.checker}`);
        }
        checked = true;
        caseRes = verdictToRes(verdict.kind);
        ratio = verdict.ratio;
        steps.push({
          kind: 'check',
          id: step.id,
          result: caseRes,
          resultName: judgeRes[caseRes] || String(caseRes),
          ratio,
          detail: truncate(compare),
        });
      } else if (step.kind === 'pipeGroup') {
        const pg = await pipeGroupStep(pid, step, ctx, products, pinfo);
        checked = true;
        caseRes = pg.caseRes;
        ratio = pg.ratio;
        time = Math.max(time, pg.time);
        memory = Math.max(memory, pg.memory);
        compare = truncate(pg.detail);
        steps.push({
          kind: 'pipeGroup',
          id: step.id,
          result: caseRes,
          resultName: judgeRes[caseRes] || String(caseRes),
          ratio,
          time: pg.time,
          memory: pg.memory,
          detail: truncate(pg.detail),
          members: pg.members,
        });
      }
    }

    return {
      ce: false,
      result: caseRes,
      resultName: judgeRes[caseRes] || String(caseRes),
      time,
      memory,
      ratio,
      checked,
      stdout,
      stderr,
      compare: truncate(compare),
      outputTruncated,
      steps,
    };
  } finally {
    for (const fileId of ownedFileIds) deleteSandboxFile(fileId);
  }
};

const profileRunQueue = async.queue((task, cb) => {
  runProfileOnce(task.payload).then(
    (result) => { task.resolve(result); cb(); },
    (err) => { task.reject(err); cb(); },
  );
}, 2);

const enqueue = (payload) =>
  new Promise((resolve, reject) => profileRunQueue.push({ payload, resolve, reject }));

const inFlight = new Set();

const loadSamples = async (pid) => {
  try {
    const row = await db.one('SELECT samples FROM problemSample WHERE pid=?', [pid]);
    if (!row || !row.samples) return [];
    const samples = JSON.parse(row.samples);
    return Array.isArray(samples) ? samples : [];
  } catch (_) {
    return [];
  }
};

exports.problemContext = handler(async (req, res) => {
  const pid = Number(req.body.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return fail(res, '题目编号非法');
  const auth = await problemAuth(req, pid);
  if (!auth.view) return fail(res, '权限不足');

  const row = await db.one('SELECT pid,title,type,judgeProfile,lang,timeLimit,memoryLimit FROM problem WHERE pid=?', [pid]);
  if (!row) return fail(res, '题目不存在');
  const profile = loadEffectiveProfile(row);
  const submitMode = profile.submit && profile.submit.mode || 'code';
  const profileJson = JSON.stringify(profile);
  return ok(res, {
    data: {
      pid: row.pid,
      title: row.title,
      langMask: row.lang,
      timeLimit: row.timeLimit,
      memoryLimit: row.memoryLimit,
      runnable: submitMode === 'code',
      submitMode,
      summary: summarizeJudge(row.type, profileJson),
      submitSlots: materializeSlots(profile),
      samples: await loadSamples(pid),
    },
  });
});

exports.profileRun = handler(async (req, res) => {
  if (!req.session || !req.session.uid) return fail(res, '请先登录');
  const uid = req.session.uid;
  const pid = Number(req.body.pid);
  const langId = Number(req.body.lang);
  if (!Number.isSafeInteger(pid) || pid <= 0) return fail(res, '题目编号非法');
  if (!Number.isSafeInteger(langId) || langId <= 0) return fail(res, '非法语言');
  if (inFlight.has(uid)) return fail(res, '上一次运行还在进行，请稍候');

  const auth = await problemAuth(req, pid);
  if (!auth.view) return fail(res, '权限不足');
  const row = await db.one('SELECT pid,type,judgeProfile,timeLimit,memoryLimit,lang FROM problem WHERE pid=?', [pid]);
  if (!row) return fail(res, '题目不存在');
  const profile = loadEffectiveProfile(row);
  if ((profile.submit && profile.submit.mode) === 'answer') return fail(res, '提交答案题不支持 IDE 运行');

  const lang = await resolveLanguage(langId);
  if (!lang) return fail(res, '非法语言');
  const langMask = await getProblemLang(pid);
  if (!((1 << langId) & langMask)) return fail(res, '非法语言');

  const input = req.body.input == null ? '' : String(req.body.input);
  const answer = req.body.answer == null ? '' : String(req.body.answer);
  try {
    validateTextBytes(input, MAX_TEXT_BYTES, '自定义输入');
    validateTextBytes(answer, MAX_TEXT_BYTES, '预期输出/答案');
  } catch (err) {
    return fail(res, err.message);
  }

  inFlight.add(uid);
  try {
    const result = await enqueue({
      pid,
      profile,
      pinfo: { timeLimit: row.timeLimit, memoryLimit: row.memoryLimit },
      lang,
      files: req.body.files,
      input,
      answer,
      answerProvided: !!req.body.answerProvided,
    });
    return ok(res, { data: result });
  } catch (err) {
    const kind = err && err.kind;
    if (kind === 'user') return fail(res, err.message);
    if (kind === 'judgement' || kind === 'system') {
      const code = kind === 'judgement' ? JUDGEMENT_FAILED : SYSTEM_ERROR;
      return ok(res, {
        data: {
          ce: false,
          result: code,
          resultName: judgeRes[code],
          time: 0,
          memory: 0,
          ratio: 0,
          checked: false,
          stdout: '',
          stderr: '',
          compare: '',
          message: err.message,
          steps: [],
        },
      });
    }
    console.error('ide profileRun:', err && err.stack ? err.stack : err);
    return fail(res, '评测机不可用');
  } finally {
    inFlight.delete(uid);
  }
});
