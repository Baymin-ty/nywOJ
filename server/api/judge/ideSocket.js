// Online IDE — interactive run.
//
// This is the *interactive* sibling of customRun.js. Where customRun does one
// batch compile+run (all stdin up front, all output back), the IDE keeps the
// program alive and bridges a real terminal: the browser's keystrokes are fed
// to the running program and its output streams back live.
//
// Transport: a WebSocket at /api/ide/stream attached to the same HTTP server as
// the REST API (app.js). The sandbox /api/stream endpoint keeps stdin open and
// streams stdout/stderr back to the browser.
//
// Browser <-> server framing:
//   browser -> server : JSON text frames
//       { op:'start', lang, code, rows, cols }   first message, runs once
//       { op:'input', data }                     bytes for stdin (incl. ^C/^D)
//       { op:'resize', rows, cols }              terminal size changed
//       { op:'kill' }                            stop the program
//   server -> browser :
//       binary frame                             raw program output (-> xterm)
//       JSON text frame  { op:'status'|'compile-error'|'exit'|'fatal', ... }
//
// server <-> sandbox framing:
//   type 1 = exec request (JSON) / final result (JSON)
//   type 2 = output  [type, fd, ...content]
//   type 3 = input   [type, fd, ...content]
//   type 4 = cancel
//
// Like customRun, this never touches submissions, problem stats, or the judge
// queue — it talks to the sandbox directly and reuses only side-effect-free
// helpers from languages.js.

const WebSocket = require('ws');
const cookie = require('cookie');
const signature = require('cookie-signature');
const db = require('../../db');
const { sessionSecret } = require('../../sessionSecret');
const { getLanguage, stdioFiles, COMPILE_LIMITS, DEFAULT_ENV } = require('./languages');
const sandboxClient = require('./sandbox');

const SANDBOX_WS = sandboxClient.streamUrl;

const SESSION_COOKIE = 'token';

const MAX_CODE = 100 * 1024;        // 100KB — matches judge.submit / customRun
const MAX_INPUT_CHUNK = 64 * 1024;  // per browser input message
const HARD_CPU_MS = 10000;          // CPU time the program may burn
const WALL_CLOCK_MS = 120000;       // wall-clock ceiling for one interactive run
const HARD_MEM_MB = 256;
const PROC_LIMIT = 64;

const PER_USER_LIMIT = 1;           // one live interactive run per user
const GLOBAL_LIMIT = 24;            // cap total concurrent sandbox streams

const liveByUser = new Map();       // uid -> live count
let liveTotal = 0;

const runSandbox = (cmd) => sandboxClient.runOne(cmd);
const deleteSandboxFile = (id) => sandboxClient.deleteFile(id);

// Compile (or syntax-check, for Python) — mirrors customRun.compile.
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

// Resolve the logged-in uid from the signed session cookie on the WS handshake.
async function authUid(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  const raw = cookie.parse(header)[SESSION_COOKIE];
  if (!raw) return null;
  let sid = raw;
  if (raw.slice(0, 2) === 's:') {
    const unsigned = signature.unsign(raw.slice(2), sessionSecret);
    if (unsigned === false) return null;
    sid = unsigned;
  }
  const row = await db.one(
    'SELECT data FROM sessions WHERE session_id=? AND expires >= ?',
    [sid, Math.floor(Date.now() / 1000)],
  );
  if (!row) return null;
  try {
    const data = JSON.parse(row.data);
    return data && data.uid ? data.uid : null;
  } catch (_) {
    return null;
  }
}

const sendJSON = (ws, obj) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
};

const clampSize = (rows, cols) => ({
  rows: Math.max(1, Math.min(300, parseInt(rows, 10) || 24)),
  cols: Math.max(1, Math.min(500, parseInt(cols, 10) || 80)),
});

function handleConnection(ws, uid) {
  let started = false;     // start handled once
  let sandbox = null;      // ws to sandbox /stream
  let fileId = null;       // compiled binary cache id (cleaned up at the end)
  let counted = false;     // whether this connection holds a concurrency slot
  let killTimer = null;
  let closed = false;

  const release = () => {
    if (!counted) return;
    counted = false;
    liveTotal = Math.max(0, liveTotal - 1);
    const n = (liveByUser.get(uid) || 1) - 1;
    if (n <= 0) liveByUser.delete(uid);
    else liveByUser.set(uid, n);
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (killTimer) { clearTimeout(killTimer); killTimer = null; }
    if (sandbox) {
      try { if (sandbox.readyState === WebSocket.OPEN) sandbox.send(Buffer.from([4])); } catch (_) { /* */ }
      try { sandbox.close(); } catch (_) { /* */ }
    }
    if (fileId) { deleteSandboxFile(fileId); fileId = null; }
    release();
    try { ws.close(); } catch (_) { /* */ }
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString('utf-8')); } catch (_) { return; }
    if (!msg || typeof msg.op !== 'string') return;

    switch (msg.op) {
      case 'start':
        if (started) return;
        started = true;
        startRun(msg).catch((e) => {
          sendJSON(ws, { op: 'fatal', message: '运行失败' });
          console.error('ide startRun:', e && e.message ? e.message : e);
          cleanup();
        });
        return;
      case 'input': {
        if (!sandbox || sandbox.readyState !== WebSocket.OPEN) return;
        if (typeof msg.data !== 'string' || !msg.data) return;
        let buf = Buffer.from(msg.data, 'utf-8');
        if (buf.length > MAX_INPUT_CHUNK) buf = buf.subarray(0, MAX_INPUT_CHUNK);
        sandbox.send(Buffer.concat([Buffer.from([3, 0]), buf])); // type3, index0|fd0
        return;
      }
      case 'resize': {
        if (!sandbox || sandbox.readyState !== WebSocket.OPEN) return;
        const { rows, cols } = clampSize(msg.rows, msg.cols);
        sandbox.send(Buffer.concat([Buffer.from([2]), Buffer.from(JSON.stringify({ index: 0, fd: 0, rows, cols }))]));
        return;
      }
      case 'kill':
        cleanup();
        return;
      default:
        return;
    }
  });

  async function startRun({ lang, code, rows, cols }) {
    const langId = parseInt(lang, 10);
    if (typeof code !== 'string' || code.length < 1) { sendJSON(ws, { op: 'fatal', message: '请先写代码' }); return cleanup(); }
    if (code.length > MAX_CODE) { sendJSON(ws, { op: 'fatal', message: '选手提交的程序源文件必须不大于 100KB。' }); return cleanup(); }
    if (!Number.isSafeInteger(langId) || langId <= 0) { sendJSON(ws, { op: 'fatal', message: '非法语言' }); return cleanup(); }

    const langRow = await db.one('SELECT name FROM languages WHERE id=?', [langId]);
    const meta = langRow && getLanguage(langRow.name);
    if (!meta) { sendJSON(ws, { op: 'fatal', message: '非法语言' }); return cleanup(); }

    // Concurrency guards — bound sandbox pressure and stop one user hogging.
    if (liveTotal >= GLOBAL_LIMIT) { sendJSON(ws, { op: 'fatal', message: '在线运行繁忙，请稍后再试' }); return cleanup(); }
    if ((liveByUser.get(uid) || 0) >= PER_USER_LIMIT) { sendJSON(ws, { op: 'fatal', message: '你已有一个正在运行的程序' }); return cleanup(); }
    counted = true;
    liveTotal += 1;
    liveByUser.set(uid, (liveByUser.get(uid) || 0) + 1);

    // Compile / syntax-check.
    sendJSON(ws, { op: 'status', stage: 'compiling' });
    let cres;
    try {
      cres = await compile(code, meta);
    } catch (e) {
      console.error('ide compile:', e && e.message ? e.message : e);
      sendJSON(ws, { op: 'fatal', message: '评测机不可用' });
      return cleanup();
    }
    if (closed) return;
    if (cres.status === 'Internal Error') {
      // e.g. the language's compiler/interpreter is not installed in the sandbox.
      sendJSON(ws, { op: 'fatal', message: '该语言的运行环境不可用，请联系管理员' });
      return cleanup();
    }
    if (cres.status !== 'Accepted' || cres.exitCode !== 0) {
      const files = cres.outputFiles || {};
      const message = (files.stderr || '') + (files.stdout ? '\n' + files.stdout : '');
      sendJSON(ws, { op: 'compile-error', message: message || '(无编译输出)' });
      return cleanup();
    }
    fileId = cres.cachedFiles && cres.cachedFiles[meta.binary];
    if (!fileId) { sendJSON(ws, { op: 'fatal', message: '编译产物缺失' }); return cleanup(); }

    // Open the interactive stream and run the compiled artifact in a pty.
    sendJSON(ws, { op: 'status', stage: 'running' });
    const init = clampSize(rows, cols);
    const reqObj = {
      commands: [{
        command: meta.runArgs,
        env: [...(meta.runEnv || DEFAULT_ENV), 'TERM=xterm-256color'],
        stdio: [{ content: '' }, { name: 'stdout', max: 64 * 1024 * 1024 }, { name: 'stderr', max: 64 * 1024 * 1024 }],
        limits: { cpuMs: HARD_CPU_MS, wallMs: WALL_CLOCK_MS, memoryMB: HARD_MEM_MB, stackMB: HARD_MEM_MB, processes: PROC_LIMIT },
        inputFiles: { [meta.binary]: { cachedFile: fileId } },
      }],
    };

    sandbox = new WebSocket(SANDBOX_WS);
    sandbox.binaryType = 'nodebuffer';

    sandbox.on('open', () => {
      sandbox.send(Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify(reqObj))]));
      sandbox.send(Buffer.concat([Buffer.from([2]), Buffer.from(JSON.stringify({ index: 0, fd: 0, rows: init.rows, cols: init.cols }))]));
    });

    sandbox.on('message', (buf) => {
      const type = buf[0];
      if (type === 2) {
        // Raw program output -> forward bytes verbatim so xterm decodes UTF-8
        // correctly across chunk boundaries.
        if (ws.readyState === WebSocket.OPEN) ws.send(buf.subarray(2));
      } else if (type === 1) {
        let resp = null;
        try { resp = JSON.parse(buf.subarray(1).toString('utf-8')); } catch (_) { /* */ }
        const r = resp && resp.result;
        sendJSON(ws, {
          op: 'exit',
          status: r ? r.status : 'unknown',
          exitCode: r ? r.exitCode : null,
          time: r ? (r.cpuTimeMs || 0) : 0,
          memory: r ? (r.memoryKb || 0) : 0,
        });
        cleanup();
      }
    });

    sandbox.on('close', () => {
      if (!closed) { sendJSON(ws, { op: 'exit', status: 'closed' }); cleanup(); }
    });
    sandbox.on('error', (e) => {
      console.error('ide sandbox ws:', e && e.message ? e.message : e);
      sendJSON(ws, { op: 'fatal', message: '评测机连接失败' });
      cleanup();
    });

    // Belt-and-suspenders wall-clock guard on top of the sandbox wall limit.
    killTimer = setTimeout(() => {
      sendJSON(ws, { op: 'fatal', message: '运行超时，已终止' });
      cleanup();
    }, WALL_CLOCK_MS + 5000);
  }
}

// Attach the IDE WebSocket endpoint to the given http.Server. Performs cookie
// session auth during the upgrade handshake; non-/api/ide/stream upgrades are
// rejected.
function attach(server) {
  const wss = new WebSocket.Server({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (!(req.url || '').startsWith('/api/ide/stream')) {
      socket.destroy();
      return;
    }
    authUid(req)
      .then((uid) => {
        if (!uid) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, uid));
      })
      .catch((e) => {
        console.error('ide upgrade auth:', e && e.message ? e.message : e);
        socket.destroy();
      });
  });
  return wss;
}

module.exports = { attach };
