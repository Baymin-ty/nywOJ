// Custom run ("自测"): compile + run the user's code once against their own
// stdin, WITHOUT creating a submission, touching problem stats, or entering the
// real judge queue. Deliberately self-contained — it talks to the sandbox directly
// and never imports the judge worker, so the judging hot path stays untouched.
//
// Reused, side-effect-free helpers only:
//   - languages.js     : language registry + sandbox limits/stdio shapes
//   - problem/core.js  : problemAuth (view check), getProblemLang (lang mask)
//   - db/format.js      : isAnswerType (answer-only problems have no code)

const async = require('async');
const db = require('../../db');
const { handler, fail, ok } = require('../../db/util');
const { getLanguage, stdioFiles, COMPILE_LIMITS, DEFAULT_ENV } = require('./languages');
const { problemAuth, getProblemLang } = require('../problem/core');
const { isAnswerType } = require('../../db/format');
const sandboxClient = require('./sandbox');

const MAX_CODE = 100 * 1024;     // 100KB — matches judge.submit
const MAX_INPUT = 64 * 1024;     // 64KB stdin cap
const MAX_OUTPUT = 64 * 1024;    // 64KB returned per stream (stdout/stderr)
const HARD_TIME_MS = 10000;      // cap mirrors problem time-limit ceiling
const HARD_MEM_MB = 512;

const runSandbox = (cmd) => sandboxClient.runOne(cmd);

const deleteSandboxFile = (cachedFile) => sandboxClient.deleteFile(cachedFile);

// Compile (or, for Python3, syntax-check). Mirrors the judge worker compile step but
// without sid/logging/DB. Returns the raw sandbox result.
const compile = (code, lang) =>
  runSandbox({
    command: lang.compileArgs,
    env: lang.compileEnv || DEFAULT_ENV,
    stdio: stdioFiles(),
    ...COMPILE_LIMITS,
    inputFiles: { [lang.sourceFile]: { content: code } },
    outputFiles: ['stdout', 'stderr'],
    cachedOutputs: [lang.binary],
  });

// Run the compiled artifact once with the supplied stdin. Mirrors
// judgeWorker.runCase. timeMs/memMB come from the problem (already capped).
const runOnce = (lang, cachedFile, input, timeMs, memMB) =>
  runSandbox({
    command: lang.runArgs,
    env: lang.runEnv || DEFAULT_ENV,
    stdio: stdioFiles({ content: input }),
    limits: { cpuMs: timeMs, wallMs: timeMs * 2, memoryMB: memMB, stackMB: memMB, processes: 50 },
    inputFiles: { [lang.binary]: { cachedFile } },
  });

const clip = (s) => {
  const str = String(s || '');
  return str.length > MAX_OUTPUT
    ? { text: str.slice(0, MAX_OUTPUT), truncated: true }
    : { text: str, truncated: false };
};

// One compile+run unit of work. Throws on sandbox/network failure (caught by
// the handler and surfaced as "评测机不可用").
const doRun = async ({ lang, code, input, timeMs, memMB }) => {
  const compileResult = await compile(code, lang);
  if (compileResult.exitCode !== 0) {
    const files = compileResult.outputFiles || {};
    return { ce: true, compileOutput: (files.stderr || '') + (files.stdout ? '\n' + files.stdout : '') };
  }
  const cachedFile = compileResult.cachedFiles && compileResult.cachedFiles[lang.binary];
  try {
    const r = await runOnce(lang, cachedFile, input, timeMs, memMB);
    const files = r.outputFiles || {};
    const out = clip(files.stdout);
    const err = clip(files.stderr);
    return {
      ce: false,
      status: r.status,
      time: r.cpuTimeMs || 0,
      memory: r.memoryKb || 0,
      exitCode: r.exitCode,
      stdout: out.text,
      stderr: err.text,
      outputTruncated: out.truncated || err.truncated,
    };
  } finally {
    if (cachedFile) deleteSandboxFile(cachedFile);
  }
};

// Bound total sandbox pressure from custom runs and keep them isolated from the
// real judge queue so submissions always take priority.
const customRunQueue = async.queue((task, cb) => {
  doRun(task.payload).then(
    (result) => { task.resolve(result); cb(); },
    (err) => { task.reject(err); cb(); },
  );
}, 2);

const enqueue = (payload) =>
  new Promise((resolve, reject) => customRunQueue.push({ payload, resolve, reject }));

// One in-flight custom run per user — cheap anti-spam on top of the queue.
const inFlight = new Set();

exports.customRun = handler(async (req, res) => {
  const { code, pid, lang, input } = req.body;
  const langId = parseInt(lang, 10);
  const uid = req.session.uid;

  if (!pid) return fail(res, '请确认信息完善');
  const auth = await problemAuth(req, pid);
  if (!auth.view) return fail(res, '权限不足');

  const pinfo = await db.one('SELECT type,timeLimit,memoryLimit FROM problem WHERE pid=?', [pid]);
  if (!pinfo) return fail(res, '题目不存在');
  if (isAnswerType(pinfo.type)) return fail(res, '提交答案题不支持自测');

  if (typeof code !== 'string' || code.length < 1) return fail(res, '请先写代码');
  if (code.length > MAX_CODE) return fail(res, '选手提交的程序源文件必须不大于 100KB。');
  const stdin = input == null ? '' : String(input);
  if (Buffer.byteLength(stdin, 'utf-8') > MAX_INPUT) return fail(res, '自定义输入不能超过 64KB');

  if (!Number.isSafeInteger(langId) || langId <= 0) return fail(res, '非法语言');
  const langRow = await db.one('SELECT name FROM languages WHERE id=?', [langId]);
  if (!langRow || !getLanguage(langRow.name)) return fail(res, '非法语言');
  const alang = await getProblemLang(pid);
  if (!((1 << langId) & alang)) return fail(res, '非法语言');

  const timeMs = Math.min(pinfo.timeLimit || HARD_TIME_MS, HARD_TIME_MS);
  const memMB = Math.min(pinfo.memoryLimit || HARD_MEM_MB, HARD_MEM_MB);

  if (inFlight.has(uid)) return fail(res, '上一次运行还在进行，请稍候');
  inFlight.add(uid);
  try {
    const result = await enqueue({
      lang: { name: langRow.name, ...getLanguage(langRow.name) },
      code,
      input: stdin,
      timeMs,
      memMB,
    });
    return ok(res, { data: result });
  } catch (err) {
    console.error('customRun err:', err && err.message ? err.message : err);
    return fail(res, '评测机不可用');
  } finally {
    inFlight.delete(uid);
  }
});
