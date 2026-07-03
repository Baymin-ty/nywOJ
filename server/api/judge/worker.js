// Unified judge worker. Every submission is evaluated through judgeProfile;
// older rows without a stored profile are converted from problem.type in memory.
// Everything language-specific lives in languages.js.

const fs = require('fs');
const path = require('path');
const db = require('../../db');
const conf = require('../../config.json');
const { getFile, setFile, delFile } = require('../../file');
const {
  SubmissionInfo,
  ProblemInfo,
  setSubmission,
  getCompareResult,
  updateProblemSubmitInfo,
  updateSubmissionDetail,
  updateData,
  clearCase,
  notifySubmissionProgress,
} = require('./core');
const { updateProblemStat } = require('../problem/core');
const {
  resetJudgeLog,
  appendJudgeLog,
  truncateText,
  summarizeSandboxResult,
  summarizeAxiosError,
} = require('./log');
const { getLanguage, COMPILE_LIMITS, DEFAULT_ENV, stdioFiles } = require('./languages');
const { judgeRes } = require('../../db/format');
const spjCache = require('./checkerCache');
const artifactCache = require('./artifactCache');
const sandboxClient = require('./sandbox');
const { profileForType } = require('../problem/judgeProfile');

const SPJ_CPU_MS = 5_000;
const SPJ_MEM_MB = 512;

// Sandbox status string → submission.judgeResult enum
const RES = {
  Waiting: 0, Pending: 1, Rejudging: 2,
  'Compilation Error': 3,
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

// Named result codes used across this file (must match db/format.js judgeRes).
const AC = 4;
const WA = 5;
const SYSTEM_ERROR = 12;
const PARTIALLY_CORRECT = 15;
const JUDGEMENT_FAILED = 16;

// Distinguishes the two failure classes the outer catch must tell apart:
//   'system'    → backend / judge-machine fault (sandbox down, bug, network)
//                 → System Error (12)
//   'judgement' → problem-configuration fault (missing/invalid data) or a
//                 checker (SPJ) fault → Judgement Failed (16)
// Anything thrown that is NOT a JudgeError is treated as a System Error.
class JudgeError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'JudgeError';
    this.kind = kind;
  }
}

const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

// Interpret a testlib checker's verdict for one case from its stderr (+ exit
// code). testlib writes a human-readable line to stderr (no ANSI colours when
// stderr isn't a TTY, which is always the case inside the sandbox) and exits
// with a code: ok=0 wa=1 pe=2 fail=3 dirt=4 points(quitp)=7 unexpected_eof=8.
//   - quitp(p [, msg])          → "points <p> ..."  (exit 7); <p> read as the
//     case ratio. Values >1 are treated as a percentage (quitp(50) ⇒ 0.5).
//   - quitf(_pc(x) [, msg])     → "partially correct (x) ..."; x read as a %.
//   - quitf(_ok/_wa/_fail, ...) → "ok ..."/"wrong answer ..."/"FAIL ...".
// Returns { kind: 'ok'|'partial'|'wa'|'fail', ratio } where ratio ∈ [0,1].
// `exitCode` may be undefined for the built-in comparer; in that case an
// unrecognised line is treated as WA rather than as a checker fault.
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
  if (head.startsWith('wrong answer') || head.startsWith('wrong output format')
      || head.startsWith('unexpected eof')) {
    return { kind: 'wa', ratio: 0 };
  }
  if (head.startsWith('fail')) return { kind: 'fail', ratio: 0 };
  // Unrecognised text → fall back to the exit code (SPJ path only).
  if (exitCode === undefined || exitCode === null) return { kind: 'wa', ratio: 0 };
  switch (exitCode) {
    case 0: return { kind: 'ok', ratio: 1 };
    case 1: case 2: case 4: case 7: case 8: return { kind: 'wa', ratio: 0 };
    default: return { kind: 'fail', ratio: 0 }; // 3 (FAIL) and anything unexpected
  }
};

// Map a parsed checker verdict to a per-case judgeResult enum.
const verdictToRes = (kind) =>
  kind === 'ok' ? AC : kind === 'partial' ? PARTIALLY_CORRECT : WA;

// `comparer` writes scratch files under ./comparer/tmp/. Tag with submission +
// counter so concurrent workers don't collide on the same path.
let jid = 1;

const logEvent = async (sid, event, data) => {
  await appendJudgeLog(sid, event, data);
  notifySubmissionProgress(sid);
};

const runSandbox = (cmd) => sandboxClient.runOne(cmd);

// Resolve submission.lang → judgeLanguages config.
const resolveLanguage = async (langId) => {
  const row = await db.one('SELECT name FROM languages WHERE id=?', [langId]);
  if (!row) throw new Error(`unknown language id ${langId}`);
  const cfg = getLanguage(row.name);
  if (!cfg) throw new Error(`language "${row.name}" has no judge config`);
  return { name: row.name, ...cfg };
};

// ---- compile (SPJ) ----
const compileSPJ = async (sid, source) => {
  const testlib = await getFile('./comparer/testlib.h');
  const args = ['/usr/bin/g++-9', '-O2', '-std=c++14', '-DONLINE_JUDGE', 'spj.cpp', '-o', 'spj'];
  await logEvent(sid, 'spj.compile.start', { args });
  try {
    const result = await runSandbox({
      command: args,
      env: ['PATH=/usr/bin:/bin'],
      stdio: stdioFiles(),
      ...COMPILE_LIMITS,
      inputFiles: {
        'spj.cpp': { content: source },
        'testlib.h': { content: testlib },
      },
      outputFiles: ['stdout', 'stderr'],
      cachedOutputs: ['spj'],
      cachePrefix: `nywOJ_spj_${sid}`,
    });
    await logEvent(sid, 'spj.compile.result', summarizeSandboxResult(result));
    return result;
  } catch (err) {
    await logEvent(sid, 'spj.compile.error', summarizeAxiosError(err));
    throw err;
  }
};

// Where a checker asset lives: checker.cpp keeps its top-level path, everything
// else is under assets/ (mirrors judgeProfile.assetRel).
const checkerSourcePath = (pid, name) =>
  name === 'checker.cpp' ? `data/${pid}/checker.cpp` : `data/${pid}/assets/${name}`;

// Returns { fileId } on success, { error } if the checker source is missing or
// doesn't compile. Reuses a previously cached fileId when the source hash
// matches — no recompile in that case. `name` defaults to checker.cpp; profile
// check steps may reference any asset as their checker.
const ensureSPJ = async (sid, pid, name = 'checker.cpp') => {
  const source = await getFile(checkerSourcePath(pid, name));
  if (!source) return { error: `No ${name} found, please contact the problem publisher.` };

  const cached = spjCache.get(pid, source, name);
  if (cached) {
    await logEvent(sid, 'spj.compile.cache', { pid, checker: name, cachedFile: cached });
    return { fileId: cached, fromCache: true };
  }
  const result = await compileSPJ(sid, source);
  if (result.exitCode !== 0) {
    return { error: 'SPJ Error\n' + ((result.outputFiles && result.outputFiles.stderr) || '') };
  }
  const fileId = result.cachedFiles && result.cachedFiles.spj;
  spjCache.set(pid, source, fileId, name);
  return { fileId };
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
  });

// Runs the SPJ for one case, tolerating a stale cached binary. If the cached
// fileId was evicted by the sandbox (restart, cache cleanup, etc.), runSPJ throws —
// in that case we drop the cache, recompile the checker once, and retry instead
// of failing the whole submission with a System Error. `spjState` is mutated in
// place ({ fileId, fromCache }) so subsequent cases reuse the recompiled binary.
// A failure on a freshly compiled binary is a genuine SPJ runtime error and is
// propagated unchanged.
const summarizeSPJRun = (spjRun) => ({
  stderr: (spjRun.outputFiles && spjRun.outputFiles.stderr) || '',
  exitCode: spjRun.exitCode,
  status: spjRun.status,
});

const runSPJCase = async (sid, pid, spjState, inputFile, usrOutput, outputFile) => {
  const name = spjState.name || 'checker.cpp';
  try {
    return summarizeSPJRun(await runSPJ(spjState.fileId, inputFile, usrOutput, outputFile));
  } catch (err) {
    if (!spjState.fromCache) throw err; // already fresh — recompiling won't help
    await logEvent(sid, 'spj.run.staleCache', { pid, checker: name, error: summarizeAxiosError(err) });
    spjCache.invalidate(pid, name);
    const spj = await ensureSPJ(sid, pid, name); // cache cleared → forces a recompile
    if (spj.error) throw new JudgeError('judgement', spj.error); // checker won't compile
    spjState.fileId = spj.fileId;
    spjState.fromCache = false;
    return summarizeSPJRun(await runSPJ(spjState.fileId, inputFile, usrOutput, outputFile));
  }
};

// Shared by profile judging and answer judging: run the SPJ for one case and turn its raw
// sandbox result into a { kind, ratio, raw } verdict. A checker that crashes,
// times out, or returns FAIL is a problem/SPJ fault → JudgeError('judgement');
// a sandbox Internal Error is a judge fault → JudgeError('system').
const judgeWithSPJ = async (sid, pid, spjState, inputFile, usrOutput, outputFile) => {
  const out = await runSPJCase(sid, pid, spjState, inputFile, usrOutput, outputFile);
  if (out.status === 'Internal Error') {
    throw new JudgeError('system', 'SPJ sandbox internal error');
  }
  // The checker itself misbehaved (TLE/MLE/Signalled/OLE/...). 'Accepted' and
  // 'Nonzero Exit Status' are the only statuses where testlib actually ran to a
  // verdict; everything else means the checker is broken.
  const verdict = (out.status === 'Accepted' || out.status === 'Nonzero Exit Status')
    ? parseChecker(out.stderr, out.exitCode)
    : { kind: 'fail', ratio: 0 };
  if (verdict.kind === 'fail') {
    throw new JudgeError('judgement', 'SPJ Error\n' + truncateText(out.stderr || `checker status: ${out.status}`, 4096));
  }
  return { ...verdict, raw: out.stderr };
};

// Same contract as judgeWithSPJ, but the checker is the product of a profile
// compile step (check.checker = <compileId>). testlib argv convention applies:
// argv = <inf> <usr> <ans>. No cross-submission cache — the product was just
// compiled for this submission, its fileId is always fresh.
const judgeWithProductChecker = async (product, inputFile, usrOutput, outputFile) => {
  const out = await runSandbox({
    command: [...product.runArgs, 'data.in', 'usr.out', 'data.out'],
    env: product.runEnv || DEFAULT_ENV,
    stdio: stdioFiles(),
    limits: { cpuMs: SPJ_CPU_MS, wallMs: SPJ_CPU_MS * 2, memoryMB: SPJ_MEM_MB, stackMB: SPJ_MEM_MB, processes: 50 },
    inputFiles: {
      [product.binName]: { cachedFile: product.fileId },
      'data.in': { content: inputFile },
      'usr.out': { content: usrOutput },
      'data.out': { content: outputFile },
    },
    outputFiles: ['stdout', 'stderr'],
  });
  if (out.status === 'Internal Error') throw new JudgeError('system', 'checker sandbox internal error');
  const stderr = (out.outputFiles && out.outputFiles.stderr) || '';
  const verdict = (out.status === 'Accepted' || out.status === 'Nonzero Exit Status')
    ? parseChecker(stderr, out.exitCode)
    : { kind: 'fail', ratio: 0 };
  if (verdict.kind === 'fail') {
    throw new JudgeError('judgement', 'Checker Error\n' + truncateText(stderr || `checker status: ${out.status}`, 4096));
  }
  return { ...verdict, raw: stderr };
};

// ---- compare (default checker) ----
const compareDefault = async (sid, usrOutput, outputFile) => {
  const fileSuf = `./comparer/tmp/${sid}-${++jid}_`;
  await setFile(`${fileSuf}usr.out`, usrOutput);
  await setFile(`${fileSuf}data.out`, outputFile);
  try {
    return await getCompareResult(fileSuf);
  } finally {
    try { await delFile(`${fileSuf}usr.out`); } catch (_) { /* best effort */ }
    try { await delFile(`${fileSuf}data.out`); } catch (_) { /* best effort */ }
  }
};

// ---- aggregate ----
// Honors subtask `option` (0 = per-case proportional, 1 = all-or-nothing) and
// `dependencies` (subtask fails if any dep didn't AC). `skip` is an
// optimization: if a subtask is marked skip and a TLE shows up mid-run,
// remaining cases in that subtask are short-circuited as result=14 (Skipped).
// `judgeResult` entries carry an optional `ratio` ∈ [0,1] (SPJ partial credit);
// when absent we derive a binary ratio from judgeResult (AC ⇒ 1, else 0), so
// non-SPJ problems score exactly as before. SENTINEL marks "no failing case
// recorded yet" — it must sort *above* every real verdict so a subtask whose
// only non-AC cases are Partially Correct (15) keeps res=15 instead of being
// pinned to the old 12 sentinel.
const SENTINEL = 99;
const ratioOf = (cr) =>
  typeof cr.ratio === 'number' ? clamp01(cr.ratio) : (cr.judgeResult === AC ? 1 : 0);

const aggregate = (subtasks, judgeResult) => {
  const info = {};
  for (const s of subtasks) {
    info[s.index] = {
      subtaskStatus: [],
      time: 0,
      memory: 0,
      res: SENTINEL,
      score: 0,
      fullScore: s.score,
      option: s.option,
      dependencies: s.dependencies || null,
    };
  }
  for (const r of judgeResult) info[r.subtaskId].subtaskStatus.push(r);

  for (const i of Object.keys(info)) {
    const sub = info[i];
    let acNum = 0, totalNum = 0, sumRatio = 0, minRatio = 1;
    for (const cr of sub.subtaskStatus) {
      totalNum++;
      sub.time += cr.time;
      sub.memory = Math.max(sub.memory, cr.memory);
      const ratio = ratioOf(cr);
      sumRatio += ratio;
      minRatio = Math.min(minRatio, ratio);
      if (cr.judgeResult === AC) acNum++;
      else sub.res = Math.min(sub.res, cr.judgeResult);
    }
    if (totalNum > 0) {
      // option 0 = 等分 (proportional over cases); option 1 = 捆绑/min (the
      // weakest case caps the subtask, IOI-style). Both collapse to the classic
      // all-or-nothing / proportional behaviour when ratios are binary.
      sub.score = sub.option
        ? Math.round(sub.fullScore * minRatio)
        : Math.ceil((sub.fullScore * sumRatio) / totalNum);
    }
    if (totalNum > 0 && acNum === totalNum) {
      sub.res = AC;
      sub.score = sub.fullScore;
    }
    if (sub.dependencies) {
      for (const id of sub.dependencies) {
        if (info[id] && info[id].res !== AC) {
          sub.res = info[id].res;
          sub.score = 0;
          break;
        }
      }
    }
  }

  let totalTime = 0, maxMemory = 0, totalScore = 0;
  let acSub = 0, totalSub = 0, worst = SENTINEL;
  const subtaskList = [];
  for (const i of Object.keys(info)) {
    const sub = info[i];
    totalSub++;
    totalTime += sub.time;
    maxMemory = Math.max(maxMemory, sub.memory);
    totalScore += sub.score;
    const subRes = sub.res === SENTINEL ? AC : sub.res; // no failing case ⇒ AC
    subtaskList.push({
      index: i,
      time: sub.time, memory: sub.memory,
      res: subRes, score: sub.score, fullScore: sub.fullScore,
      option: sub.option,
      dependencies: sub.dependencies || [],
    });
    if (subRes === AC) acSub++;
    else worst = Math.min(worst, subRes);
  }

  // Final verdict follows the same priority rule as a subtask: the
  // highest-priority (lowest-numbered) non-AC subtask result wins; all subtasks
  // AC ⇒ Accepted. Partially Correct (15) therefore surfaces only when the worst
  // subtask is itself partial (all-partial, or partial+AC) — a harder failure
  // like WA/TLE on another subtask outranks it, exactly as before this feature.
  let finalRes;
  if (totalSub > 0 && acSub === totalSub) {
    finalRes = AC;
    totalScore = 100;
  } else {
    finalRes = worst === SENTINEL ? AC : worst;
  }
  return { finalRes, totalTime, maxMemory, totalScore, acSub, totalSub, subtaskList };
};

// ---- answer-submission judge ----
// Answer-mode profile: no code, no sandbox run. The submission stored each
// user-supplied answer to `./answerSubmissions/{sid}/{case.name}.out`. We
// compare those against the expected outputs case by case, then aggregate
// the same way as code submissions so the result UI is identical.
//
// `opts` comes from the answer-mode profile and selects the checker.
// hack 测试点用 `hack:` 前缀标记（storage 层拒绝 ..，不能用相对路径逃出题目目录），
// caseFilePath 统一翻译真实存储键。
const caseFilePath = (pid, name) =>
  String(name).startsWith('hack:') ? `./data/hacks/${String(name).slice(5)}` : `./data/${pid}/${name}`;

// 按提交的评测范围选择测试点（CF 赛制）：
// - judgeScope='pretest'：只跑 config.pretests 标记的测试点（未标记则全跑），
//   并裁掉没有保留测试点的子任务；
// - 全量评测且为比赛内提交：追加该场该题的成功 hack 数据（0 分附加子任务，
//   option=1 捆绑 —— 挂了只翻裁决不改分）。
const selectJudgeCases = async (config, sinfo) => {
  let cases = config.cases;
  let subtasks = config.subtask || [];
  if (sinfo && sinfo.judgeScope === 'pretest') {
    const marks = new Set(Array.isArray(config.pretests) ? config.pretests.map(Number) : []);
    if (marks.size) {
      cases = cases.filter((c) => marks.has(Number(c.index)));
      if (!cases.length) throw new JudgeError('judgement', 'CASE ERROR: pretests 标记不含任何有效测试点');
      const keep = new Set(cases.map((c) => c.subtaskId));
      subtasks = subtasks.filter((s) => keep.has(s.index));
    }
    return { cases, subtasks };
  }
  if (sinfo && sinfo.cid) {
    const hacks = await db.query(
      "SELECT hackId FROM contestHack WHERE cid=? AND pid=? AND status='success' ORDER BY hackId",
      [sinfo.cid, sinfo.pid]
    ).catch(() => []);
    if (hacks.length) {
      const maxIdx = Math.max(0, ...cases.map((c) => Number(c.index) || 0));
      const maxSub = Math.max(0, ...subtasks.map((s) => Number(s.index) || 0));
      cases = cases.concat(hacks.map((h, i) => ({
        index: maxIdx + 1 + i,
        input: `hack:${sinfo.cid}/${h.hackId}.in`,
        output: `hack:${sinfo.cid}/${h.hackId}.ans`,
        subtaskId: maxSub + 1,
      })));
      subtasks = subtasks.concat([{ index: maxSub + 1, score: 0, option: 1 }]);
    }
  }
  return { cases, subtasks };
};

const judgeAnswer = async (sid, sinfo, pinfo, isRejudge, opts = null) => {
  const pid = pinfo.pid;
  const useSpj = opts ? !!opts.useSpj : false;
  const checkerName = (opts && opts.checkerName) || 'checker.cpp';
  try {
    await setSubmission(sid, 1, 0, 0, 0, null, null, conf.JUDGE.NAME);
    await resetJudgeLog(sid, {
      sid, pid,
      lang: null,
      langName: 'answer',
      isRejudge: !!isRejudge,
      worker: conf.JUDGE.NAME,
      timeLimit: 0,
      memoryLimit: 0,
      mode: useSpj ? 'answer-spj' : 'answer',
    });
    await clearCase(sid);

    if (!conf.JUDGE.ISSERVER) await updateData(pid);

    // SPJ binary (cached) — only for answer-spj. A missing/uncompilable checker
    // is a problem-configuration fault → Judgement Failed (16), not System Error.
    const spjState = { cachedFile: '', fromCache: false, name: checkerName };
    if (useSpj) {
      const spj = await ensureSPJ(sid, pid, checkerName);
      if (spj.error) {
        await db.query('UPDATE submission SET judgeResult=?,compileResult=? WHERE sid=?', [JUDGEMENT_FAILED, spj.error, sid]);
        await updateProblemSubmitInfo(pid);
        await updateProblemStat(pid);
        return;
      }
      spjState.fileId = spj.fileId;
      spjState.fromCache = !!spj.fromCache;
    }

    const configRaw = await getFile(`./data/${pid}/config.json`);
    const config = configRaw ? JSON.parse(configRaw) : null;
    if (!config || !config.cases) throw new JudgeError('judgement', 'CASE ERROR: config.cases is null or undefined');
    const { cases, subtasks } = await selectJudgeCases(config, sinfo);

    const judgeResult = [];
    const answerDir = path.join(__dirname, '..', '..', 'answerSubmissions', String(sid));
    const answerCaseNameOf = (c) => {
      const raw = c && c.input ? path.basename(String(c.input)) : String(c && c.index || '');
      const name = raw.endsWith('.in') ? raw.slice(0, -3) : raw.endsWith('.out') ? raw.slice(0, -4) : raw;
      return name && !/[\/\\]/.test(name) && name !== '.' && name !== '..' && !name.includes('\0')
        ? name
        : String(c && c.index || '');
    };

    for (const c of cases) {
      const caseName = answerCaseNameOf(c);
      const userAnswerPath = path.join(answerDir, `${caseName}.out`);
      const usrOutput = fs.existsSync(userAnswerPath)
        ? fs.readFileSync(userAnswerPath, 'utf-8')
        : '';
      const inputFile = await getFile(caseFilePath(pid, c.input));
      const outputFile = await getFile(caseFilePath(pid, c.output));
      if (inputFile === null || outputFile === null) {
        throw new JudgeError('judgement', `DATA ERROR: missing ${inputFile === null ? c.input : c.output}`);
      }

      await logEvent(sid, 'case.start', {
        caseId: c.index,
        subtaskId: c.subtaskId,
        input: truncateText(inputFile, 1024),
      });

      let verdict, compareRes = '';
      try {
        if (!useSpj) {
          compareRes = await compareDefault(sid, usrOutput, outputFile);
          verdict = parseChecker(compareRes);
        } else {
          verdict = await judgeWithSPJ(sid, pid, spjState, inputFile, usrOutput, outputFile);
          compareRes = verdict.raw || '';
        }
      } catch (err) {
        await logEvent(sid, 'case.error', { caseId: c.index, error: summarizeAxiosError(err) });
        // Stale SPJ caches are retried inside runSPJCase; reaching here means a
        // genuine failure (JudgeError from judgeWithSPJ, or a sandbox/network
        // fault) — propagate so the outer catch records JF vs System Error.
        throw err;
      }

      const caseRes = verdictToRes(verdict.kind);
      await logEvent(sid, 'case.compare', {
        caseId: c.index,
        result: verdict.kind === 'ok' ? 'ok' : verdict.kind === 'partial' ? 'partial' : 'wa',
        ratio: verdict.ratio,
        detail: truncateText(compareRes, 4096),
      });
      // time/memory are not meaningful for answer-submission — keep 1ms/1KB
      // so the UI doesn't crash on divisions or color thresholds.
      const t = 1;
      const mem = 1;
      await updateSubmissionDetail(
        sid, c.index,
        inputFile.substring(0, 255) + (inputFile.length > 255 ? '......\n' : ''),
        usrOutput.substring(0, 255) + (usrOutput.length > 255 ? '......\n' : ''),
        t, mem, caseRes, compareRes, c.subtaskId,
      );
      judgeResult.push({ time: t, memory: mem, subtaskId: c.subtaskId, judgeResult: caseRes, ratio: verdict.ratio });
    }

    const agg = aggregate(subtasks, judgeResult);
    if (agg.totalSub > 0 && agg.acSub === agg.totalSub) {
      await db.query('UPDATE problem SET acCnt=acCnt+1 WHERE pid=?', [pid]);
    }
    await logEvent(sid, 'finish', {
      finalRes: agg.finalRes,
      totalTime: agg.totalTime,
      maxMemory: agg.maxMemory,
      totalScore: agg.totalScore,
    });
    await setSubmission(
      sid, agg.finalRes, agg.totalTime, agg.maxMemory, agg.totalScore,
      null, JSON.stringify(agg.subtaskList), conf.JUDGE.NAME,
    );
    await updateProblemSubmitInfo(pid);
    await updateProblemStat(pid);
  } catch (err) {
    console.log(err);
    await logEvent(sid, 'error', {
      kind: err && err.kind === 'judgement' ? 'judgement' : 'system',
      message: err && err.message ? err.message : String(err),
      stack: truncateText(err && err.stack ? err.stack : ''),
    });
    const finalRes = err && err.kind === 'judgement' ? JUDGEMENT_FAILED : SYSTEM_ERROR;
    await setSubmission(sid, finalRes, 0, 0, 0, String(err && err.message ? err.message : err), null, conf.JUDGE.NAME);
    await updateProblemSubmitInfo(pid);
    await updateProblemStat(pid);
  }
};

// ============================================================================
// Profile interpreter. Reuses the stable helpers above and supports code,
// answer, default/SPJ/product checkers, and pipeGroup flows.
// ============================================================================
const limitVal = (v, problemVal) => (v === 'problem' || v == null ? problemVal : v);

const profileAssetContent = (pid, name) =>
  name === 'checker.cpp' ? getFile(`./data/${pid}/checker.cpp`) : getFile(`./data/${pid}/assets/${name}`);

// Submission files by name: the primary source slot maps to submission.code;
// any extra slots are stored per-submission in submissionFile (fileKey = slot
// name). primaryCode is what auto-compile feeds to the language compiler.
const loadProfileSubmit = async (sinfo, profile) => {
  const byName = new Map();
  const files = (profile.submit && profile.submit.files) || [];
  const primary = files.find((f) => f.kind === 'source');
  if (primary && primary.name) byName.set(primary.name, sinfo.code);
  const rows = await db.query('SELECT fileKey, content FROM submissionFile WHERE sid=?', [sinfo.sid]);
  for (const r of rows) byName.set(r.fileKey, r.content == null ? '' : r.content);
  return { byName, primaryCode: sinfo.code };
};

const resolveCompileInputWithMeta = async (pid, name, submit) => {
  const asset = await profileAssetContent(pid, name);
  if (asset !== null) return { content: asset, source: 'asset' };
  if (submit.byName.has(name)) return { content: submit.byName.get(name), source: 'submit' };
  throw new JudgeError('judgement', `编译输入 ${name} 不存在（既非资产也非提交文件）`);
};

const resolveCompileInput = async (pid, name, submit) =>
  (await resolveCompileInputWithMeta(pid, name, submit)).content;

// Compile one step → { product } | { ce }. product = { fileId, runArgs, binName }.
const compileProfileStep = async (sid, pid, step, lang, submit) => {
  const base = { env: DEFAULT_ENV, stdio: stdioFiles(), ...COMPILE_LIMITS, outputFiles: ['stdout', 'stderr'] };
  let result;
  if (step.command === 'auto') {
    if (!lang) throw new JudgeError('judgement', 'auto 编译需要选手语言');
    result = await runSandbox({
      ...base, env: lang.compileEnv || DEFAULT_ENV, command: lang.compileArgs,
      inputFiles: { [lang.sourceFile]: { content: submit.primaryCode } },
      cachedOutputs: [lang.binary], cachePrefix: `nywOJ_${sid}_${step.id}`,
    });
    if (result.exitCode !== 0) return { ce: result };
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
  // testlib.h is the de-facto standard for checkers/interactors/graders; inject it
  // so they can `#include "testlib.h"` without listing it as an input.
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
        await logEvent(sid, 'compile.cache', { id: step.id, pid, cachedFile: cached });
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
      await logEvent(sid, 'compile.cache.miss', { id: step.id, pid, reason: 'sandbox file missing' });
    }
  }
  result = await runSandbox({
    ...base, command: step.command, inputFiles,
    cachedOutputs: [step.id], cachePrefix: `nywOJ_${sid}_${step.id}`,
  });
  if (result.exitCode !== 0) return { ce: result };
  const fileId = result.cachedFiles && result.cachedFiles[step.id];
  if (cacheable && fileId) artifactCache.set(pid, step.id, cacheHash, fileId);
  return { product: { fileId, runArgs: [step.id], runEnv: DEFAULT_ENV, binName: step.id, cached: cacheable } };
};

const runProduct = async (product, inputFile, timeMs, memMB) => {
  return runSandbox({
    command: product.runArgs, env: product.runEnv || DEFAULT_ENV, stdio: stdioFiles({ content: inputFile }),
    limits: { cpuMs: timeMs, wallMs: timeMs * 2, memoryMB: memMB, stackMB: memMB, processes: 50 },
    inputFiles: { [product.binName]: { cachedFile: product.fileId } },
    outputFiles: ['stdout', 'stderr'],
  });
};

// Resolve a Ref (exec.stdin / check.args entry) to content.
const resolveProfileRef = async (ref, ctx) => {
  if (ref && typeof ref === 'object') return ref.literal || '';
  if (ref === 'case.input') return ctx.inputFile;
  if (ref === 'case.answer') return ctx.outputFile;
  if (ref === 'submit.answer') return ctx.submitAnswer || '';
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

// ---- pipeGroup (M3: interactive / communication) ----
// Runs N members concurrently in one sandbox request, wired by pipes (fd↔fd). The
// `verdictFrom` member (interactor/manager) emits a testlib verdict via its
// exit/stderr; `chargeTimeTo` (the contestant) supplies the case time/mem and,
// if it faults (TLE/MLE/RE), that fault is the verdict.
const FD = { stdin: 0, stdout: 1, stderr: 2 };
const PIPE_STDERR_MAX = 64 * 1024 * 1024;

// A pipe endpoint fd is either a name (stdin/stdout/stderr) or a raw number
// (e.g. a communication manager talking to side A on fd3/fd4, side B on fd5/fd6).
const fdOf = (tok) => {
  if (Object.prototype.hasOwnProperty.call(FD, tok)) return FD[tok];
  const n = Number(tok);
  if (Number.isInteger(n) && n >= 0 && n <= 255) return n;
  throw new JudgeError('judgement', `pipeGroup 非法 fd: ${tok}`);
};

// Each command's stdio array must cover every fd it references. Piped fds are
// null because the pipe supplies them; non-piped fds use regular sandbox files.
const buildPipeFiles = (pipedSet) => {
  const maxFd = Math.max(2, ...pipedSet);
  const files = [];
  for (let i = 0; i <= maxFd; i++) {
    if (pipedSet.has(i)) files[i] = null;                                  // pipe endpoint
    else if (i === 1) files[i] = { name: 'stdout', max: PIPE_STDERR_MAX }; // captured (verdict diag)
    else if (i === 2) files[i] = { name: 'stderr', max: PIPE_STDERR_MAX }; // captured (verdict)
    else files[i] = { content: '' };                                      // unused stdin / extra fd
  }
  return files;
};

const pipeChargeTargets = (step) => {
  const raw = step.chargeTimeTo != null ? step.chargeTimeTo : step.verdictFrom;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((id) => id != null && id !== '');
};

const pipeGroupStep = async (sid, pid, step, ctx, products, pinfo) => {
  const members = step.members || [];
  const idxById = {};
  members.forEach((m, i) => { idxById[m.id] = i; });

  // Parse pipes first so we know which fds each member has piped.
  const pipedFds = members.map(() => new Set());
  const pipes = (step.pipes || []).map((p) => {
    const [fromId, fromFd] = String(p.from).split('.');
    const [toId, toFd] = String(p.to).split('.');
    if (idxById[fromId] == null || idxById[toId] == null) throw new JudgeError('judgement', `pipeGroup 管道端点非法: ${p.from} → ${p.to}`);
    const inFd = fdOf(fromFd), outFd = fdOf(toFd);
    pipedFds[idxById[fromId]].add(inFd);
    pipedFds[idxById[toId]].add(outFd);
    return { from: { command: idxById[fromId], fd: inFd }, to: { command: idxById[toId], fd: outFd } };
  });

  const cmds = [];
  for (let mi = 0; mi < members.length; mi++) {
    const m = members[mi];
    const product = products[m.exec];
    if (!product) throw new JudgeError('judgement', `pipeGroup 成员 ${m.id} 引用了未编译的产物 ${m.exec}`);
    const tl = limitVal(m.limits && m.limits.time, pinfo.timeLimit);
    const ml = limitVal(m.limits && m.limits.mem, pinfo.memoryLimit);
    const inputFiles = { [product.binName]: { cachedFile: product.fileId } };
    // Materialize Ref args (case.input / case.answer / asset:x) into files and
    // pass the sandbox filename as the actual argv token.
    const args = [...product.runArgs];
    let seq = 0;
    for (const raw of m.args || []) {
      // {literal:"x"} ⇒ pass verbatim (e.g. a scratch output filename the
      // interactor writes to). A Ref string ⇒ materialize its content as a file
      // and pass that filename (e.g. case.input the interactor reads).
      if (raw && typeof raw === 'object' && typeof raw.literal === 'string') { args.push(raw.literal); continue; }
      const content = await resolveProfileRef(raw, ctx);
      const fname = `arg${seq++}_${path.basename(String(raw)).replace(/[^A-Za-z0-9._-]/g, '_')}`;
      inputFiles[fname] = { content };
      args.push(fname);
    }
    cmds.push({
      command: args,
      env: product.runEnv || DEFAULT_ENV,
      stdio: buildPipeFiles(pipedFds[mi]),
      limits: { cpuMs: tl, wallMs: tl * 2, memoryMB: ml, stackMB: ml, processes: 50 },
      inputFiles,
      outputFiles: ['stdout', 'stderr'],
    });
  }

  const res = await sandboxClient.run(cmds, { pipes });
  const vIdx = idxById[step.verdictFrom];
  const chargeIndices = pipeChargeTargets(step).map((id) => idxById[id]).filter((idx) => idx != null);
  const vRes = res[vIdx];
  const chargeResults = chargeIndices.length ? chargeIndices.map((idx) => res[idx]) : [vRes];
  const t = Math.max(1, chargeResults.reduce((sum, r) => sum + ((r && r.cpuTimeMs) || 0), 0));
  const mem = Math.max(1, chargeResults.reduce((max, r) => Math.max(max, (r && r.memoryKb) || 0), 0));

  // The interactor (verdictFrom) is authoritative. Only a contestant *resource*
  // fault overrides it — TLE/MLE/OLE the interactor can't observe. A teardown
  // signal (the contestant gets SIGKILL'd when the interactor quits first) or a
  // broken-pipe exit must NOT mask an OK/WA verdict, so we don't treat those as
  // contestant faults here.
  const RESOURCE_FAULT = new Set(['Time Limit Exceeded', 'Memory Limit Exceeded', 'Output Limit Exceeded']);
  const faultRes = chargeResults.find((r) => r && RESOURCE_FAULT.has(r.status));
  if (faultRes) {
    return { caseRes: RES[faultRes.status], ratio: 0, t, mem, detail: (faultRes.outputFiles && faultRes.outputFiles.stderr) || '' };
  }
  if (!vRes || vRes.status === 'Internal Error') throw new JudgeError('system', 'interactor/manager sandbox internal error');
  const verdict = (vRes.status === 'Accepted' || vRes.status === 'Nonzero Exit Status')
    ? parseChecker((vRes.outputFiles && vRes.outputFiles.stderr) || '', vRes.exitCode)
    : { kind: 'fail', ratio: 0 };
  if (verdict.kind === 'fail') {
    throw new JudgeError('judgement', 'Interactor Error\n' + truncateText((vRes.outputFiles && vRes.outputFiles.stderr) || `status: ${vRes.status}`, 4096));
  }
  return { caseRes: verdictToRes(verdict.kind), ratio: verdict.ratio, t, mem, detail: (vRes.outputFiles && vRes.outputFiles.stderr) || '' };
};

// For answer-mode profiles the checker comes from the profile's check step,
// not the display-only problem.type.
const answerJudgeOpts = (profile) => {
  const steps = (profile.run && profile.run.perCase) || [];
  const check = steps.find((s) => s && s.kind === 'check');
  const checker = check && check.checker;
  if (typeof checker === 'string' && checker.startsWith('asset:')) {
    return { useSpj: true, checkerName: checker.slice(6) };
  }
  return { useSpj: false, checkerName: null };
};

const judgeByProfile = async (sid, sinfo, pinfo, profile, isRejudge) => {
  const pid = pinfo.pid;
  const mode = (profile.submit && profile.submit.mode) || 'code';
  if (mode === 'answer') return judgeAnswer(sid, sinfo, pinfo, isRejudge, answerJudgeOpts(profile));

  try {
    const lang = await resolveLanguage(sinfo.lang);
    await setSubmission(sid, 1, 0, 0, 0, null, null, conf.JUDGE.NAME);
    await resetJudgeLog(sid, {
      sid, pid, lang: sinfo.lang, langName: lang.name, isRejudge: !!isRejudge,
      worker: conf.JUDGE.NAME, timeLimit: pinfo.timeLimit, memoryLimit: pinfo.memoryLimit,
      mode: 'profile', preset: profile.preset,
    });
    await clearCase(sid);
    if (!conf.JUDGE.ISSERVER) await updateData(pid);

    const submit = await loadProfileSubmit(sinfo, profile);

    // 1) compile steps
    const products = {};
    for (const step of profile.compile || []) {
      await logEvent(sid, 'compile.start', { id: step.id, command: step.command });
      const r = await compileProfileStep(sid, pid, step, lang, submit);
      await logEvent(sid, 'compile.result', { id: step.id, ...summarizeSandboxResult(r.ce || {}) });
      if (r.ce) {
        const stderr = (r.ce.outputFiles && r.ce.outputFiles.stderr) || '';
        const stdout = (r.ce.outputFiles && r.ce.outputFiles.stdout) || '';
        const error = `Compilation Error (${step.id})\n` + stderr + (stdout ? '\n' + stdout : '');
        await db.query('UPDATE submission SET judgeResult=3,compileResult=? WHERE sid=?', [error, sid]);
        await updateProblemSubmitInfo(pid);
        await updateProblemStat(pid);
        return;
      }
      products[step.id] = r.product;
    }

    // 2) SPJ checkers — one compiled + cached binary per asset a check step
    // references (checker: "asset:<name>"). checker.cpp keeps the default cache
    // slot; other assets are cached under pid:name.
    const perCase = (profile.run && profile.run.perCase) || [];
    const spjStates = {};
    const assetCheckers = [...new Set(perCase
      .filter((s) => s.kind === 'check' && typeof s.checker === 'string' && s.checker.startsWith('asset:'))
      .map((s) => s.checker.slice(6)))];
    for (const name of assetCheckers) {
      const spj = await ensureSPJ(sid, pid, name);
      if (spj.error) {
        await db.query('UPDATE submission SET judgeResult=?,compileResult=? WHERE sid=?', [JUDGEMENT_FAILED, spj.error, sid]);
        await updateProblemSubmitInfo(pid);
        await updateProblemStat(pid);
        return;
      }
      spjStates[name] = { fileId: spj.fileId, fromCache: !!spj.fromCache, name };
    }

    // 3) cases
    const configRaw = await getFile(`./data/${pid}/config.json`);
    const config = configRaw ? JSON.parse(configRaw) : null;
    if (!config || !config.cases) throw new JudgeError('judgement', 'CASE ERROR: config.cases is null or undefined');
    const { cases, subtasks } = await selectJudgeCases(config, sinfo);

    const skipFlag = {};
    for (const s of subtasks) if (s.skip) skipFlag[s.index] = 1;
    const judgeResult = [];

    for (const c of cases) {
      if (skipFlag[c.subtaskId] === 2) {
        await updateSubmissionDetail(sid, c.index, '', '', 0, 0, 14, '', c.subtaskId);
        judgeResult.push({ time: 0, memory: 0, subtaskId: c.subtaskId, judgeResult: 14 });
        continue;
      }
      const inputFile = await getFile(caseFilePath(pid, c.input));
      const outputFile = await getFile(caseFilePath(pid, c.output));
      if (inputFile === null || outputFile === null) {
        throw new JudgeError('judgement', `DATA ERROR: missing ${inputFile === null ? c.input : c.output}`);
      }
      await logEvent(sid, 'case.start', { caseId: c.index, subtaskId: c.subtaskId, input: truncateText(inputFile, 1024) });

      const ctx = { pid, inputFile, outputFile, artifacts: {}, submitAnswer: '' };
      let caseRes = AC, ratio = 1, compareRes = '', t = 1, mem = 1, usrOut = '', runtimeFail = false;

      for (const step of perCase) {
        if (step.kind === 'exec') {
          const product = products[step.exec];
          if (!product) throw new JudgeError('judgement', `运行步骤引用了未编译的产物 ${step.exec}`);
          const stdinRef = step.stdin && step.stdin.from != null ? step.stdin.from : (step.stdin || 'case.input');
          const stdin = await resolveProfileRef(stdinRef, ctx);
          const tl = limitVal(step.limits && step.limits.time, pinfo.timeLimit);
          const ml = limitVal(step.limits && step.limits.mem, pinfo.memoryLimit);
          let rr;
          try { rr = await runProduct(product, stdin, tl, ml); }
          catch (err) { await logEvent(sid, 'case.error', { caseId: c.index, error: summarizeAxiosError(err) }); throw err; }
          const stepT = Math.max(1, rr.cpuTimeMs || 0);
          const stepMem = Math.max(1, rr.memoryKb || 0);
          ctx.artifacts[step.id] = {
            stdout: (rr.outputFiles && rr.outputFiles.stdout) || '', stderr: (rr.outputFiles && rr.outputFiles.stderr) || '',
            status: rr.status, time: stepT, memory: stepMem,
          };
          t = Math.max(t, stepT); mem = Math.max(mem, stepMem); usrOut = ctx.artifacts[step.id].stdout;
          await logEvent(sid, 'case.run', {
            caseId: c.index,
            stepId: step.id,
            status: rr.status,
            time: rr.cpuTimeMs,
            memory: rr.memoryKb,
            exitCode: rr.exitCode,
          });
          if (rr.status !== 'Accepted') {
            caseRes = RES[rr.status] != null ? RES[rr.status] : SYSTEM_ERROR;
            ratio = 0; runtimeFail = true; compareRes = ctx.artifacts[step.id].stderr;
            // On a runtime fault the detail's output column shows
            // the step's stderr so contestants see their own diagnostics.
            usrOut = ctx.artifacts[step.id].stderr;
            if (rr.status === 'Time Limit Exceeded' && skipFlag[c.subtaskId] === 1) skipFlag[c.subtaskId] = 2;
            break;
          }
        } else if (step.kind === 'check') {
          const args = step.args || ['case.input', 'case.answer', 'case.answer'];
          const inf = await resolveProfileRef(args[0] != null ? args[0] : 'case.input', ctx);
          const usr = await resolveProfileRef(args[1] != null ? args[1] : 'case.answer', ctx);
          const ans = await resolveProfileRef(args[2] != null ? args[2] : 'case.answer', ctx);
          let verdict;
          if (step.checker === 'default') {
            compareRes = await compareDefault(sid, usr, ans);
            verdict = parseChecker(compareRes);
          } else if (typeof step.checker === 'string' && step.checker.startsWith('asset:')) {
            verdict = await judgeWithSPJ(sid, pid, spjStates[step.checker.slice(6)], inf, usr, ans);
            compareRes = verdict.raw || '';
          } else if (products[step.checker]) {
            verdict = await judgeWithProductChecker(products[step.checker], inf, usr, ans);
            compareRes = verdict.raw || '';
          } else {
            throw new JudgeError('judgement', `check 步骤引用了未知的 checker：${step.checker}`);
          }
          caseRes = verdictToRes(verdict.kind); ratio = verdict.ratio;
        } else if (step.kind === 'pipeGroup') {
          let pg;
          await logEvent(sid, 'case.pipe.start', {
            caseId: c.index,
            stepId: step.id,
            members: (step.members || []).map((m) => m.id),
            pipes: step.pipes || [],
            verdictFrom: step.verdictFrom,
            chargeTimeTo: step.chargeTimeTo,
          });
          try { pg = await pipeGroupStep(sid, pid, step, ctx, products, pinfo); }
          catch (err) { await logEvent(sid, 'case.error', { caseId: c.index, error: summarizeAxiosError(err) }); throw err; }
          caseRes = pg.caseRes; ratio = pg.ratio; t = Math.max(t, pg.t); mem = Math.max(mem, pg.mem);
          compareRes = pg.detail;
          await logEvent(sid, 'case.pipe.result', {
            caseId: c.index,
            stepId: step.id,
            result: caseRes,
            resultName: judgeRes[caseRes] || String(caseRes),
            ratio,
            time: pg.t,
            memory: pg.mem,
            detail: truncateText(pg.detail, 4096),
          });
          if (caseRes === RES['Time Limit Exceeded'] && skipFlag[c.subtaskId] === 1) skipFlag[c.subtaskId] = 2;
        }
      }

      // Keep the log convention so the judge-log UI renders correctly:
      // case.compare carries a STRING verdict ('ok'/'partial'/'wa'), and is only
      // emitted after an actual comparison — a run-step fault (TLE/RE/...) is
      // surfaced by case.run instead.
      if (!runtimeFail) {
        const compareKind = caseRes === AC ? 'ok' : (ratio > 0 && ratio < 1) ? 'partial' : 'wa';
        await logEvent(sid, 'case.compare', { caseId: c.index, result: compareKind, ratio, detail: truncateText(compareRes, 4096) });
      }
      await updateSubmissionDetail(
        sid, c.index,
        inputFile.substring(0, 255) + (inputFile.length > 255 ? '......\n' : ''),
        usrOut.substring(0, 255) + (usrOut.length > 255 ? '......\n' : ''),
        t, mem, caseRes, runtimeFail ? '' : compareRes, c.subtaskId,
      );
      judgeResult.push({ time: t, memory: mem, subtaskId: c.subtaskId, judgeResult: caseRes, ratio });
    }

    // 4) aggregate
    const agg = aggregate(subtasks, judgeResult);
    if (agg.totalSub > 0 && agg.acSub === agg.totalSub) {
      await db.query('UPDATE problem SET acCnt=acCnt+1 WHERE pid=?', [pid]);
    }
    await logEvent(sid, 'finish', { finalRes: agg.finalRes, totalTime: agg.totalTime, maxMemory: agg.maxMemory, totalScore: agg.totalScore });
    await setSubmission(sid, agg.finalRes, agg.totalTime, agg.maxMemory, agg.totalScore, null, JSON.stringify(agg.subtaskList), conf.JUDGE.NAME);
    await updateProblemSubmitInfo(pid);
    await updateProblemStat(pid);
  } catch (err) {
    console.log(err);
    await logEvent(sid, 'error', {
      kind: err && err.kind === 'judgement' ? 'judgement' : 'system',
      message: err && err.message ? err.message : String(err),
      stack: truncateText(err && err.stack ? err.stack : ''),
    });
    const finalRes = err && err.kind === 'judgement' ? JUDGEMENT_FAILED : SYSTEM_ERROR;
    await setSubmission(sid, finalRes, 0, 0, 0, String(err && err.message ? err.message : err), null, conf.JUDGE.NAME);
    await updateProblemSubmitInfo(pid);
    await updateProblemStat(pid);
  }
};

// ---- main ----
const judgeCode = async (sid, isRejudge) => {
  const sinfo = await SubmissionInfo(sid);
  if (!sinfo) return;
  const pid = sinfo.pid;
  const pinfo = await ProblemInfo(pid);
  if (!pinfo) return;

  try {
    const profile = pinfo.judgeProfile ? JSON.parse(pinfo.judgeProfile) : profileForType(pinfo.type);
    return await judgeByProfile(sid, sinfo, pinfo, profile, isRejudge);
  } catch (err) {
    console.log(err);
    const message = err && err.message ? err.message : String(err);
    const finalRes = err instanceof SyntaxError ? JUDGEMENT_FAILED : SYSTEM_ERROR;
    await setSubmission(sid, finalRes, 0, 0, 0, message, null, conf.JUDGE.NAME);
    await updateProblemSubmitInfo(pid);
    await updateProblemStat(pid);
  }
};

process.on('message', async (msg) => {
  if (msg.type !== 'judge') return;
  try {
    await judgeCode(msg.sid, msg.isreJudge);
    process.send({ type: 'done', sid: msg.sid });
  } catch (err) {
    process.send({ type: 'error', sid: msg.sid, error: err && err.message });
  }
});
