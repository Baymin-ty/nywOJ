const { Server } = require('socket.io');
const socketParser = require('socket.io-msgpack-parser');
const { diff } = require('jsondiffpatch');

const db = require('../../db');
const conf = require('../../config.json');
const storage = require('../../storage');
const judge = require('./core');
const judgeClients = require('./clientRegistry');
const judgeSocketBridge = require('./socketBridge');
const { submissionEvents } = require('./events');

const SUBSCRIPTION_ACTION = 'submissionProgress';
const SUBSCRIPTION_TTL_SECONDS = 24 * 60 * 60;

const STATUS_BY_RESULT = {
  0: 'Pending',
  1: 'Pending',
  2: 'Pending',
  3: 'CompilationError',
  4: 'Accepted',
  5: 'WrongAnswer',
  6: 'TimeLimitExceeded',
  7: 'MemoryLimitExceeded',
  8: 'RuntimeError',
  9: 'RuntimeError',
  10: 'OutputLimitExceeded',
  11: 'RuntimeError',
  12: 'SystemError',
  13: 'Canceled',
  14: 'Skipped',
  15: 'PartiallyCorrect',
  16: 'JudgementFailed',
};

const CASE_STATUS_BY_RESULT = {
  Accepted: 'Accepted',
  'Wrong Answer': 'WrongAnswer',
  'Time Limit Exceeded': 'TimeLimitExceeded',
  'Memory Limit Exceeded': 'MemoryLimitExceeded',
  'Runtime Error': 'RuntimeError',
  'Segmentation Fault': 'RuntimeError',
  'Output Limit Exceeded': 'OutputLimitExceeded',
  'Dangerous System Call': 'RuntimeError',
  'System Error': 'SystemError',
  Canceled: 'Canceled',
  Skipped: 'Skipped',
  'Partially Correct': 'PartiallyCorrect',
  'Judgement Failed': 'JudgementFailed',
};

const isPendingResult = (result) => [0, 1, 2].includes(Number(result));

const normalizeHost = (value) => {
  let text = String(value || '').trim();
  if (!text) return '';
  if (text.includes(',')) text = text.split(',')[0].trim();
  if (/^https?:\/\//i.test(text)) {
    try {
      text = new URL(text).hostname;
    } catch (_) {
      return '';
    }
  } else if (text.startsWith('[')) {
    const end = text.indexOf(']');
    text = end >= 0 ? text.slice(1, end) : text;
  } else {
    const colonCount = (text.match(/:/g) || []).length;
    if (colonCount === 1) text = text.split(':')[0];
  }
  if (text.toLowerCase().startsWith('::ffff:')) text = text.slice(7);
  return text.toLowerCase();
};

const socketRemoteHost = (socket) => {
  const headers = (socket.request && socket.request.headers) || {};
  const forwardedFor = Array.isArray(headers['x-forwarded-for'])
    ? headers['x-forwarded-for'][0]
    : headers['x-forwarded-for'];
  const candidates = [
    forwardedFor,
    headers['x-real-ip'],
    socket.handshake && socket.handshake.address,
    socket.request && socket.request.socket && socket.request.socket.remoteAddress,
    socket.conn && socket.conn.remoteAddress,
  ];
  for (const candidate of candidates) {
    const host = normalizeHost(candidate);
    if (host) return host;
  }
  return '';
};

const judgeClientAllowsHost = (client, host) => {
  const allowedHosts = judgeClients.normalizeAllowedHosts(client && client.allowedHosts);
  if (!allowedHosts.length) return true;
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return false;
  return allowedHosts.some((item) => {
    const allowedHost = normalizeHost(item);
    return allowedHost === '*' || allowedHost === normalizedHost;
  });
};

const encodeSubscription = (subscription) => storage.signToken({
  action: SUBSCRIPTION_ACTION,
  type: subscription.type,
  submissionIds: Array.isArray(subscription.submissionIds)
    ? subscription.submissionIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
    : [],
}, SUBSCRIPTION_TTL_SECONDS);

const decodeSubscription = (token) => {
  const payload = storage.verifyToken(token, SUBSCRIPTION_ACTION);
  if (!payload) return null;
  const type = Number(payload.type) === 1 || payload.type === 'Detail' ? 1 : 0;
  const submissionIds = Array.isArray(payload.submissionIds)
    ? payload.submissionIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
    : [];
  if (!submissionIds.length) return null;
  return { type, submissionIds };
};

const loadSubmissionRow = (sid) => db.one(
  `SELECT s.sid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.lang,s.isPublic,
          l.name AS langName,l.lang AS langKey
     FROM submission s LEFT JOIN languages l ON l.id=s.lang
    WHERE s.sid=?`,
  [sid]
);

const basicMeta = (row) => ({
  id: row.sid,
  sid: row.sid,
  isPublic: !!row.isPublic,
  codeLanguage: row.langKey || row.langName || '',
  answerSize: Number(row.codeLength || row.codelength || 0),
  score: row.score == null ? null : Number(row.score),
  status: STATUS_BY_RESULT[Number(row.judgeResult)] || 'Pending',
  submitTime: row.submitTime,
  timeUsed: row.time == null ? null : Number(row.time),
  memoryUsed: row.memory == null ? null : Number(row.memory),
});

const caseStatus = (value) => CASE_STATUS_BY_RESULT[String(value || '')] || STATUS_BY_RESULT[Number(value)] || 'Pending';

const omittable = (value) => {
  if (value == null) return undefined;
  const text = String(value);
  return text.length > 4096 ? { data: text.slice(0, 4096), omittedLength: text.length - 4096 } : text;
};

const loadProgressDetail = async (row) => {
  if (isPendingResult(row.judgeResult)) {
    return {
      progressType: 'Running',
      testcaseResult: {},
      samples: [],
      subtasks: [],
    };
  }

  const cases = await db.query(
    'SELECT caseId,input,output,time,memory,result,compareResult,subtaskId FROM submissionDetail WHERE sid=? ORDER BY caseId',
    [row.sid]
  ).catch(() => []);
  const testcaseResult = {};
  const bySubtask = new Map();
  for (const item of cases) {
    const hash = `case:${item.caseId}`;
    const status = caseStatus(item.result);
    testcaseResult[hash] = {
      testcaseInfo: {},
      status,
      score: status === 'Accepted' ? 100 : 0,
      time: item.time == null ? undefined : Number(item.time),
      memory: item.memory == null ? undefined : Number(item.memory),
      input: omittable(item.input),
      output: undefined,
      userOutput: omittable(item.output),
      systemMessage: omittable(item.compareResult),
    };
    const subtaskId = Number(item.subtaskId || 1);
    if (!bySubtask.has(subtaskId)) {
      bySubtask.set(subtaskId, { score: 0, fullScore: 100, testcases: [] });
    }
    const subtask = bySubtask.get(subtaskId);
    if (status === 'Accepted') subtask.score = subtask.fullScore;
    else subtask.score = Math.min(subtask.score, 0);
    subtask.testcases.push({ testcaseHash: hash });
  }
  return {
    progressType: 'Finished',
    status: STATUS_BY_RESULT[Number(row.judgeResult)] || 'SystemError',
    score: row.score == null ? null : Number(row.score),
    totalOccupiedTime: row.time == null ? null : Number(row.time),
    testcaseResult,
    samples: [],
    subtasks: [...bySubtask.values()],
  };
};

const loadMessage = async (sid, type) => {
  const row = await loadSubmissionRow(sid);
  if (!row) return null;
  const pending = isPendingResult(row.judgeResult);
  const message = {
    progressMeta: pending
      ? { progressType: 'Running' }
      : {
        progressType: 'Finished',
        resultMeta: basicMeta(row),
      },
  };
  if (type === 1) message.progressDetail = await loadProgressDetail(row);
  return message;
};

const sendDelta = async (socket, sid, type) => {
  const message = await loadMessage(sid, type);
  if (!message) return false;
  const previous = socket.data.lastMessages.get(sid);
  const delta = diff(previous, message);
  if (delta) socket.emit('message', sid, delta);
  socket.data.lastMessages.set(sid, message);
  return !!delta;
};

const attach = (server) => {
  const io = new Server(server, {
    path: '/api/socket',
    transports: ['websocket'],
    parser: socketParser,
    maxHttpBufferSize: 1e9,
    cors: { origin: true, credentials: true },
  });
  attachJudgeNamespace(io);
  const namespace = io.of('/submission-progress');
  namespace.on('connection', async (socket) => {
    const subscription = decodeSubscription(socket.handshake.query.subscriptionKey);
    if (!subscription) {
      socket.disconnect(true);
      return;
    }

    const ids = new Set(subscription.submissionIds);
    socket.data.lastMessages = new Map();
    for (const sid of ids) {
      await sendDelta(socket, sid, subscription.type).catch((err) => {
        console.error('submission socket initial message error:', err && err.stack ? err.stack : err);
      });
    }

    const onUpdate = (sid) => {
      const id = Number(sid);
      if (!ids.has(id)) return;
      sendDelta(socket, id, subscription.type).catch((err) => {
        console.error('submission socket update error:', err && err.stack ? err.stack : err);
      });
    };
    submissionEvents.on('update', onUpdate);
    socket.on('disconnect', () => {
      submissionEvents.off('update', onUpdate);
    });
  });
  return io;
};

const attachJudgeNamespace = (io) => {
  const namespace = io.of('/judge');
  namespace.on('connection', async (socket) => {
    const key = String(socket.handshake.query.key || '').split(' ').pop();
    const client = key && await judgeClients.getByKey(key).catch(() => null);
    if (!client || !client.enabled) {
      socket.emit('authenticationFailed');
      setImmediate(() => socket.disconnect(true));
      return;
    }

    const remoteHost = socketRemoteHost(socket);
    if (!judgeClientAllowsHost(client, remoteHost)) {
      await judgeClients.recordHeartbeat(client.id, {
        status: 'warning',
        message: `socket rejected from ${remoteHost || 'unknown host'}`,
        queue: judgeSocketBridge.queueStats(),
      }).catch(() => {});
      socket.emit('authenticationFailed');
      setImmediate(() => socket.disconnect(true));
      return;
    }

    socket.data.judgeClientId = client.id;
    judgeSocketBridge.registerClient({ id: client.id, name: client.name, socket });
    await judgeClients.recordHeartbeat(client.id, {
      status: 'online',
      message: 'socket connected',
      queue: judgeSocketBridge.queueStats(),
    });
    socket.emit('ready', client.name, judgeSocketBridge.clientConfig());

    socket.on('systemInfo', async (systemInfo) => {
      await judgeClients.recordSystemInfo(client.id, systemInfo).catch((err) => {
        console.error('judge socket systemInfo error:', err && err.stack ? err.stack : err);
      });
    });

    socket.on('requestFiles', async (fileUuids, ack) => {
      const list = Array.isArray(fileUuids) ? fileUuids : [];
      await judgeClients.recordHeartbeat(client.id, {
        status: 'online',
        message: `requested ${list.length} files`,
        queue: judgeSocketBridge.queueStats(),
      }).catch(() => {});
      if (typeof ack === 'function') ack(judgeSocketBridge.requestFileUrls(list, socket.request));
    });

    socket.on('consumeTask', async (threadId) => {
      await judgeClients.recordHeartbeat(client.id, {
        status: 'idle',
        message: 'socket task consumer waiting',
        queue: judgeSocketBridge.queueStats(),
      }).catch(() => {});
      await judgeSocketBridge.consume(client.id, socket, threadId);
    });

    socket.on('progress', async (message) => {
      const known = await judgeSocketBridge.applyProgress(message).catch((err) => {
        console.error('judge socket progress error:', err && err.stack ? err.stack : err);
        return false;
      });
      await judgeClients.recordHeartbeat(client.id, {
        status: known ? 'progress' : 'warning',
        message: message && message.taskMeta ? `progress ${message.taskMeta.taskId || ''}` : 'progress received',
        queue: judgeSocketBridge.queueStats(),
      }).catch(() => {});
    });

    socket.on('disconnect', async () => {
      const retry = judgeSocketBridge.unregisterClient(client.id, socket);
      for (const task of retry) judge.pushSidIntoQueue(task.sid, task.isreJudge).catch(() => {});
      await judgeClients.recordHeartbeat(client.id, {
        status: 'offline',
        message: 'socket disconnected',
        queue: judgeSocketBridge.queueStats(),
      }).catch(() => {});
    });
  });
};

module.exports = {
  attach,
  encodeSubscription,
  decodeSubscription,
  isPendingResult,
  loadProgressDetail,
};
