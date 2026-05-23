// Unified judge worker: one file, all languages.
//
// Forked from judge.js per submission. The pipeline is:
//   1. Resolve language config (judgeLanguages.js)
//   2. Compile user code in sandbox; surface CE on non-zero exit
//   3. If problem.type === 1 (special judge), ensure SPJ binary is compiled
//      and cached (spjCache.js) — no recompile per case, no recompile per
//      submission as long as data/<pid>/checker.cpp is unchanged
//   4. Run each case, comparing via comparer or SPJ depending on problem.type
//   5. Aggregate per-subtask scores honoring `option`/`skip`/`dependencies`
//   6. Persist final result + per-case detail
//
// Everything language-specific lives in judgeLanguages.js — the rest is
// language-agnostic.

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const conf = require('../config.json');
const { getFile, setFile, delFile } = require('../file');
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
} = require('./judge');
const { updateProblemStat } = require('./problem');
const {
  resetJudgeLog,
  appendJudgeLog,
  truncateText,
  summarizeSandboxResult,
  summarizeAxiosError,
} = require('./judgeLog');
const { getLanguage, COMPILE_LIMITS, stdFiles } = require('./judgeLanguages');
const spjCache = require('./spjCache');

const SANDBOX = 'http://localhost:5050';
const SPJ_CPU_NS = 5_000_000_000;            // 5 s
const SPJ_MEM = 512 * 1024 * 1024;           // 512 MB

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

// `comparer` writes scratch files under ./comparer/tmp/. Tag with submission +
// counter so concurrent workers don't collide on the same path.
let jid = 1;

const logEvent = async (sid, event, data) => {
  await appendJudgeLog(sid, event, data);
  notifySubmissionProgress(sid);
};

const runSandbox = (cmd) =>
  axios.post(`${SANDBOX}/run`, { cmd: [cmd] }).then((r) => r.data[0]);

// Resolve submission.lang → judgeLanguages config.
const resolveLanguage = async (langId) => {
  const row = await db.one('SELECT name FROM languages WHERE id=?', [langId]);
  if (!row) throw new Error(`unknown language id ${langId}`);
  const cfg = getLanguage(row.name);
  if (!cfg) throw new Error(`language "${row.name}" has no judge config`);
  return { name: row.name, ...cfg };
};

// ---- compile (user code) ----
const compileUser = async (sid, code, lang) => {
  await logEvent(sid, 'compile.start', { args: lang.compileArgs });
  try {
    const result = await runSandbox({
      args: lang.compileArgs,
      env: ['PATH=/usr/bin:/bin'],
      files: stdFiles(),
      ...COMPILE_LIMITS,
      copyIn: { [lang.sourceFile]: { content: code } },
      copyOut: ['stdout', 'stderr'],
      copyOutCached: [lang.binary],
      copyOutDir: `nywOJ_code_${sid}`,
    });
    await logEvent(sid, 'compile.result', summarizeSandboxResult(result));
    return result;
  } catch (err) {
    await logEvent(sid, 'compile.error', summarizeAxiosError(err));
    throw err;
  }
};

// ---- compile (SPJ) ----
const compileSPJ = async (sid, source) => {
  const testlib = await getFile('./comparer/testlib.h');
  const args = ['/usr/bin/g++-9', '-O2', '-std=c++14', '-DONLINE_JUDGE', 'spj.cpp', '-o', 'spj'];
  await logEvent(sid, 'spj.compile.start', { args });
  try {
    const result = await runSandbox({
      args,
      env: ['PATH=/usr/bin:/bin'],
      files: stdFiles(),
      ...COMPILE_LIMITS,
      copyIn: {
        'spj.cpp': { content: source },
        'testlib.h': { content: testlib },
      },
      copyOut: ['stdout', 'stderr'],
      copyOutCached: ['spj'],
      copyOutDir: `nywOJ_spj_${sid}`,
    });
    await logEvent(sid, 'spj.compile.result', summarizeSandboxResult(result));
    return result;
  } catch (err) {
    await logEvent(sid, 'spj.compile.error', summarizeAxiosError(err));
    throw err;
  }
};

// Returns { fileId } on success, { error } if checker.cpp is missing or
// doesn't compile. Reuses a previously cached fileId when the source hash
// matches — no recompile in that case.
const ensureSPJ = async (sid, pid) => {
  const source = await getFile(`data/${pid}/checker.cpp`);
  if (!source) return { error: 'No checker.cpp found, please contact the problem publisher.' };

  const cached = spjCache.get(pid, source);
  if (cached) {
    await logEvent(sid, 'spj.compile.cache', { pid, fileId: cached });
    return { fileId: cached, fromCache: true };
  }
  const result = await compileSPJ(sid, source);
  if (result.exitStatus !== 0) {
    return { error: 'SPJ Error\n' + ((result.files && result.files.stderr) || '') };
  }
  const fileId = result.fileIds.spj;
  spjCache.set(pid, source, fileId);
  return { fileId };
};

// ---- run (one case) ----
const runCase = (lang, fileId, inputFile, timeLimitMs, memoryLimitMB) =>
  runSandbox({
    args: lang.runArgs,
    env: ['PATH=/usr/bin:/bin'],
    files: stdFiles({ content: inputFile }),
    cpuLimit: timeLimitMs * 1_000_000,        // ms → ns
    clockLimit: timeLimitMs * 2_000_000,
    memoryLimit: memoryLimitMB * 1024 * 1024, // MB → B
    stackLimit: memoryLimitMB * 1024 * 1024,
    procLimit: 50,
    strictMemoryLimit: true,
    copyIn: { [lang.binary]: { fileId } },
  });

const runSPJ = (fileId, inputFile, usrOutput, outputFile) =>
  runSandbox({
    args: ['spj', 'data.in', 'usr.out', 'data.out'],
    env: ['PATH=/usr/bin:/bin'],
    files: stdFiles(),
    cpuLimit: SPJ_CPU_NS,
    clockLimit: SPJ_CPU_NS * 2,
    memoryLimit: SPJ_MEM,
    stackLimit: SPJ_MEM,
    procLimit: 50,
    strictMemoryLimit: true,
    copyIn: {
      spj: { fileId },
      'data.in': { content: inputFile },
      'usr.out': { content: usrOutput },
      'data.out': { content: outputFile },
    },
  });

// Runs the SPJ for one case, tolerating a stale cached binary. If the cached
// fileId was evicted by the sandbox (go-judge restart, etc.), runSPJ throws —
// in that case we drop the cache, recompile the checker once, and retry instead
// of failing the whole submission with a System Error. `spjState` is mutated in
// place ({ fileId, fromCache }) so subsequent cases reuse the recompiled binary.
// A failure on a freshly compiled binary is a genuine SPJ runtime error and is
// propagated unchanged.
const runSPJCase = async (sid, pid, spjState, inputFile, usrOutput, outputFile) => {
  try {
    const spjRun = await runSPJ(spjState.fileId, inputFile, usrOutput, outputFile);
    return (spjRun.files && spjRun.files.stderr) || '';
  } catch (err) {
    if (!spjState.fromCache) throw err; // already fresh — recompiling won't help
    await logEvent(sid, 'spj.run.staleCache', { pid, error: summarizeAxiosError(err) });
    spjCache.invalidate(pid);
    const spj = await ensureSPJ(sid, pid); // cache cleared → forces a recompile
    if (spj.error) throw new Error(spj.error);
    spjState.fileId = spj.fileId;
    spjState.fromCache = false;
    const spjRun = await runSPJ(spjState.fileId, inputFile, usrOutput, outputFile);
    return (spjRun.files && spjRun.files.stderr) || '';
  }
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
const aggregate = (subtasks, judgeResult) => {
  const info = {};
  for (const s of subtasks) {
    info[s.index] = {
      subtaskStatus: [],
      time: 0,
      memory: 0,
      res: 12,
      score: 0,
      fullScore: s.score,
      option: s.option,
      dependencies: s.dependencies || null,
    };
  }
  for (const r of judgeResult) info[r.subtaskId].subtaskStatus.push(r);

  for (const i of Object.keys(info)) {
    const sub = info[i];
    let acNum = 0, totalNum = 0;
    for (const cr of sub.subtaskStatus) {
      totalNum++;
      sub.time += cr.time;
      sub.memory = Math.max(sub.memory, cr.memory);
      if (cr.judgeResult === 4) acNum++;
      else sub.res = Math.min(sub.res, cr.judgeResult);
    }
    if (totalNum > 0 && !sub.option) {
      sub.score = Math.ceil((sub.fullScore * acNum) / totalNum);
    }
    if (totalNum > 0 && acNum === totalNum) {
      sub.res = 4;
      sub.score = sub.fullScore;
    }
    if (sub.dependencies) {
      for (const id of sub.dependencies) {
        if (info[id] && info[id].res !== 4) {
          sub.res = info[id].res;
          sub.score = 0;
          break;
        }
      }
    }
  }

  let finalRes = 12, totalTime = 0, maxMemory = 0, totalScore = 0;
  let acSub = 0, totalSub = 0;
  const subtaskList = [];
  for (const i of Object.keys(info)) {
    const sub = info[i];
    totalSub++;
    totalTime += sub.time;
    maxMemory = Math.max(maxMemory, sub.memory);
    totalScore += sub.score;
    subtaskList.push({
      index: i,
      time: sub.time, memory: sub.memory,
      res: sub.res, score: sub.score, fullScore: sub.fullScore,
      option: sub.option,
      dependencies: sub.dependencies || [],
    });
    if (sub.res === 4) acSub++;
    else finalRes = Math.min(finalRes, sub.res);
  }
  if (totalSub > 0 && acSub === totalSub) {
    finalRes = 4;
    totalScore = 100;
  }
  return { finalRes, totalTime, maxMemory, totalScore, acSub, totalSub, subtaskList };
};

// ---- answer-submission judge ----
// problem.type ∈ {2,3}: no code, no sandbox run. The submission stored each
// user-supplied answer to `./answerSubmissions/{sid}/{case.name}.out`. We
// compare those against the expected outputs case by case, then aggregate
// the same way as code submissions so the result UI is identical.
const judgeAnswer = async (sid, sinfo, pinfo, isRejudge) => {
  const pid = pinfo.pid;
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
      mode: pinfo.type === 3 ? 'answer-spj' : 'answer',
    });
    await clearCase(sid);

    if (!conf.JUDGE.ISSERVER) await updateData(pid);

    // SPJ binary (cached) — only when type=3
    const spjState = { fileId: '', fromCache: false };
    if (pinfo.type === 3) {
      const spj = await ensureSPJ(sid, pid);
      if (spj.error) {
        await db.query('UPDATE submission SET judgeResult=12,compileResult=? WHERE sid=?', [spj.error, sid]);
        await updateProblemSubmitInfo(pid);
        await updateProblemStat(pid);
        return;
      }
      spjState.fileId = spj.fileId;
      spjState.fromCache = !!spj.fromCache;
    }

    const config = JSON.parse(await getFile(`./data/${pid}/config.json`));
    if (!config || !config.cases) throw new Error('CASE ERROR: config.cases is null or undefined');
    const cases = config.cases;
    const subtasks = config.subtask;

    const judgeResult = [];
    const answerDir = path.join(__dirname, '..', 'answerSubmissions', String(sid));

    for (const c of cases) {
      const caseName = c.input ? c.input.replace(/\.in$/, '') : String(c.index);
      const userAnswerPath = path.join(answerDir, `${caseName}.out`);
      const usrOutput = fs.existsSync(userAnswerPath)
        ? fs.readFileSync(userAnswerPath, 'utf-8')
        : '';
      const inputFile = await getFile(`./data/${pid}/${c.input}`);
      const outputFile = await getFile(`./data/${pid}/${c.output}`);

      await logEvent(sid, 'case.start', {
        caseId: c.index,
        subtaskId: c.subtaskId,
        input: truncateText(inputFile, 1024),
      });

      let compareRes = '';
      try {
        if (pinfo.type === 2) {
          compareRes = await compareDefault(sid, usrOutput, outputFile);
        } else {
          compareRes = await runSPJCase(sid, pid, spjState, inputFile, usrOutput, outputFile);
        }
      } catch (err) {
        await logEvent(sid, 'case.error', { caseId: c.index, error: summarizeAxiosError(err) });
        // A stale SPJ cache is already retried inside runSPJCase; reaching here
        // means a genuine failure — propagate so the outer catch records a
        // System Error.
        throw err;
      }

      const ok = compareRes.substring(0, 2) === 'ok';
      await logEvent(sid, 'case.compare', {
        caseId: c.index,
        result: ok ? 'ok' : 'wa',
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
        t, mem, ok ? 4 : 5, compareRes, c.subtaskId,
      );
      judgeResult.push({ time: t, memory: mem, subtaskId: c.subtaskId, judgeResult: ok ? 4 : 5 });
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
      message: err && err.message ? err.message : String(err),
      stack: truncateText(err && err.stack ? err.stack : ''),
    });
    await setSubmission(sid, 12, 0, 0, 0, String(err), null, conf.JUDGE.NAME);
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

  if (pinfo.type === 2 || pinfo.type === 3) {
    return judgeAnswer(sid, sinfo, pinfo, isRejudge);
  }

  try {
    const lang = await resolveLanguage(sinfo.lang);
    const { code } = sinfo;
    const { timeLimit, memoryLimit } = pinfo;

    await setSubmission(sid, 1, 0, 0, 0, null, null, conf.JUDGE.NAME);
    await resetJudgeLog(sid, {
      sid, pid,
      lang: sinfo.lang,
      langName: lang.name,
      isRejudge: !!isRejudge,
      worker: conf.JUDGE.NAME,
      timeLimit,
      memoryLimit,
    });
    await clearCase(sid);

    // 1) compile user code
    const compileResult = await compileUser(sid, code, lang);
    if (compileResult.exitStatus !== 0) {
      const stderr = (compileResult.files && compileResult.files.stderr) || '';
      const stdout = (compileResult.files && compileResult.files.stdout) || '';
      const error =
        `Compilation Error, Time: ${Math.floor(compileResult.time / 1e6)} ms, ` +
        `Memory: ${Math.floor(compileResult.memory / 1024)} KB\n` +
        stderr + (stdout ? '\n' + stdout : '');
      await db.query('UPDATE submission SET judgeResult=3,compileResult=? WHERE sid=?', [error, sid]);
      await updateProblemSubmitInfo(pid);
      await updateProblemStat(pid);
      return;
    }

    if (!conf.JUDGE.ISSERVER) await updateData(pid);

    const userFileId = compileResult.fileIds[lang.binary];

    // 2) ensure SPJ (cached)
    const spjState = { fileId: '', fromCache: false };
    if (pinfo.type === 1) {
      const spj = await ensureSPJ(sid, pid);
      if (spj.error) {
        await db.query('UPDATE submission SET judgeResult=12,compileResult=? WHERE sid=?', [spj.error, sid]);
        await updateProblemSubmitInfo(pid);
        await updateProblemStat(pid);
        return;
      }
      spjState.fileId = spj.fileId;
      spjState.fromCache = !!spj.fromCache;
    }

    // 3) run cases
    const config = JSON.parse(await getFile(`./data/${pid}/config.json`));
    if (!config || !config.cases) throw new Error('CASE ERROR: config.cases is null or undefined');
    const cases = config.cases;
    const subtasks = config.subtask;

    // Skip flag per subtask: starts at 1 if subtask.skip is truthy; flips to 2
    // (== "skip remaining cases of this subtask") on first TLE hit.
    const skipFlag = {};
    for (const s of subtasks) if (s.skip) skipFlag[s.index] = 1;

    const judgeResult = [];

    for (const c of cases) {
      if (skipFlag[c.subtaskId] === 2) {
        await updateSubmissionDetail(sid, c.index, '', '', 0, 0, 14, '', c.subtaskId);
        judgeResult.push({ time: 0, memory: 0, subtaskId: c.subtaskId, judgeResult: 14 });
        continue;
      }

      const inputFile = await getFile(`./data/${pid}/${c.input}`);
      const outputFile = await getFile(`./data/${pid}/${c.output}`);
      await logEvent(sid, 'case.start', {
        caseId: c.index,
        subtaskId: c.subtaskId,
        input: truncateText(inputFile, 1024),
      });

      let runResult;
      try {
        runResult = await runCase(lang, userFileId, inputFile, timeLimit, memoryLimit);
        await logEvent(sid, 'case.run', {
          caseId: c.index,
          status: runResult.status,
          time: runResult.time,
          memory: runResult.memory,
          exitStatus: runResult.exitStatus,
          files: summarizeSandboxResult({ files: runResult.files }).files,
        });
      } catch (err) {
        await logEvent(sid, 'case.error', { caseId: c.index, error: summarizeAxiosError(err) });
        throw err;
      }

      const t = Math.max(1, Math.floor(runResult.time / 1e6));
      const mem = Math.max(1, Math.floor(runResult.memory / 1024));

      if (runResult.status !== 'Accepted') {
        const runStderr = (runResult.files && runResult.files.stderr) || '';
        await updateSubmissionDetail(
          sid, c.index,
          inputFile.substring(0, 255) + (inputFile.length > 255 ? '......\n' : ''),
          runStderr,
          t, mem, RES[runResult.status], '', c.subtaskId,
        );
        judgeResult.push({ time: t, memory: mem, subtaskId: c.subtaskId, judgeResult: RES[runResult.status] });
        if (runResult.status === 'Time Limit Exceeded' && skipFlag[c.subtaskId] === 1) {
          skipFlag[c.subtaskId] = 2;
        }
        continue;
      }

      const usrOutput = (runResult.files && runResult.files.stdout) || '';
      let compareRes = '';
      if (pinfo.type === 0) {
        compareRes = await compareDefault(sid, usrOutput, outputFile);
      } else if (pinfo.type === 1) {
        // Stale cached SPJ binaries are recompiled-and-retried inside runSPJCase;
        // only a genuine SPJ runtime failure propagates here.
        compareRes = await runSPJCase(sid, pid, spjState, inputFile, usrOutput, outputFile);
      }

      const ok = compareRes.substring(0, 2) === 'ok';
      await logEvent(sid, 'case.compare', {
        caseId: c.index,
        result: ok ? 'ok' : 'wa',
        detail: truncateText(compareRes, 4096),
      });
      await updateSubmissionDetail(
        sid, c.index,
        inputFile.substring(0, 255) + (inputFile.length > 255 ? '......\n' : ''),
        usrOutput.substring(0, 255) + (usrOutput.length > 255 ? '......\n' : ''),
        t, mem, ok ? 4 : 5, compareRes, c.subtaskId,
      );
      judgeResult.push({ time: t, memory: mem, subtaskId: c.subtaskId, judgeResult: ok ? 4 : 5 });
    }

    // 4) aggregate
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
      message: err && err.message ? err.message : String(err),
      stack: truncateText(err && err.stack ? err.stack : ''),
    });
    await setSubmission(sid, 12, 0, 0, 0, String(err), null, conf.JUDGE.NAME);
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
