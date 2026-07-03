// Unified judge pipeline — profile storage, presets & validation (M1).
//
// A problem's judging behaviour is described by a declarative `judgeProfile`
// (JSON) stored in problem.judgeProfile. See docs/judge-pipeline.md for the
// full schema. This module owns:
//   - buildPreset(id)        : starter profiles for the six problem types
//   - validateProfile(p)     : structural + safety validation (manage-gated)
//   - asset management       : data/{pid}/assets/<name> (+ top-level checker.cpp)
//   - HTTP handlers          : get/save profile, list/get/save/delete asset
//
// Profiles can be authored, validated, stored and served. If judgeProfile is
// NULL, the worker derives an equivalent preset from problem.type at runtime.

const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { handler, fail, ok } = require('../../db/util');
const { getFile, setFile } = require('../../file');
const storage = require('../../storage');
const { recordEvent } = require('../../static');
const { problemAuth } = require('./core');

const PROFILE_VERSION = 1;

// ---- limits / allowlists ----
const MAX_SUBMIT_FILES = 6;
const MAX_COMPILE_STEPS = 8;
const MAX_RUN_STEPS = 12;
const MAX_ASSET_BYTES = 1024 * 1024;        // 1MB per asset
const MAX_PROFILE_BYTES = 256 * 1024;       // 256KB serialized profile
const HARD_TIME_MS = 10000;
const HARD_MEM_MB = 512;

// argv[0] basenames the setter may invoke as a compile command. `auto` (the
// language default) bypasses this. Mirrors what's installed in the sandbox.
const COMPILER_ALLOW = new Set(['g++-9', 'gcc-9', 'g++', 'gcc', 'python3', 'pylint']);

const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;   // asset / sandbox filenames
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;     // submit keys / step ids / compile ids
const REF_STEP_RE = /^step:([A-Za-z0-9_-]+)\.(stdout|stderr)$/;

const badName = (s) => typeof s !== 'string' || !NAME_RE.test(s) || s.includes('..');
const badKey = (s) => typeof s !== 'string' || !KEY_RE.test(s);

const replaceAssetRef = (value, oldName, newName) => {
  if (typeof value === 'string') {
    if (value === oldName) return newName;
    if (value === `asset:${oldName}`) return `asset:${newName}`;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => replaceAssetRef(item, oldName, newName));
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) value[key] = replaceAssetRef(value[key], oldName, newName);
  }
  return value;
};

const renameAssetInProfile = async (pid, oldName, newName) => {
  const row = await db.one('SELECT judgeProfile FROM problem WHERE pid=?', [pid]);
  if (!row || !row.judgeProfile) return;
  let profile;
  try {
    profile = JSON.parse(row.judgeProfile);
  } catch (_) {
    return;
  }
  const updated = replaceAssetRef(profile, oldName, newName);
  await db.query('UPDATE problem SET judgeProfile=? WHERE pid=?', [JSON.stringify(updated), pid]);
};

// ---- asset paths ----
// checker.cpp lives at the top-level path the worker reads;
// everything else under assets/. assetPath abstracts the difference.
const assetsDir = (pid) => path.join(__dirname, '..', '..', 'data', String(pid), 'assets');
const dataDir = (pid) => path.join(__dirname, '..', '..', 'data', String(pid));
const assetRel = (pid, name) =>
  name === 'checker.cpp' ? `./data/${pid}/checker.cpp` : `./data/${pid}/assets/${name}`;
const assetAbs = (pid, name) =>
  name === 'checker.cpp'
    ? path.join(dataDir(pid), 'checker.cpp')
    : path.join(assetsDir(pid), name);

// ============================================================================
// Presets — starter profiles. Model (per setter feedback):
//   · submit file = { name(filename, blank ⇒ named by chosen language), label,
//     kind, maxKB }. First source slot is the primary (mirrors submission.code/lang).
//   · compile step = { id(产物/可执行名), command:'auto'|argv, inputs:[文件名…] }.
//     inputs 引用 submit 文件名或资产名（content 按名拷入沙箱）。command:'auto' =
//     编译选手主代码（按其语言）；argv = 固定命令（grader/interactor，产物 -o <id>）。
//   · run exec/check/pipeGroup 通过 exec=<compile id> 引用产物。
// ============================================================================
const sourceSlot = (name = '', label = '你的代码', maxKB = 100) => {
  const slot = { label, kind: 'source', maxKB };
  if (name) slot.name = name; // blank ⇒ 按所选语言默认命名
  return slot;
};

// 编译选手主代码（按其语言），产物名 = id。
const autoCompile = (id = 'main') => ({ id, command: 'auto', inputs: [] });

// 固定 C++ 编译：把 inputs 里的文件编译成 id。
const cppCompile = (id, inputs, extraArgs = []) => ({
  id, command: ['/usr/bin/g++-9', '-O2', '-std=c++14', '-DONLINE_JUDGE', ...extraArgs], inputs,
});

const execStep = (id, exec) => ({
  id, kind: 'exec', exec, args: [],
  stdin: { from: 'case.input' },
  limits: { time: 'problem', mem: 'problem' }, capture: ['stdout', 'stderr'],
});

const checkStep = (checker, runId = 'run') => ({
  id: 'check', kind: 'check', checker,
  args: ['case.input', `step:${runId}.stdout`, 'case.answer'],
});

const PRESETS = {
  traditional: () => ({
    version: PROFILE_VERSION, preset: 'traditional',
    submit: { mode: 'code', files: [sourceSlot()] },
    assets: [],
    compile: [autoCompile('main')],
    run: { perCase: [execStep('run', 'main'), checkStep('default')] },
  }),

  spj: () => ({
    version: PROFILE_VERSION, preset: 'spj',
    submit: { mode: 'code', files: [sourceSlot()] },
    assets: [{ name: 'checker.cpp', role: 'checker', lang: 'C++' }],
    compile: [autoCompile('main')],
    run: { perCase: [execStep('run', 'main'), checkStep('asset:checker.cpp')] },
  }),

  answer: () => ({
    version: PROFILE_VERSION, preset: 'answer',
    submit: { mode: 'answer', files: [] },
    assets: [],
    compile: [],
    run: { perCase: [{ id: 'check', kind: 'check', checker: 'default',
      args: ['case.input', 'submit.answer', 'case.answer'] }] },
  }),

  'answer-spj': () => ({
    version: PROFILE_VERSION, preset: 'answer-spj',
    submit: { mode: 'answer', files: [] },
    assets: [{ name: 'checker.cpp', role: 'checker', lang: 'C++' }],
    compile: [],
    run: { perCase: [{ id: 'check', kind: 'check', checker: 'asset:checker.cpp',
      args: ['case.input', 'submit.answer', 'case.answer'] }] },
  }),

  function: () => ({
    version: PROFILE_VERSION, preset: 'function',
    submit: { mode: 'code', files: [sourceSlot('solution.h', '你的实现')] },
    assets: [
      { name: 'grader.cpp', role: 'grader', lang: 'C++' },
      { name: 'problem.h', role: 'header' },
    ],
    compile: [cppCompile('prog', ['grader.cpp', 'problem.h', 'solution.h'], ['grader.cpp', '-o', 'prog'])],
    run: { perCase: [execStep('run', 'prog'), checkStep('default')] },
  }),

  interactive: () => ({
    version: PROFILE_VERSION, preset: 'interactive',
    submit: { mode: 'code', files: [sourceSlot()] },
    assets: [{ name: 'interactor.cpp', role: 'interactor', lang: 'C++' }],
    compile: [
      autoCompile('main'),
      cppCompile('interactor', ['interactor.cpp'], ['interactor.cpp', '-o', 'interactor']),
    ],
    run: { perCase: [{
      id: 'g', kind: 'pipeGroup',
      members: [
        { id: 'user', exec: 'main', args: [], limits: { time: 'problem', mem: 'problem' } },
        // testlib interactor argv = <input> <tout-scratch> <answer>; contestant I/O is via
        // the pipes. tout.txt is a throwaway file testlib opens for write; the answer is
        // passed at argv[3] so answer-aware interactors can validate against it (harmless
        // when unused — testlib just opens it read-only).
        { id: 'judge', exec: 'interactor', args: ['case.input', { literal: 'tout.txt' }, 'case.answer'], limits: { time: 10000, mem: 512 } },
      ],
      pipes: [
        { from: 'user.stdout', to: 'judge.stdin' },
        { from: 'judge.stdout', to: 'user.stdin' },
      ],
      verdictFrom: 'judge', chargeTimeTo: 'user',
    }] },
  }),

  communication: () => ({
    version: PROFILE_VERSION, preset: 'communication',
    submit: { mode: 'code', files: [sourceSlot('sol.cpp')] },
    assets: [{ name: 'manager.cpp', role: 'manager', lang: 'C++' }],
    compile: [
      cppCompile('solA', ['sol.cpp'], ['-DSIDE_A', 'sol.cpp', '-o', 'solA']),
      cppCompile('solB', ['sol.cpp'], ['-DSIDE_B', 'sol.cpp', '-o', 'solB']),
      cppCompile('manager', ['manager.cpp'], ['manager.cpp', '-o', 'manager']),
    ],
    run: { perCase: [{
      id: 'g', kind: 'pipeGroup',
      members: [
        // manager talks to each side on a dedicated fd pair (a single fd can only
        // be one end of one pipe — both sides cannot share mgr.stdin). Convention:
        //   side A: fd3 = read from A, fd4 = write to A
        //   side B: fd5 = read from B, fd6 = write to B
        // argv = <input> <answer>; the contestant solutions use plain stdin/stdout.
        { id: 'mgr', exec: 'manager', args: ['case.input', 'case.answer'], limits: { time: 10000, mem: 512 } },
        { id: 'sideA', exec: 'solA', args: [], limits: { time: 'problem', mem: 'problem' } },
        { id: 'sideB', exec: 'solB', args: [], limits: { time: 'problem', mem: 'problem' } },
      ],
      pipes: [
        { from: 'sideA.stdout', to: 'mgr.3' },   // A → manager (fd3)
        { from: 'mgr.4', to: 'sideA.stdin' },    // manager (fd4) → A
        { from: 'sideB.stdout', to: 'mgr.5' },   // B → manager (fd5)
        { from: 'mgr.6', to: 'sideB.stdin' },    // manager (fd6) → B
      ],
      verdictFrom: 'mgr', chargeTimeTo: ['sideA', 'sideB'],
    }] },
  }),
};

const buildPreset = (id) => (PRESETS[id] || PRESETS.traditional)();
exports.buildPreset = buildPreset;

// `problem.type` value that best mirrors a profile for list display and import
// interoperability. Runtime behaviour is driven by the profile.
const presetToType = (profile) => {
  const p = profile && profile.preset;
  const steps = (profile && profile.run && profile.run.perCase) || [];
  const hasCustomCheck = steps.some((s) => s && s.kind === 'check' && s.checker !== 'default');
  // Answer-mode problems follow their actual check step, not the preset label:
  // an "answer" preset whose checker was switched to asset:<name> must land on
  // type 3 so list display agrees with the profile engine.
  if ((profile && profile.submit && profile.submit.mode === 'answer') || p === 'answer' || p === 'answer-spj') {
    return hasCustomCheck ? 3 : 2;
  }
  if (p === 'traditional') return 0;
  // spj / function / interactive / communication → checker-bearing code problems
  return p === undefined ? 0 : 1;
};
exports.presetToType = presetToType;

const typeToPresetId = (type) =>
  ({ 0: 'traditional', 1: 'spj', 2: 'answer', 3: 'answer-spj' }[Number(type)] || 'traditional');
exports.typeToPresetId = typeToPresetId;

// The canonical profile an existing `type` maps to. The worker uses this for
// rows that do not yet store judgeProfile.
const profileForType = (type) => buildPreset(typeToPresetId(type));
exports.profileForType = profileForType;

// M5 profile 体检: is this problem safe to judge under the profile engine?
// `existingAssets` = names present on disk (from listAssetsOf). Pure so scripts
// and the endpoint share it. Returns blocking errors + non-blocking warnings.
const profileHealth = (profile, existingAssets = []) => {
  const errors = [];
  const warnings = [];
  if (!profile || typeof profile !== 'object') {
    return { ok: false, errors: ['profile 为空或非对象'], warnings };
  }
  const v = validateProfile(profile);
  if (!v.ok) errors.push(...v.errors);

  // every author-declared asset must exist on disk, else compile/run breaks.
  const have = new Set(existingAssets);
  for (const a of (Array.isArray(profile.assets) ? profile.assets : [])) {
    if (a && a.name && !have.has(a.name)) errors.push(`缺少资产文件 ${a.name}（${a.role || 'asset'}）`);
  }
  // any `asset:<name>` checker reference must resolve too.
  for (const s of ((profile.run && profile.run.perCase) || [])) {
    if (s && s.kind === 'check' && typeof s.checker === 'string' && s.checker.startsWith('asset:')) {
      const name = s.checker.slice(6);
      if (!have.has(name)) errors.push(`check 步骤引用的资产 ${name} 不存在`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
};
exports.profileHealth = profileHealth;

// Contestant-facing judging summary: what to submit + how it's judged. Derived
// from judgeProfile when present, else from `type`. Safe to expose to
// anyone with problem view (no checker source, no internal step detail).
const PRESET_LABEL = {
  traditional: '传统题', spj: 'SPJ 自定义校验', answer: '提交答案题', 'answer-spj': '提交答案题 (SPJ)',
  function: '提交函数题', interactive: '交互题', communication: '通信题', custom: '自定义评测',
};
const summarizeJudge = (type, profileJson) => {
  let profile = null;
  if (profileJson) { try { profile = JSON.parse(profileJson); } catch (_) { profile = null; } }
  if (profile && typeof profile === 'object') {
    const preset = profile.preset || 'custom';
    const mode = (profile.submit && profile.submit.mode) || 'code';
    const steps = (profile.run && profile.run.perCase) || [];
    const hasPipe = steps.some((s) => s.kind === 'pipeGroup');
    const hasSpj = steps.some((s) => s.kind === 'check' && typeof s.checker === 'string' && s.checker.startsWith('asset:'));
    const submit = ((profile.submit && profile.submit.files) || []).map((f) => ({
      label: f.label || f.name || '文件', kind: f.kind, name: f.name || null,
    }));
    let compare;
    if (hasPipe) compare = '实时交互评测';
    else if (hasSpj) compare = '自定义校验 (Special Judge)';
    else if (mode === 'answer') compare = '答案文件对比';
    else compare = '文本逐字符对比';
    return { kind: preset, label: PRESET_LABEL[preset] || '自定义评测', mode, compare, submit };
  }
  const kind = typeToPresetId(type);
  const compare = { 0: '文本逐字符对比', 1: '自定义校验 (Special Judge)', 2: '答案文件对比', 3: '答案文件对比 + 自定义校验' }[Number(type)] || '文本逐字符对比';
  return { kind, label: PRESET_LABEL[kind], mode: Number(type) >= 2 ? 'answer' : 'code', compare, submit: [] };
};
exports.summarizeJudge = summarizeJudge;

// Submission-page flow summary: enough structure to draw the judge pipeline
// (compile products → per-case steps → verdict source) without leaking
// compile commands or asset contents. Shown to anyone who can view the
// submission — the judge log already exposes the same step ids/pipes.
const summarizeProfileFlow = (raw) => {
  if (!raw) return null;
  try {
    const profile = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!profile || typeof profile !== 'object') return null;
    const perCase = (profile.run && profile.run.perCase) || [];
    const pipeGroups = perCase.filter((s) => s && s.kind === 'pipeGroup');
    const compile = (Array.isArray(profile.compile) ? profile.compile : []).map((c) => ({
      id: c && c.id,
      auto: !!(c && c.command === 'auto'),
      inputs: c && Array.isArray(c.inputs) ? c.inputs.slice(0, 8) : [],
    }));
    const steps = perCase.map((s) => {
      if (!s || typeof s !== 'object') return null;
      if (s.kind === 'exec') {
        return {
          kind: 'exec', id: s.id, exec: s.exec,
          stdin: s.stdin && s.stdin.from != null ? s.stdin.from : (typeof s.stdin === 'string' ? s.stdin : 'case.input'),
        };
      }
      if (s.kind === 'check') {
        return {
          kind: 'check', id: s.id, checker: s.checker,
          args: Array.isArray(s.args) ? s.args.map((a) => (typeof a === 'string' ? a : '(literal)')) : [],
        };
      }
      if (s.kind === 'pipeGroup') {
        return {
          kind: 'pipeGroup', id: s.id,
          members: (s.members || []).map((m) => ({ id: m && m.id, exec: m && m.exec })),
          pipes: (s.pipes || []).map((p) => ({ from: String(p && p.from || ''), to: String(p && p.to || '') })),
          verdictFrom: s.verdictFrom, chargeTimeTo: s.chargeTimeTo,
        };
      }
      return { kind: String(s.kind || 'unknown'), id: s.id };
    }).filter(Boolean);
    return {
      preset: profile.preset || 'custom',
      submitMode: (profile.submit && profile.submit.mode) || 'code',
      submitFiles: ((profile.submit && profile.submit.files) || []).map((f) => ({
        label: (f && (f.label || f.name)) || '文件', name: (f && f.name) || null, kind: f && f.kind,
      })),
      pipeGroupCount: pipeGroups.length,
      interactive: ['interactive', 'communication'].includes(profile.preset) || pipeGroups.length > 0,
      compile,
      steps,
    };
  } catch (_) {
    return null;
  }
};
exports.summarizeProfileFlow = summarizeProfileFlow;

// ============================================================================
// Validation
// ============================================================================
const validateRef = (ref, seenSteps, errors, where) => {
  if (ref && typeof ref === 'object') {
    if (typeof ref.literal !== 'string') errors.push(`${where}: literal 必须是字符串`);
    return;
  }
  if (typeof ref !== 'string') { errors.push(`${where}: 引用格式非法`); return; }
  if (['case.input', 'case.answer', 'submit.answer'].includes(ref)) return;
  if (ref.startsWith('asset:')) {
    if (badName(ref.slice(6))) errors.push(`${where}: 资产名非法 (${ref})`);
    return;
  }
  const m = REF_STEP_RE.exec(ref);
  if (m) {
    if (!seenSteps.has(m[1])) errors.push(`${where}: 引用了未在之前出现的步骤 step:${m[1]}`);
    return;
  }
  errors.push(`${where}: 未知引用 ${ref}`);
};

const validateLimits = (limits, errors, where) => {
  if (limits == null) return;
  if (typeof limits !== 'object') { errors.push(`${where}: limits 非法`); return; }
  const t = limits.time;
  if (t !== 'problem' && t !== undefined) {
    if (typeof t !== 'number' || t <= 0 || t > HARD_TIME_MS) errors.push(`${where}: time 应为 'problem' 或 1..${HARD_TIME_MS}ms`);
  }
  const m = limits.mem;
  if (m !== 'problem' && m !== undefined) {
    if (typeof m !== 'number' || m <= 0 || m > HARD_MEM_MB) errors.push(`${where}: mem 应为 'problem' 或 1..${HARD_MEM_MB}MB`);
  }
};

const validateCommand = (cmd, errors, where) => {
  if (cmd === 'auto') return;
  if (!Array.isArray(cmd) || !cmd.length) { errors.push(`${where}: command 应为 'auto' 或非空 argv 数组`); return; }
  if (cmd.some((a) => typeof a !== 'string')) { errors.push(`${where}: command 参数必须都是字符串`); return; }
  const base = path.basename(cmd[0]);
  if (!COMPILER_ALLOW.has(base)) errors.push(`${where}: 不允许的编译器 ${cmd[0]}（白名单: ${[...COMPILER_ALLOW].join(', ')}）`);
};

const validateProfile = (profile) => {
  const errors = [];
  if (!profile || typeof profile !== 'object') return { ok: false, errors: ['profile 不是对象'] };
  if (profile.version !== PROFILE_VERSION) errors.push(`version 必须为 ${PROFILE_VERSION}`);

  // submit
  const submit = profile.submit || {};
  const mode = submit.mode || 'code';
  if (!['code', 'answer'].includes(mode)) errors.push(`submit.mode 非法: ${mode}`);
  const files = Array.isArray(submit.files) ? submit.files : [];
  if (mode === 'code' && !files.length) errors.push('submit.files 至少要有一个文件槽');
  if (files.length > MAX_SUBMIT_FILES) errors.push(`submit.files 最多 ${MAX_SUBMIT_FILES} 个`);
  // Only the first source slot may omit name (it is materialized using the
  // selected language's default source filename). Every other slot must be
  // named so it can be persisted in submissionFile and referenced by compile.
  const primarySourceIndex = files.findIndex((f) => f && f.kind === 'source');
  // submit 文件名（可空=按语言）+ 资产名共同构成「可作为编译输入」的文件名集合
  const inputNames = new Set();
  let sourceCount = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f || typeof f !== 'object') { errors.push(`submit 文件槽 ${i + 1} 非法`); continue; }
    if (!['source', 'file'].includes(f.kind)) errors.push(`submit 文件槽 kind 非法: ${f && f.kind}`);
    if (f.kind === 'source') sourceCount++;
    if (f.kind === 'file' && !f.name) errors.push(`submit 文件槽 ${i + 1} 是上传文件，必须填写文件名`);
    if (f.kind === 'source' && i !== primarySourceIndex && !f.name) errors.push(`submit 附加 source 文件槽 ${i + 1} 必须填写文件名`);
    if (f.name != null && f.name !== '') {
      if (badName(f.name)) errors.push(`submit 文件名非法: ${f.name}`);
      else if (inputNames.has(f.name)) errors.push(`submit 文件名重复: ${f.name}`);
      else inputNames.add(f.name);
    }
    if (f.maxKB != null && (typeof f.maxKB !== 'number' || f.maxKB <= 0 || f.maxKB > 1024)) errors.push(`submit 文件槽 maxKB 非法`);
  }
  if (mode === 'code' && sourceCount === 0) errors.push('提交代码题至少要有一个 source 文件槽');

  // assets
  const assets = Array.isArray(profile.assets) ? profile.assets : [];
  for (const a of assets) {
    if (badName(a && a.name)) { errors.push(`assets 名非法: ${a && a.name}`); continue; }
    inputNames.add(a.name);
  }

  // compile：把 inputs（submit 文件名/资产名）按 command 编译成 id（产物=可执行文件名）
  const compile = Array.isArray(profile.compile) ? profile.compile : [];
  if (compile.length > MAX_COMPILE_STEPS) errors.push(`compile 步骤最多 ${MAX_COMPILE_STEPS}`);
  const compileIds = new Set();
  for (const c of compile) {
    if (badKey(c && c.id)) { errors.push(`compile.id 非法: ${c && c.id}`); continue; }
    if (compileIds.has(c.id)) errors.push(`compile.id 重复: ${c.id}`);
    compileIds.add(c.id);
    validateCommand(c.command, errors, `compile[${c.id}]`);
    if (c.command !== 'auto') {
      // 固定命令：inputs 的每个文件名必须是已声明的 submit 文件名或资产名
      const inputs = Array.isArray(c.inputs) ? c.inputs : [];
      if (!inputs.length) errors.push(`compile[${c.id}].inputs 为空（固定命令需指定输入文件）`);
      for (const n of inputs) {
        if (!inputNames.has(n)) errors.push(`compile[${c.id}] 输入文件 ${n} 不在提交文件/资产中`);
      }
    }
  }
  // 产物即 compile.id；run 步骤通过 exec/exec-成员引用它
  const canExec = (name) => compileIds.has(name);

  // run.perCase
  const perCase = (profile.run && Array.isArray(profile.run.perCase)) ? profile.run.perCase : [];
  if (mode === 'code' && !perCase.length) errors.push('run.perCase 至少要有一个步骤');
  if (perCase.length > MAX_RUN_STEPS) errors.push(`run.perCase 步骤最多 ${MAX_RUN_STEPS}`);
  const seenSteps = new Set();
  const stepIds = new Set();
  for (const s of perCase) {
    const id = s && s.id;
    if (badKey(id)) { errors.push(`run 步骤 id 非法: ${id}`); continue; }
    if (stepIds.has(id)) errors.push(`run 步骤 id 重复: ${id}`);
    stepIds.add(id);
    const where = `run[${id}]`;
    switch (s.kind) {
      case 'exec':
        if (!canExec(s.exec)) errors.push(`${where}: exec 引用了未声明的编译产物 ${s.exec}`);
        validateRef(s.stdin == null ? 'case.input' : s.stdin.from || s.stdin, seenSteps, errors, `${where}.stdin`);
        validateLimits(s.limits, errors, where);
        break;
      case 'check':
        if (!(s.checker === 'default' || (typeof s.checker === 'string' && (s.checker.startsWith('asset:') || canExec(s.checker)))))
          errors.push(`${where}: checker 非法 ${s.checker}`);
        for (let i = 0; i < (s.args || []).length; i++) validateRef(s.args[i], seenSteps, errors, `${where}.args[${i}]`);
        break;
      case 'pipeGroup': {
        const members = Array.isArray(s.members) ? s.members : [];
        if (members.length < 2) errors.push(`${where}: pipeGroup 至少 2 个成员`);
        const memIds = new Set();
        for (const m of members) {
          if (badKey(m && m.id)) { errors.push(`${where}: 成员 id 非法`); continue; }
          memIds.add(m.id);
          if (!canExec(m.exec)) errors.push(`${where}: 成员 ${m.id} exec 引用了未声明的产物 ${m.exec}`);
          validateLimits(m.limits, errors, `${where}.${m.id}`);
        }
        // Each (member.fd) endpoint participates in exactly one pipe (one fd can
        // only be one end of one pipe). Duplicate ⇒ the old communication bug of
        // two solutions writing into the manager's single stdin. fd may be a name
        // (stdin/stdout/stderr) or a raw number (manager extra fds for >2 members).
        const seenEndpoints = new Set();
        for (const p of (s.pipes || [])) {
          for (const end of ['from', 'to']) {
            const ep = String(p && p[end] || '');
            const mm = /^([A-Za-z0-9_-]+)\.(stdin|stdout|stderr|\d{1,3})$/.exec(ep);
            if (!mm || !memIds.has(mm[1])) { errors.push(`${where}: 管道端点非法 ${ep}`); continue; }
            if (seenEndpoints.has(ep)) errors.push(`${where}: 管道端点 ${ep} 重复（一个 fd 只能接一条管道）`);
            seenEndpoints.add(ep);
          }
        }
        if (!memIds.has(s.verdictFrom)) errors.push(`${where}: verdictFrom 非成员 ${s.verdictFrom}`);
        const chargeTargets = s.chargeTimeTo == null
          ? []
          : Array.isArray(s.chargeTimeTo) ? s.chargeTimeTo : [s.chargeTimeTo];
        const seenChargeTargets = new Set();
        for (const target of chargeTargets) {
          if (!memIds.has(target)) errors.push(`${where}: chargeTimeTo 非成员 ${target}`);
          if (seenChargeTargets.has(target)) errors.push(`${where}: chargeTimeTo 成员重复 ${target}`);
          seenChargeTargets.add(target);
        }
        break;
      }
      default:
        errors.push(`${where}: 未知步骤 kind=${s.kind}`);
    }
    seenSteps.add(id);
  }

  return { ok: errors.length === 0, errors };
};
exports.validateProfile = validateProfile;

// ============================================================================
// HTTP handlers
// ============================================================================
const listAssetsOf = (pid) => {
  const out = [];
  const topLevelChecker = assetAbs(pid, 'checker.cpp');
  if (fs.existsSync(topLevelChecker)) {
    const st = fs.statSync(topLevelChecker);
    out.push({ name: 'checker.cpp', size: st.size, mtime: st.mtimeMs });
  }
  const dir = assetsDir(pid);
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (badName(name)) continue;
      const full = path.join(dir, name);
      if (!fs.statSync(full).isFile()) continue;
      const st = fs.statSync(full);
      out.push({ name, size: st.size, mtime: st.mtimeMs });
    }
  }
  return out;
};
exports.listAssetsOf = listAssetsOf;

exports.getJudgeProfile = handler(async (req, res) => {
  const { pid } = req.body;
  if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
  const row = await db.one('SELECT type, judgeProfile FROM problem WHERE pid=?', [pid]);
  if (!row) return fail(res, '题目不存在');

  let profile = null;
  let stored = false;
  if (row.judgeProfile) {
    try { profile = JSON.parse(row.judgeProfile); stored = true; } catch (_) { profile = null; }
  }
  if (!profile) profile = buildPreset(typeToPresetId(row.type));
  return ok(res, { data: { profile, stored, typeId: row.type, assets: listAssetsOf(pid) } });
});

// M5 profile 体检: validate the problem's effective profile + check its assets
// exist. Drives the 数据体检 tab and the pre-flip audit. Manage-gated.
exports.getJudgeHealth = handler(async (req, res) => {
  const { pid } = req.body;
  if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
  const row = await db.one('SELECT type, judgeProfile FROM problem WHERE pid=?', [pid]);
  if (!row) return fail(res, '题目不存在');
  let profile = null;
  let stored = false;
  if (row.judgeProfile) { try { profile = JSON.parse(row.judgeProfile); stored = true; } catch (_) { profile = null; } }
  if (!profile) profile = profileForType(row.type);
  const assets = listAssetsOf(pid).map((a) => a.name);
  const health = profileHealth(profile, assets);
  return ok(res, { data: { ...health, stored, preset: profile.preset, typeId: row.type } });
});

// Return a fresh starter profile for a preset id (no persistence). Lets the
// designer apply presets without duplicating PRESETS on the client.
exports.getJudgePreset = handler(async (req, res) => {
  const { pid } = req.body;
  if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
  const id = String(req.body.preset || 'traditional');
  if (!PRESETS[id]) return fail(res, '未知预设');
  return ok(res, { data: buildPreset(id) });
});

exports.saveJudgeProfile = handler(async (req, res) => {
  const { pid } = req.body;
  const profile = req.body.profile;
  if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
  const { ok: valid, errors } = validateProfile(profile);
  if (!valid) return fail(res, '配置校验失败: ' + errors.slice(0, 5).join('；'));
  const serialized = JSON.stringify(profile);
  if (serialized.length > MAX_PROFILE_BYTES) return fail(res, '配置过大');

  const type = presetToType(profile);
  const r = await db.query('UPDATE problem SET judgeProfile=?, type=? WHERE pid=?', [serialized, type, pid]);
  if (!r.affectedRows) return fail(res, '题目不存在或更新失败');
  recordEvent(req, 'problem.saveJudgeProfile', { pid, preset: profile.preset });
  return ok(res, { typeId: type });
});

exports.listAssets = handler(async (req, res) => {
  const { pid } = req.body;
  if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
  return ok(res, { data: listAssetsOf(pid) });
});

exports.getAsset = handler(async (req, res) => {
  const { pid } = req.body;
  const name = req.body.name;
  if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
  if (badName(name)) return fail(res, '资产名非法');
  const abs = assetAbs(pid, name);
  if (!fs.existsSync(abs)) return ok(res, { data: { name, content: '', missing: true } });
  if (fs.statSync(abs).size > MAX_ASSET_BYTES) return fail(res, '资产过大');
  const content = await getFile(assetRel(pid, name));
  return ok(res, { data: { name, content: content || '', missing: false } });
});

exports.saveAsset = handler(async (req, res) => {
  const { pid } = req.body;
  const name = req.body.name;
  const content = req.body.content;
  if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
  if (badName(name)) return fail(res, '资产名非法');
  if (typeof content !== 'string') return fail(res, '资产内容非法');
  if (content.length > MAX_ASSET_BYTES) return fail(res, '资产过大（上限 1MB）');
  fs.mkdirSync(name === 'checker.cpp' ? dataDir(pid) : assetsDir(pid), { recursive: true });
  await setFile(assetRel(pid, name), content);
  await storage.mirrorProblemData(pid, dataDir(pid));
  recordEvent(req, 'problem.saveAsset', { pid, name });
  return ok(res);
});

exports.renameAsset = handler(async (req, res) => {
  const { pid } = req.body;
  const oldName = req.body.oldName || req.body.name;
  const newName = req.body.newName;
  if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
  if (badName(oldName) || badName(newName)) return fail(res, '资产名非法');
  if (oldName === newName) return ok(res, { data: listAssetsOf(pid) });
  const oldAbs = assetAbs(pid, oldName);
  const newAbs = assetAbs(pid, newName);
  if (!fs.existsSync(oldAbs)) return fail(res, '资产不存在');
  if (fs.existsSync(newAbs)) return fail(res, '目标资产已存在');
  fs.mkdirSync(newName === 'checker.cpp' ? dataDir(pid) : assetsDir(pid), { recursive: true });
  fs.renameSync(oldAbs, newAbs);
  await renameAssetInProfile(pid, oldName, newName);
  await storage.mirrorProblemData(pid, dataDir(pid));
  recordEvent(req, 'problem.renameAsset', { pid, oldName, newName });
  return ok(res, { data: listAssetsOf(pid) });
});

exports.downloadAsset = handler(async (req, res) => {
  const pid = req.query.pid;
  const name = req.query.name;
  if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
  if (badName(name)) return fail(res, '资产名非法');
  const abs = assetAbs(pid, name);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return fail(res, '资产不存在', 404);
  recordEvent(req, 'problem.downloadAsset', { pid, name });
  return res.download(abs, name);
});

exports.deleteAsset = handler(async (req, res) => {
  const { pid } = req.body;
  const name = req.body.name;
  if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
  if (badName(name)) return fail(res, '资产名非法');
  const abs = assetAbs(pid, name);
  if (fs.existsSync(abs)) fs.rmSync(abs);
  await storage.mirrorProblemData(pid, dataDir(pid));
  recordEvent(req, 'problem.deleteAsset', { pid, name });
  return ok(res);
});
