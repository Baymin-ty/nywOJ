const fs = require('fs');
const path = require('path');
const async = require('async');
const db = require('../../db');
const { handler, fail, ok, paginate } = require('../../db/util');
const { Format } = require('../../static');
const { getFile } = require('../../file');
const sandboxClient = require('../judge/sandbox');
const { getLanguage, stdioFiles, COMPILE_LIMITS, DEFAULT_ENV } = require('../judge/languages');
const { summarizeProfileFlow } = require('../problem/judgeProfile');
const { getIdxByPid } = require('./store');
const { loadView } = require('./policy');
const { invalidateStandings } = require('./standings');

// ============================================================================
// CF hack（简化无房间制）：
//   资格 = 比赛进行中 + 自己该题已过 pretest；可查看其他已过 pretest 提交的代码
//   并提交一组输入数据。判定链：validator 校验输入合法 → std 生成期望输出 →
//   目标提交运行 → checker/文本比对。目标挂 = hack 成功：目标该题自 hack 时刻
//   视为失败（榜单层生效，见 standings.reduceCf），数据自动进入终测
//   （worker.selectJudgeCases 追加 data/hacks/<cid>/<hackId>.in/.ans）。
//
// 约定资产（data/<pid>/assets/）：std.cpp（标程）、validator.cpp（testlib 校验器，
// stdin 读入，exit 0 合法）。checker 沿用题目已有 checker.cpp，否则默认按行比对。
// ============================================================================

const MAX_HACK_INPUT = 256 * 1024; // 256KB
const AC = 4;
const HACK_TIME_FACTOR = 2; // std/validator 放宽的时限倍数

const SERVER_ROOT = path.join(__dirname, '..', '..');
const hacksDir = (cid) => path.join(SERVER_ROOT, 'data', 'hacks', String(cid));
const assetPath = (pid, name) =>
  name === 'checker.cpp' ? `./data/${pid}/checker.cpp` : `./data/${pid}/assets/${name}`;

const runSandbox = (cmd) => sandboxClient.runOne(cmd);

const compileCpp = async (sourceName, source, withTestlib) => {
  const inputFiles = { [sourceName]: { content: source } };
  if (withTestlib) {
    const testlib = await getFile('./comparer/testlib.h');
    inputFiles['testlib.h'] = { content: testlib || '' };
  }
  const bin = sourceName.replace(/\.cpp$/, '');
  const r = await runSandbox({
    command: ['/usr/bin/g++-9', '-O2', '-std=c++14', '-DONLINE_JUDGE', sourceName, '-o', bin],
    env: ['PATH=/usr/bin:/bin'],
    stdio: stdioFiles(),
    ...COMPILE_LIMITS,
    inputFiles,
    outputFiles: ['stdout', 'stderr'],
    cachedOutputs: [bin],
  });
  if (r.exitCode !== 0) {
    const err = (r.outputFiles && r.outputFiles.stderr) || 'compile failed';
    return { error: `${sourceName} 编译失败：${err.slice(0, 2000)}` };
  }
  return { fileId: r.cachedFiles && r.cachedFiles[bin], bin };
};

const runBinary = (bin, fileId, input, timeMs, memMB, args = null) =>
  runSandbox({
    command: args || [bin],
    env: ['PATH=/usr/bin:/bin'],
    stdio: stdioFiles({ content: input }),
    limits: { cpuMs: timeMs, wallMs: timeMs * 2, memoryMB: memMB, stackMB: memMB, processes: 50 },
    inputFiles: { [bin]: { cachedFile: fileId } },
    outputFiles: ['stdout', 'stderr'],
  });

const releaseFile = (fileId) => { if (fileId) sandboxClient.deleteFile(fileId); };

// 默认比对：忽略每行行尾空白与末尾空行（对齐默认 comparer 语义）
const textEquals = (a, b) => {
  const norm = (s) => String(s || '').split('\n').map((l) => l.replace(/[ \t\r]+$/, ''));
  const la = norm(a), lb = norm(b);
  while (la.length && la[la.length - 1] === '') la.pop();
  while (lb.length && lb[lb.length - 1] === '') lb.pop();
  if (la.length !== lb.length) return false;
  for (let i = 0; i < la.length; i++) if (la[i] !== lb[i]) return false;
  return true;
};

// 该题是否支持 hack：单文件代码提交、无交互/通信管道
const hackSupport = async (pid) => {
  const p = await db.one('SELECT pid,type,judgeProfile,timeLimit,memoryLimit FROM problem WHERE pid=?', [pid]);
  if (!p) return { supported: false, reason: '无此题目' };
  const flow = summarizeProfileFlow(p.judgeProfile);
  if (flow && (flow.pipeGroupCount > 0 || flow.interactive)) {
    return { supported: false, reason: '交互/通信题暂不支持 hack' };
  }
  if (flow && flow.submitMode && flow.submitMode !== 'code') {
    return { supported: false, reason: '非代码提交题不支持 hack' };
  }
  return { supported: true, problem: p };
};

// ---- 判定 ----

const judgeHack = async (hackId) => {
  const hack = await db.one('SELECT * FROM contestHack WHERE hackId=?', [hackId]);
  if (!hack || hack.status !== 'pending') return;
  await db.query("UPDATE contestHack SET status='judging' WHERE hackId=?", [hackId]);

  const finish = async (status, verdict) => {
    await db.query(
      'UPDATE contestHack SET status=?,verdict=?,judgedTime=? WHERE hackId=?',
      [status, String(verdict || '').slice(0, 4000), new Date(), hackId]
    );
    invalidateStandings(hack.cid);
  };

  const cached = [];
  try {
    const support = await hackSupport(hack.pid);
    if (!support.supported) return finish('invalid', support.reason);
    const problem = support.problem;
    const timeMs = Math.min(Number(problem.timeLimit) || 1000, 10000);
    const memMB = Math.min(Number(problem.memoryLimit) || 256, 1024);

    const input = fs.readFileSync(path.join(hacksDir(hack.cid), `${hackId}.in`), 'utf8');

    // 1) validator 校验输入
    const validatorSrc = await getFile(assetPath(hack.pid, 'validator.cpp'));
    if (!validatorSrc) return finish('invalid', '题目缺少 validator.cpp 资产，无法校验 hack 输入');
    const val = await compileCpp('validator.cpp', validatorSrc, true);
    if (val.error) return finish('invalid', val.error);
    cached.push(val.fileId);
    const vr = await runBinary(val.bin, val.fileId, input, timeMs * HACK_TIME_FACTOR, memMB);
    if (vr.status !== 'Accepted' || vr.exitCode !== 0) {
      const msg = (vr.outputFiles && vr.outputFiles.stderr) || vr.status;
      return finish('invalid', `输入不合法：${String(msg).slice(0, 1000)}`);
    }

    // 2) std 生成期望输出
    const stdSrc = await getFile(assetPath(hack.pid, 'std.cpp'));
    if (!stdSrc) return finish('invalid', '题目缺少 std.cpp 资产，无法生成期望输出');
    const std = await compileCpp('std.cpp', stdSrc, false);
    if (std.error) return finish('invalid', std.error);
    cached.push(std.fileId);
    const sr = await runBinary(std.bin, std.fileId, input, timeMs * HACK_TIME_FACTOR, memMB * 2);
    if (sr.status !== 'Accepted') {
      return finish('invalid', `std 运行失败（${sr.status}），请联系出题人`);
    }
    const expected = (sr.outputFiles && sr.outputFiles.stdout) || '';

    // 3) 目标提交运行
    const target = await db.one('SELECT sid,code,lang FROM submission WHERE sid=?', [hack.targetSid]);
    if (!target) return finish('invalid', '目标提交不存在');
    const langRow = await db.one('SELECT name FROM languages WHERE id=?', [target.lang]);
    const lang = langRow ? getLanguage(langRow.name) : null;
    if (!lang) return finish('invalid', '目标提交语言不支持 hack');
    const tc = await runSandbox({
      command: lang.compileArgs,
      env: lang.compileEnv || DEFAULT_ENV,
      stdio: stdioFiles(),
      ...COMPILE_LIMITS,
      inputFiles: { [lang.sourceFile]: { content: target.code } },
      outputFiles: ['stdout', 'stderr'],
      cachedOutputs: [lang.binary],
    });
    if (tc.exitCode !== 0) return finish('success', '目标编译失败（异常状态，按成功处理）');
    const targetBin = tc.cachedFiles && tc.cachedFiles[lang.binary];
    cached.push(targetBin);
    const tr = await runSandbox({
      command: lang.runArgs,
      env: lang.runEnv || DEFAULT_ENV,
      stdio: stdioFiles({ content: input }),
      limits: { cpuMs: timeMs, wallMs: timeMs * 2, memoryMB: memMB, stackMB: memMB, processes: 50 },
      inputFiles: { [lang.binary]: { cachedFile: targetBin } },
      outputFiles: ['stdout', 'stderr'],
    });
    if (tr.status !== 'Accepted') {
      await persistAnswer(hack, expected);
      return finish('success', `目标 ${tr.status}`);
    }
    const targetOut = (tr.outputFiles && tr.outputFiles.stdout) || '';

    // 4) 比对：题目自带 checker 优先，否则默认文本比对
    const checkerSrc = await getFile(assetPath(hack.pid, 'checker.cpp'));
    if (checkerSrc) {
      const chk = await compileCpp('checker.cpp', checkerSrc, true);
      if (chk.error) return finish('invalid', chk.error);
      cached.push(chk.fileId);
      const cr = await runSandbox({
        command: ['checker', 'data.in', 'usr.out', 'data.out'],
        env: ['PATH=/usr/bin:/bin'],
        stdio: stdioFiles(),
        limits: { cpuMs: 10000, wallMs: 20000, memoryMB: 512, stackMB: 512, processes: 50 },
        inputFiles: {
          checker: { cachedFile: chk.fileId },
          'data.in': { content: input },
          'usr.out': { content: targetOut },
          'data.out': { content: expected },
        },
        outputFiles: ['stdout', 'stderr'],
      });
      const checkerMsg = ((cr.outputFiles && cr.outputFiles.stderr) || '').slice(0, 1000);
      if (cr.exitCode === 0) return finish('fail', `目标输出正确：${checkerMsg}`);
      await persistAnswer(hack, expected);
      return finish('success', `目标 Wrong Answer：${checkerMsg}`);
    }
    if (textEquals(targetOut, expected)) return finish('fail', '目标输出正确');
    await persistAnswer(hack, expected);
    return finish('success', '目标 Wrong Answer');
  } catch (err) {
    console.error('hack judge failed:', err && err.stack ? err.stack : err);
    await finish('invalid', `判定失败：${err && err.message ? err.message : err}`);
  } finally {
    for (const f of cached) releaseFile(f);
  }
};

// 成功 hack 的期望输出落盘（终测追加用）
const persistAnswer = async (hack, expected) => {
  fs.writeFileSync(path.join(hacksDir(hack.cid), `${hack.hackId}.ans`), expected);
};

// 判定队列：与评测队列隔离，避免占用真实评测
const hackQueue = async.queue((hackId, cb) => {
  judgeHack(hackId).then(() => cb(), (err) => { console.error(err); cb(); });
}, 1);

// 服务重启后残留的 pending/judging 重新入队
const requeuePending = async () => {
  try {
    const rows = await db.query(
      "SELECT hackId FROM contestHack WHERE status IN ('pending','judging') ORDER BY hackId"
    );
    for (const r of rows) {
      await db.query("UPDATE contestHack SET status='pending' WHERE hackId=?", [r.hackId]);
      hackQueue.push(r.hackId);
    }
  } catch (_) { /* 表还未建时忽略 */ }
};
setTimeout(requeuePending, 5000).unref();

// ---- 资格 ----

// 我在该场比赛当前 AC（pretest passed）的题 pid 集合
const myPassedPids = async (cid, uid) =>
  new Set(await db.column(
    'SELECT DISTINCT pid FROM submission WHERE cid=? AND uid=? AND judgeResult=?',
    [cid, uid, AC], 'pid'
  ));

// ---- 端点 ----

// 可 hack 的目标：我已过的题上，其他人的 AC 提交（排除已被成功 hack 的）
exports.getHackTargets = handler(async (req, res) => {
  const { cid } = req.body;
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canHack && !v.caps.manage) return res.status(403).end('403 Forbidden');

  const uid = req.session.uid;
  const passed = v.caps.manage
    ? new Set(await db.column('SELECT pid FROM contestProblem WHERE cid=?', [cid], 'pid'))
    : await myPassedPids(cid, uid);
  if (!passed.size) return ok(res, { data: [], lockedIdx: [] });

  const rows = await db.query(
    `SELECT s.sid,s.uid,s.pid,s.submitTime,s.lang,u.name
       FROM submission s INNER JOIN userInfo u ON u.uid=s.uid
      WHERE s.cid=? AND s.judgeResult=? AND s.uid<>? AND s.pid IN (?)
        AND s.virtualId IS NULL
        AND NOT EXISTS (SELECT 1 FROM contestHack h WHERE h.targetSid=s.sid AND h.status='success')
      ORDER BY s.sid DESC`,
    [cid, AC, uid, [...passed]]
  );
  const lockedIdx = [];
  for (const pid of passed) {
    const idx = await getIdxByPid(cid, pid);
    if (idx) lockedIdx.push(idx);
  }
  const data = [];
  for (const r of rows) {
    const support = await hackSupport(r.pid);
    if (!support.supported) continue;
    data.push({
      sid: r.sid,
      uid: r.uid,
      name: r.name,
      lang: r.lang,
      idx: await getIdxByPid(cid, r.pid),
      submitTime: Format(r.submitTime),
    });
  }
  lockedIdx.sort((a, b) => a - b);
  return ok(res, { data, lockedIdx });
});

// 查看目标代码（hack 资格内）
exports.getHackTargetCode = handler(async (req, res) => {
  const { cid, sid } = req.body;
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canHack && !v.caps.manage) return res.status(403).end('403 Forbidden');

  const target = await db.one(
    'SELECT s.sid,s.uid,s.pid,s.cid,s.code,s.lang,s.judgeResult,u.name FROM submission s INNER JOIN userInfo u ON u.uid=s.uid WHERE s.sid=?',
    [sid]
  );
  if (!target || Number(target.cid) !== Number(cid) || target.judgeResult !== AC) {
    return fail(res, '目标不可 hack');
  }
  if (!v.caps.manage) {
    const passed = await myPassedPids(cid, req.session.uid);
    if (!passed.has(target.pid)) return fail(res, '需先通过该题才能查看他人代码');
    if (target.uid === req.session.uid) return fail(res, '不能 hack 自己的提交');
  }
  return ok(res, {
    data: {
      sid: target.sid, uid: target.uid, name: target.name,
      lang: target.lang, code: target.code,
      idx: await getIdxByPid(cid, target.pid),
    },
  });
});

exports.submitHack = handler(async (req, res) => {
  const { cid, targetSid } = req.body;
  const input = String(req.body.input || '');
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canHack) return res.status(403).end('403 Forbidden');
  if (!input.trim()) return fail(res, '请提供 hack 输入数据');
  if (input.length > MAX_HACK_INPUT) return fail(res, `hack 输入不能超过 ${MAX_HACK_INPUT / 1024}KB`);

  const uid = req.session.uid;
  const target = await db.one(
    'SELECT sid,uid,pid,cid,judgeResult FROM submission WHERE sid=?',
    [targetSid]
  );
  if (!target || Number(target.cid) !== Number(cid) || target.judgeResult !== AC) {
    return fail(res, '目标不可 hack（未通过或已失效）');
  }
  if (target.uid === uid) return fail(res, '不能 hack 自己的提交');
  const passed = await myPassedPids(cid, uid);
  if (!passed.has(target.pid)) return fail(res, '需先通过该题才能 hack');
  const alreadyHacked = await db.exists(
    "SELECT 1 FROM contestHack WHERE targetSid=? AND status='success'", [targetSid]
  );
  if (alreadyHacked) return fail(res, '该提交已被成功 hack');
  const inFlight = await db.exists(
    "SELECT 1 FROM contestHack WHERE hackerUid=? AND cid=? AND status IN ('pending','judging')",
    [uid, cid]
  );
  if (inFlight) return fail(res, '你还有 hack 正在判定，请稍候');
  const support = await hackSupport(target.pid);
  if (!support.supported) return fail(res, support.reason);

  const idx = await getIdxByPid(cid, target.pid);
  const r = await db.query(
    "INSERT INTO contestHack(cid,pid,idx,hackerUid,targetSid,targetUid,inputFile,status,createTime) VALUES (?,?,?,?,?,?,?,?,?)",
    [cid, target.pid, idx, uid, targetSid, target.uid, '', 'pending', new Date()]
  );
  const hackId = r.insertId;
  fs.mkdirSync(hacksDir(cid), { recursive: true });
  fs.writeFileSync(path.join(hacksDir(cid), `${hackId}.in`), input);
  await db.query('UPDATE contestHack SET inputFile=? WHERE hackId=?', [`${hackId}.in`, hackId]);
  hackQueue.push(hackId);
  return ok(res, { hackId });
});

// hack 记录：选手看自己的明细 + 全场统计；管理员/赛后看全量明细
exports.getHackList = handler(async (req, res) => {
  const { cid } = req.body;
  const { offset, limit } = paginate(req, 20);
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canViewHacks) return res.status(403).end('403 Forbidden');

  const fullView = v.caps.manage || v.status === 3;
  const where = fullView ? 'h.cid=?' : 'h.cid=? AND h.hackerUid=?';
  const params = fullView ? [cid] : [cid, req.session.uid];
  const list = await db.query(
    `SELECT h.hackId,h.idx,h.hackerUid,h.targetSid,h.targetUid,h.status,h.verdict,h.createTime,h.judgedTime,
            hu.name AS hackerName,tu.name AS targetName
       FROM contestHack h
       INNER JOIN userInfo hu ON hu.uid=h.hackerUid
       INNER JOIN userInfo tu ON tu.uid=h.targetUid
      WHERE ${where} ORDER BY h.hackId DESC LIMIT ?,?`,
    [...params, offset, limit]
  );
  for (const h of list) {
    h.createTime = Format(h.createTime);
    h.judgedTime = h.judgedTime ? Format(h.judgedTime) : null;
  }
  const cnt = await db.one(`SELECT COUNT(*) AS total FROM contestHack h WHERE ${where}`, params);
  const stats = await db.one(
    `SELECT COUNT(*) AS total,
            SUM(status='success') AS success,
            SUM(status='fail') AS failed,
            SUM(status IN ('pending','judging')) AS running
       FROM contestHack WHERE cid=?`,
    [cid]
  );
  return ok(res, {
    data: list,
    total: Number(cnt && cnt.total || 0),
    stats: {
      total: Number(stats && stats.total || 0),
      success: Number(stats && stats.success || 0),
      failed: Number(stats && stats.failed || 0),
      running: Number(stats && stats.running || 0),
    },
    fullView,
  });
});

exports.judgeHack = judgeHack; // e2e 直调
