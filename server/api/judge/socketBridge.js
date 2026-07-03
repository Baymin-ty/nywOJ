const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const compressing = require('compressing');

const db = require('../../db');
const storage = require('../../storage');
const conf = require('../../config.json');
const { updateProblemStat } = require('../problem/core');
const { appendJudgeLog } = require('./log');
const { notifySubmissionProgress } = require('./events');

const FILE_ACTION = 'judgeSocketFile';
const FILE_TTL_SECONDS = 7 * 24 * 60 * 60;
const TASK_TYPE = 'Submission';

const socketClients = new Map();
const queues = new Map();
const waiters = new Map();
const pending = new Map();
const files = new Map();
let compatMetaSchemaReady = null;

const STATUS_TO_RESULT = {
  Pending: 1,
  ConfigurationError: 16,
  SystemError: 12,
  Canceled: 13,
  CompilationError: 3,
  FileError: 16,
  RuntimeError: 8,
  TimeLimitExceeded: 6,
  MemoryLimitExceeded: 7,
  OutputLimitExceeded: 10,
  PartiallyCorrect: 15,
  WrongAnswer: 5,
  Accepted: 4,
  JudgementFailed: 16,
};

const CASE_STATUS_TO_RESULT = {
  FileError: 16,
  RuntimeError: 8,
  TimeLimitExceeded: 6,
  MemoryLimitExceeded: 7,
  OutputLimitExceeded: 10,
  PartiallyCorrect: 15,
  WrongAnswer: 5,
  Accepted: 4,
  JudgementFailed: 16,
  Skipped: 14,
};

const LANGUAGE_KEY = {
  C: 'c',
  'C++': 'cpp',
  Python3: 'python',
  Java: 'java',
  Kotlin: 'kotlin',
  Pascal: 'pascal',
  Rust: 'rust',
  Go: 'go',
  Swift: 'swift',
  Haskell: 'haskell',
  'C#': 'csharp',
  'F#': 'fsharp',
};

const LANGUAGE_OPTIONS = {
  c: { compiler: 'gcc', std: 'c11', O: '2', m: '64' },
  cpp: { compiler: 'g++', std: 'c++14', O: '2', m: '64' },
  python: { version: '3' },
  kotlin: { version: '1.6', platform: 'jvm' },
  pascal: { optimize: '2' },
  rust: { version: '2021', optimize: '2' },
  swift: { version: '5', optimize: 'O' },
  haskell: { version: '2010' },
  csharp: { version: 'latest' },
  go: { version: '' },
  java: {},
  fsharp: {},
};

const normalizeLanguageKey = (language) => {
  const raw = String(language || '').trim();
  if (!raw) return '';
  if (LANGUAGE_OPTIONS[raw]) return raw;
  if (LANGUAGE_KEY[raw]) return LANGUAGE_KEY[raw];
  const lower = raw.toLowerCase();
  const aliases = {
    'c++': 'cpp',
    cpp14: 'cpp',
    python3: 'python',
    py3: 'python',
    'c#': 'csharp',
    'f#': 'fsharp',
  };
  return aliases[lower] || (LANGUAGE_OPTIONS[lower] ? lower : raw);
};

const CLIENT_CONFIG_DEFAULT = {
  limit: {
    compilerMessage: 512 * 1024,
    outputSize: 100 * 1024 * 1024,
    dataDisplay: 128,
    dataDisplayForSubmitAnswer: 128,
    stderrDisplay: 5120,
  },
};

const clientConfig = () => ({
  ...CLIENT_CONFIG_DEFAULT,
  ...(conf.JUDGE || {}),
  limit: {
    ...CLIENT_CONFIG_DEFAULT.limit,
    ...((conf.JUDGE && conf.JUDGE.limit) || {}),
  },
});

const arrayFor = (map, key) => {
  if (!map.has(key)) map.set(key, []);
  return map.get(key);
};

const queueStats = () => {
  let waiting = 0;
  let running = pending.size;
  for (const q of queues.values()) waiting += q.length;
  return { waiting, running, concurrency: socketClients.size };
};

const ensureCompatMetaSchema = () => {
  if (!compatMetaSchemaReady) {
    compatMetaSchemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS problemCompatMeta (
        pid INT NOT NULL PRIMARY KEY,
        defaultLocale VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
        judgeInfo MEDIUMTEXT NULL,
        submittable TINYINT NOT NULL DEFAULT 1,
        updateTime DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
  return compatMetaSchemaReady;
};

const safeRel = (value) => {
  const rel = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const normalized = path.posix.normalize(rel);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error(`unsafe problem data path: ${value}`);
  }
  return normalized;
};

const dataAbs = (pid, rel) => path.join(__dirname, '..', '..', 'data', String(pid), safeRel(rel));

const parseJsonObject = (value) => {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
};

const isProfileShape = (value) =>
  !!(value && value.version && value.submit && value.run);

const normalizeOfficialJudgeInfo = (judgeInfo, timeLimit, memoryLimit) => {
  if (!judgeInfo) return null;
  const normalized = JSON.parse(JSON.stringify(judgeInfo));
  if (!normalized.timeLimit) normalized.timeLimit = timeLimit;
  if (!normalized.memoryLimit) normalized.memoryLimit = memoryLimit;
  if (normalized.checker && normalized.checker.type === 'custom') {
    normalized.checker.language = normalizeLanguageKey(normalized.checker.language || 'cpp');
    if (!normalized.checker.interface) normalized.checker.interface = 'testlib';
    if (!normalized.checker.compileAndRunOptions) {
      normalized.checker.compileAndRunOptions = LANGUAGE_OPTIONS[normalized.checker.language] || {};
    }
  }
  if (normalized.interactor) {
    if (!normalized.interactor.interface) normalized.interactor.interface = 'stdio';
    normalized.interactor.language = normalizeLanguageKey(normalized.interactor.language || 'cpp');
    if (!normalized.interactor.compileAndRunOptions) {
      normalized.interactor.compileAndRunOptions = LANGUAGE_OPTIONS[normalized.interactor.language] || {};
    }
    if (!normalized.interactor.timeLimit) normalized.interactor.timeLimit = timeLimit;
    if (!normalized.interactor.memoryLimit) normalized.interactor.memoryLimit = memoryLimit;
  }
  return normalized;
};

const fileUuid = (pid, rel, abs) => {
  const stat = fs.statSync(abs);
  const digest = crypto.createHash('sha256')
    .update(`${pid}:${safeRel(rel)}:${stat.size}:${stat.mtimeMs}`)
    .digest('hex')
    .slice(0, 32);
  return `nywoj-${digest}`;
};

const registerProblemFile = (pid, rel) => {
  const normalized = safeRel(rel);
  const abs = dataAbs(pid, normalized);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`missing problem file: ${normalized}`);
  const uuid = fileUuid(pid, normalized, abs);
  files.set(uuid, { path: abs, filename: path.basename(normalized) });
  return uuid;
};

const omittableText = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value.data === 'string') return value.data;
  return String(value);
};

const messageText = (...parts) => parts.map(omittableText).filter(Boolean).join('\n').slice(0, 4096);

const baseUrlFromRequest = (req) => {
  const configured = conf.PUBLIC_URL || (conf.SERVER && (conf.SERVER.PUBLIC_URL || conf.SERVER.URL));
  if (configured) return String(configured).replace(/\/+$/, '');
  const proto = (req && (req.headers['x-forwarded-proto'] || req.headers['x-scheme'])) || 'http';
  const host = req && req.headers.host;
  return `${String(proto).split(',')[0]}://${host || '127.0.0.1:1234'}`;
};

const urlForRegisteredFile = (uuid, req) => {
  if (!files.has(uuid)) return '';
  const token = storage.signToken({ action: FILE_ACTION, uuid }, FILE_TTL_SECONDS);
  return `${baseUrlFromRequest(req)}/api/judge/socketFile?token=${encodeURIComponent(token)}`;
};

const normalizeSubtasks = (config) => {
  const cases = Array.isArray(config.cases) ? config.cases : [];
  const grouped = new Map();
  for (const item of cases) {
    const subtaskId = Number(item.subtaskId || 1);
    if (!grouped.has(subtaskId)) grouped.set(subtaskId, []);
    grouped.get(subtaskId).push(item);
  }
  return (Array.isArray(config.subtask) ? config.subtask : [{ index: 1, score: 100, option: 0 }])
    .map((subtask) => {
      const index = Number(subtask.index || 1);
      const testcases = (grouped.get(index) || []).sort((a, b) => Number(a.index) - Number(b.index));
      return {
        index,
        score: Number(subtask.score || 100),
        option: Number(subtask.option || 0),
        dependencies: Array.isArray(subtask.dependencies) ? subtask.dependencies.map(Number).filter(Number.isFinite) : [],
        testcases,
      };
    })
    .filter((subtask) => subtask.testcases.length);
};

const normalizeOfficialSubtasks = (judgeInfo) =>
  (Array.isArray(judgeInfo && judgeInfo.subtasks) ? judgeInfo.subtasks : [])
    .map((subtask, index) => ({
      index: index + 1,
      score: Number(subtask.points || subtask.score || 0) || 0,
      option: subtask.scoringType === 'GroupMin' || subtask.scoringType === 'GroupMul' ? 1 : 0,
      dependencies: Array.isArray(subtask.dependencies)
        ? subtask.dependencies.map((id) => Number(id) + 1).filter(Number.isFinite)
        : [],
      testcases: (Array.isArray(subtask.testcases) ? subtask.testcases : []).map((testcase, testcaseIndex) => ({
        ...testcase,
        index: testcase.index || testcaseIndex + 1,
        subtaskId: index + 1,
      })),
    }))
    .filter((subtask) => subtask.testcases.length);

const checkerFor = (pid, type, timeLimit, memoryLimit, testData) => {
  if (Number(type) !== 1 && Number(type) !== 3) return { type: 'lines', caseSensitive: true };
  testData['checker.cpp'] = registerProblemFile(pid, 'checker.cpp');
  return {
    type: 'custom',
    interface: 'testlib',
    language: 'cpp',
    compileAndRunOptions: LANGUAGE_OPTIONS.cpp,
    filename: 'checker.cpp',
    timeLimit,
    memoryLimit,
  };
};

const registerJudgeInfoFiles = (pid, judgeInfo, testData) => {
  const add = (filename) => {
    if (!filename) return;
    if (!testData[filename]) testData[filename] = registerProblemFile(pid, filename);
  };
  for (const subtask of Array.isArray(judgeInfo.subtasks) ? judgeInfo.subtasks : []) {
    for (const testcase of Array.isArray(subtask.testcases) ? subtask.testcases : []) {
      add(testcase.inputFile);
      add(testcase.outputFile);
    }
  }
  if (judgeInfo.checker && judgeInfo.checker.type === 'custom') add(judgeInfo.checker.filename);
  if (judgeInfo.interactor) add(judgeInfo.interactor.filename);
  if (judgeInfo.extraSourceFiles && typeof judgeInfo.extraSourceFiles === 'object') {
    for (const fileMap of Object.values(judgeInfo.extraSourceFiles)) {
      if (!fileMap || typeof fileMap !== 'object') continue;
      for (const src of Object.values(fileMap)) add(src);
    }
  }
};

const problemTypeFromJudgeInfo = (row, judgeInfo) => {
  if (judgeInfo && judgeInfo.interactor) return 'Interaction';
  if ([2, 3].includes(Number(row.type))) return 'SubmitAnswer';
  return 'Traditional';
};

const buildAnswerZip = async (sid) => {
  const answerDir = path.join(__dirname, '..', '..', 'answerSubmissions', String(sid));
  if (!fs.existsSync(answerDir)) throw new Error(`missing answer submission files for ${sid}`);
  const zipPath = path.join(os.tmpdir(), `nywoj-socket-answer-${sid}-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  await compressing.zip.compressDir(answerDir, zipPath);
  const uuid = `nywoj-answer-${sid}-${crypto.randomBytes(8).toString('hex')}`;
  files.set(uuid, { path: zipPath, filename: `submission-${sid}-answers.zip`, disposable: true });
  return uuid;
};

const loadProblemSamples = async (pid) => {
  const row = await db.one('SELECT samples FROM problemSample WHERE pid=?', [pid]).catch(() => null);
  if (!row || !row.samples) return [];
  try {
    const samples = JSON.parse(row.samples);
    if (!Array.isArray(samples)) return [];
    return samples.map((item) => ({
      inputData: String(item.input || item.inputData || ''),
      outputData: String(item.output || item.outputData || ''),
    }));
  } catch (_) {
    return [];
  }
};

const buildJudgeTask = async ({ sid, isreJudge, clientId, priority = 1, req }) => {
  await ensureCompatMetaSchema();
  const row = await db.one(
    `SELECT s.sid,s.pid,s.code,s.lang,s.codeLength,l.name AS langName,
            p.type,p.timeLimit,p.memoryLimit,p.judgeProfile,pcm.judgeInfo AS compatJudgeInfo
       FROM submission s
       INNER JOIN problem p ON p.pid=s.pid
       LEFT JOIN problemCompatMeta pcm ON pcm.pid=p.pid
       LEFT JOIN languages l ON l.id=s.lang
      WHERE s.sid=?`,
    [sid]
  );
  if (!row) throw new Error(`submission ${sid} not found`);
  const profile = parseJsonObject(row.judgeProfile);
  const rawCompatJudgeInfo = parseJsonObject(row.compatJudgeInfo);
  const timeLimit = Number(row.timeLimit || 1000);
  const memoryLimit = Number(row.memoryLimit || 128);
  const compatJudgeInfo = isProfileShape(rawCompatJudgeInfo)
    ? null
    : normalizeOfficialJudgeInfo(rawCompatJudgeInfo, timeLimit, memoryLimit);
  if (!compatJudgeInfo && profile && ['interactive', 'communication', 'function'].includes(profile.preset)) {
    throw new Error(`profile preset ${profile.preset} is handled by the local judge`);
  }

  let judgeInfo = compatJudgeInfo;
  let subtasks;
  if (judgeInfo) {
    subtasks = normalizeOfficialSubtasks(judgeInfo);
  } else {
    const cfgRaw = await fs.promises.readFile(dataAbs(row.pid, 'config.json'), 'utf-8');
    const config = JSON.parse(cfgRaw);
    subtasks = normalizeSubtasks(config);
  }
  if (!subtasks.length) throw new Error('No testcases.');

  const testData = {};
  const caseRefs = [];
  for (let i = 0; i < subtasks.length; i++) {
    for (let j = 0; j < subtasks[i].testcases.length; j++) {
      const c = subtasks[i].testcases[j];
      if (!judgeInfo) {
        if (c.input) testData[c.input] = registerProblemFile(row.pid, c.input);
        if (c.output) testData[c.output] = registerProblemFile(row.pid, c.output);
      }
      caseRefs.push({ subtaskIndex: i, testcaseIndex: j, caseId: Number(c.index || j + 1), subtaskId: subtasks[i].index });
    }
  }

  if (judgeInfo) {
    registerJudgeInfoFiles(row.pid, judgeInfo, testData);
  } else {
    judgeInfo = {
      timeLimit,
      memoryLimit,
      subtasks: subtasks.map((subtask) => ({
        scoringType: subtask.option ? 'GroupMin' : 'Sum',
        points: subtask.score,
        dependencies: subtask.dependencies.map((id) => Math.max(0, Number(id) - 1)),
        testcases: subtask.testcases.map((c) => {
          const item = {
            inputFile: c.input || undefined,
            outputFile: c.output,
            timeLimit,
            memoryLimit,
          };
          if ([2, 3].includes(Number(row.type))) {
            const caseName = c.input ? c.input.replace(/\.in$/, '') : String(c.index);
            item.userOutputFilename = `${caseName}.out`;
          }
          return item;
        }),
      })),
      checker: checkerFor(row.pid, row.type, timeLimit, memoryLimit, testData),
    };
  }

  const problemType = problemTypeFromJudgeInfo(row, judgeInfo);

  const extraInfo = {
    problemType,
    judgeInfo,
    samples: (problemType === 'Traditional' || problemType === 'Interaction') && judgeInfo.runSamples ? await loadProblemSamples(row.pid) : null,
    testData,
    submissionContent: {},
    file: null,
  };

  if (problemType === 'SubmitAnswer') {
    const answerUuid = await buildAnswerZip(row.sid);
    extraInfo.file = { uuid: answerUuid, url: urlForRegisteredFile(answerUuid, req) };
  } else {
    const langKey = normalizeLanguageKey(row.langName);
    if (!langKey) throw new Error(`unsupported socket judge language: ${row.langName || row.lang}`);
    extraInfo.submissionContent = {
      language: langKey,
      code: row.code || '',
      compileAndRunOptions: LANGUAGE_OPTIONS[langKey] || {},
    };
  }

  const taskId = `submission-${row.sid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const task = {
    taskId,
    type: TASK_TYPE,
    priorityType: 1,
    priority,
    extraInfo,
  };
  const meta = { taskId, type: TASK_TYPE, sid: row.sid, pid: row.pid, isReJudge: !!isreJudge, isreJudge: !!isreJudge, clientId: Number(clientId || 0), caseRefs };
  pending.set(taskId, meta);
  await appendJudgeLog(row.sid, 'socket.task.sent', { taskId, problemType, judgeClient: 'socket' }).catch(() => {});
  notifySubmissionProgress(row.sid);
  return { task, meta };
};

const getCaseRef = (meta, subtaskIndex, testcaseIndex) =>
  (meta.caseRefs || []).find((item) => item.subtaskIndex === subtaskIndex && item.testcaseIndex === testcaseIndex);

const caseRowsFromProgress = (meta, progress) => {
  const rows = [];
  const testcaseResult = progress.testcaseResult || {};
  const subtasks = Array.isArray(progress.subtasks) ? progress.subtasks : [];
  for (let i = 0; i < subtasks.length; i++) {
    const testcases = Array.isArray(subtasks[i].testcases) ? subtasks[i].testcases : [];
    for (let j = 0; j < testcases.length; j++) {
      const ref = getCaseRef(meta, i, j);
      if (!ref) continue;
      const progressRef = testcases[j] || {};
      const result = progressRef.testcaseHash ? testcaseResult[progressRef.testcaseHash] : null;
      if (!result) {
        rows.push({ ...ref, time: 0, memory: 0, result: 14, input: '', output: '', compareResult: '' });
        continue;
      }
      rows.push({
        ...ref,
        time: Math.max(0, Math.round(Number(result.time || 0))),
        memory: Math.max(0, Math.round(Number(result.memory || 0))),
        result: CASE_STATUS_TO_RESULT[result.status] || 12,
        input: omittableText(result.input).slice(0, 261),
        output: omittableText(result.userOutput).slice(0, 261),
        compareResult: messageText(result.checkerMessage, result.interactorMessage, result.userError, result.systemMessage),
      });
    }
  }
  return rows;
};

const applyFinishedProgress = async (meta, progress) => {
  const finalResult = STATUS_TO_RESULT[progress.status] || 12;
  const totalTime = Math.max(0, Math.round(Number(progress.totalOccupiedTime || 0)));
  const totalMemory = Math.max(0, ...caseRowsFromProgress(meta, progress).map((row) => row.memory));
  const score = progress.score == null ? 0 : Number(progress.score);
  const compileMessage = progress.compile && progress.compile.success === false
    ? omittableText(progress.compile.message)
    : omittableText(progress.systemMessage);
  const caseRows = caseRowsFromProgress(meta, progress);
  const subtaskList = Array.isArray(progress.subtasks) ? progress.subtasks.map((subtask, index) => ({
    index: String(index + 1),
    time: caseRows.filter((row) => row.subtaskId === index + 1).reduce((sum, row) => sum + row.time, 0),
    memory: caseRows.filter((row) => row.subtaskId === index + 1).reduce((max, row) => Math.max(max, row.memory), 0),
    res: caseRows.some((row) => row.subtaskId === index + 1 && row.result !== 4)
      ? Math.min(...caseRows.filter((row) => row.subtaskId === index + 1 && row.result !== 4).map((row) => row.result))
      : 4,
    score: subtask.score == null ? 0 : Number(subtask.score),
    fullScore: subtask.fullScore == null ? 0 : Number(subtask.fullScore),
    option: 1,
    dependencies: [],
  })) : null;

  await db.tx(async (t) => {
    await t.query('DELETE FROM submissionDetail WHERE sid=?', [meta.sid]);
    for (const row of caseRows) {
      await t.query(
        'INSERT INTO submissionDetail(sid,caseId,input,output,time,memory,result,compareResult,subtaskId) VALUES (?,?,?,?,?,?,?,?,?)',
        [meta.sid, row.caseId, row.input, row.output, row.time, row.memory, row.result, row.compareResult, row.subtaskId]
      );
    }
    await t.query(
      'UPDATE submission SET judgeResult=?,time=?,memory=?,score=?,compileResult=?,caseResult=?,machine=? WHERE sid=?',
      [
        finalResult,
        totalTime,
        totalMemory,
        score,
        compileMessage || null,
        subtaskList ? JSON.stringify(subtaskList) : null,
        conf.JUDGE && conf.JUDGE.NAME || 'socket judge',
        meta.sid,
      ]
    );
  });
  await appendJudgeLog(meta.sid, 'socket.progress.finished', {
    taskId: meta.taskId,
    status: progress.status,
    score,
    finalResult,
    cases: caseRows.length,
  }).catch(() => {});
  notifySubmissionProgress(meta.sid);
  await updateProblemSubmitInfo(meta.pid).catch(() => {});
  await updateProblemStat(meta.pid).catch(() => {});
};

const updateProblemSubmitInfo = async (pid) => {
  const total = await db.one('SELECT COUNT(*) as cnt FROM submission WHERE pid=?', [pid]);
  await db.query('UPDATE problem SET submitCnt=? WHERE pid=?', [total.cnt, pid]);
  const ac = await db.one('SELECT COUNT(*) as cnt FROM submission WHERE pid=? AND judgeResult=4', [pid]);
  await db.query('UPDATE problem SET acCnt=? WHERE pid=?', [ac.cnt, pid]);
};

const applyProgress = async (message) => {
  const taskMeta = message && message.taskMeta;
  const progress = message && message.progress;
  const meta = taskMeta && pending.get(taskMeta.taskId);
  if (!meta || !progress) return false;
  await appendJudgeLog(meta.sid, 'socket.progress', {
    taskId: meta.taskId,
    progressType: progress.progressType,
    status: progress.status || null,
  }).catch(() => {});
  if (progress.progressType === 'Finished') await applyFinishedProgress(meta, progress);
  else notifySubmissionProgress(meta.sid);
  return true;
};

const emitTask = async (socket, threadId, queued) => {
  const { task, meta } = await buildJudgeTask({ ...queued, req: socket.request });
  socket.emit('task', threadId, task, () => {
    setTimeout(() => pending.delete(task.taskId), 30000);
    if (files.size > 5000) {
      for (const [uuid, file] of files) {
        if (file.disposable) fs.promises.rm(file.path, { force: true }).catch(() => {});
        files.delete(uuid);
        if (files.size <= 4000) break;
      }
    }
  });
  return meta;
};

const wakeClient = async (clientId) => {
  const q = arrayFor(queues, clientId);
  const w = arrayFor(waiters, clientId);
  while (q.length && w.length) {
    const waiter = w.shift();
    if (!waiter.socket.connected) continue;
    const queued = q.shift();
    try {
      await emitTask(waiter.socket, waiter.threadId, queued);
    } catch (err) {
      queued.onBuildError(err);
      if (waiter.socket.connected) w.unshift(waiter);
      break;
    }
  }
};

const registerClient = (client) => {
  socketClients.set(Number(client.id), client);
};

const unregisterClient = (clientId, socket = null) => {
  const id = Number(clientId);
  const current = socketClients.get(id);
  if (socket && current && current.socket && current.socket.id !== socket.id) return [];
  socketClients.delete(id);
  waiters.delete(id);
  const queued = queues.get(id) || [];
  queues.delete(id);
  const ownedPending = [];
  for (const [taskId, meta] of pending.entries()) {
    if (meta.clientId === id) {
      ownedPending.push(meta);
      pending.delete(taskId);
    }
  }
  return [...queued, ...ownedPending].map((item) => ({ sid: item.sid, isreJudge: item.isreJudge }));
};

const onlineClients = () => [...socketClients.values()].map((client) => ({
  id: client.id,
  name: client.name,
  kind: 'socket',
}));

const enqueue = async (clientId, sid, isreJudge, onBuildError) => {
  const id = Number(clientId);
  if (!socketClients.has(id)) return false;
  arrayFor(queues, id).push({
    sid: Number(sid),
    isreJudge: !!isreJudge,
    clientId: id,
    onBuildError: typeof onBuildError === 'function' ? onBuildError : () => {},
  });
  await wakeClient(id);
  return true;
};

const consume = async (clientId, socket, threadId) => {
  const id = Number(clientId);
  const q = arrayFor(queues, id);
  if (q.length) {
    const queued = q.shift();
    try {
      await emitTask(socket, threadId, queued);
    } catch (err) {
      queued.onBuildError(err);
      if (socket.connected) arrayFor(waiters, id).push({ socket, threadId });
    }
    return;
  }
  arrayFor(waiters, id).push({ socket, threadId });
};

const cancelSid = (sid) => {
  const id = Number(sid);
  for (const client of socketClients.values()) {
    for (const meta of pending.values()) {
      if (Number(meta.sid) === id && client.socket && client.socket.connected) {
        client.socket.emit('cancel', meta.taskId);
      }
    }
  }
};

const requestFileUrls = (fileUuids, req) =>
  (Array.isArray(fileUuids) ? fileUuids : []).map((uuid) => urlForRegisteredFile(uuid, req));

const serveFile = (req, res) => {
  const token = storage.verifyToken(req.query.token, FILE_ACTION);
  if (!token || !token.uuid || !files.has(token.uuid)) return res.status(403).end('403 Forbidden');
  const file = files.get(token.uuid);
  if (!fs.existsSync(file.path)) return res.status(404).end('Not Found');
  return res.download(file.path, file.filename || token.uuid);
};

module.exports = {
  clientConfig,
  queueStats,
  registerClient,
  unregisterClient,
  onlineClients,
  enqueue,
  consume,
  cancelSid,
  requestFileUrls,
  serveFile,
  applyProgress,
};
