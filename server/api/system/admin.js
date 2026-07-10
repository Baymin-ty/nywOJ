const db = require('../../db');
const { handler, fail, ok, paginate, buildWhere } = require('../../db/util');
const { requirePermission } = require('../../auth/middleware');
const { loadEffectivePermissions, can } = require('../../auth/policy');
const { Format, eventList, eventExp, recordEvent } = require('../../static');
const { judgeRes } = require('../../db/format');
const judgeClients = require('../judge/clientRegistry');
const sandboxClient = require('../judge/sandbox');

// 越权防护：仅持有 user.manage 的账号（如 moderator）不能对其他管理员
// （拥有 user.manage 或 user.role.admin 的目标）改密码 / 封禁。拥有
// user.role.admin 的人（super_admin / root）不受此限。返回错误消息或 null。
const guardPrivilegedTarget = async (req, targetUid) => {
  if (req.can('user.role.admin')) return null;
  const targetPerms = await loadEffectivePermissions(targetUid);
  if (can(targetPerms, 'user.manage') || can(targetPerms, 'user.role.admin'))
    return '无权操作该管理员账号';
  return null;
};

const judgeMonitorPermission = ['judge.monitor.view', 'judge.client.manage'];
const judgeClientPermission = 'judge.client.manage';
const NAME_REGEX = /^[A-Za-z0-9\-_.#$]{3,24}$/;
const USERNAME_RULE_MESSAGE = '用户名长度应在3~24之间，可包含字母、数字和 -_.#$';
const EMAIL_REGEX = /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/;

const normalizeJudgeClientName = (name) => String(name || '').trim();

const normalizeJudgeClientEndpoint = (endpoint) => String(endpoint || '').trim();

const normalizeJudgeClientAllowedHosts = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20);
  const single = String(value || '').trim();
  return single ? [single] : [];
};

const validateJudgeClientInput = ({ name, endpoint, allowedHosts }, partial = false) => {
  const patch = {};
  if (!partial || name !== undefined) {
    patch.name = normalizeJudgeClientName(name);
    if (!patch.name || patch.name.length > 80) return { error: '评测机名称长度需在 1 到 80 字之间' };
  }
  if (!partial || endpoint !== undefined) {
    patch.endpoint = normalizeJudgeClientEndpoint(endpoint);
    if (patch.endpoint && !/^https?:\/\//i.test(patch.endpoint)) return { error: '评测机地址需以 http:// 或 https:// 开头' };
    if (patch.endpoint.length > 255) return { error: '评测机地址过长' };
  }
  if (!partial || allowedHosts !== undefined) {
    patch.allowedHosts = normalizeJudgeClientAllowedHosts(allowedHosts);
    if (patch.allowedHosts.some((item) => item.length > 255)) return { error: '允许来源地址过长' };
  }
  return { patch };
};

// Read-only listing: useful both to user.manage (edit/ban flow) and to
// user.role.admin (role/grant flow), so accept either. Modifying endpoints
// below stay tied to a single permission.
exports.getUserInfoList = [
  requirePermission(['user.manage', 'user.role.admin']),
  handler(async (req, res) => {
    const { offset, limit } = paginate(req);
    const filter = req.body.filter || {};

    // `q` is a unified search box: matches uid (exact) OR name (LIKE) OR email (LIKE).
    // The original separate filters (uid/name/email) are still honored for
    // callers that have not moved to the unified search box yet.
    const q = (filter.q || '').trim();
    const cond = [
      ['u.uid=?', filter.uid],
      ['u.name LIKE ?', filter.name ? `%${filter.name}%` : null],
      ['u.email LIKE ?', filter.email ? `%${filter.email}%` : null],
      ['u.inUse=?', filter.inUse != null && filter.inUse !== '' ? Number(filter.inUse) : null],
    ];
    if (q) {
      const isNumeric = /^\d+$/.test(q);
      if (isNumeric) {
        cond.push(['(u.uid=? OR u.name LIKE ? OR u.email LIKE ?)', Number(q), `%${q}%`, `%${q}%`]);
      } else {
        cond.push(['(u.name LIKE ? OR u.email LIKE ?)', `%${q}%`, `%${q}%`]);
      }
    }

    let join = '';
    let extraParams = [];
    if (filter.roleKey) {
      if (filter.roleKey === '__none__') {
        join = ' LEFT JOIN user_roles ur ON ur.uid = u.uid';
        cond.push(['ur.uid IS NULL']);
      } else {
        join = ' INNER JOIN user_roles ur ON ur.uid = u.uid INNER JOIN roles r ON r.id = ur.role_id AND r.`key`=?';
        extraParams.push(filter.roleKey);
      }
    }
    const { where, params } = buildWhere(cond, 'u.uid > 0');

    const sort = req.body.sort || {};
    const allowedSortKeys = { uid: 'u.uid', name: 'u.name', solved: 'solved', lastLogin: 'u.login_time' };
    const sortCol = allowedSortKeys[sort.key] || 'u.uid';
    const sortDir = sort.dir === 'desc' ? 'DESC' : 'ASC';

    const list = await db.query(
      `SELECT u.uid, u.name, u.email, u.inUse, u.reg_time AS regDate, u.login_time AS lastLogin,
              u.motto, u.qq,
              (SELECT COUNT(DISTINCT pid) FROM submission s WHERE s.uid=u.uid AND s.judgeResult=4) AS solved
       FROM userInfo u${join}${where}
       ORDER BY ${sortCol} ${sortDir}
       LIMIT ?,?`,
      [...extraParams, ...params, offset, limit]
    );
    const cnt = await db.one(
      `SELECT COUNT(*) as total FROM userInfo u${join}${where}`,
      [...extraParams, ...params]
    );
    if (list.length) {
      const uids = list.map((r) => r.uid);
      const links = await db.query(
        'SELECT ur.uid, r.`key` AS roleKey FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.uid IN (?)',
        [uids]
      );
      const byUid = new Map();
      for (const l of links) {
        if (!byUid.has(l.uid)) byUid.set(l.uid, []);
        byUid.get(l.uid).push(l.roleKey);
      }
      const grantCounts = await db.query(
        'SELECT uid, COUNT(*) AS cnt FROM user_permissions WHERE uid IN (?) GROUP BY uid',
        [uids]
      );
      const grantMap = new Map();
      for (const g of grantCounts) grantMap.set(g.uid, g.cnt);
      for (const r of list) {
        r.roles = byUid.get(r.uid) || [];
        r.grantCount = grantMap.get(r.uid) || 0;
        if (r.regDate) r.regDate = Format(r.regDate);
        if (r.lastLogin) r.lastLogin = Format(r.lastLogin);
      }
    }
    return ok(res, { total: cnt.total, userList: list });
  }),
];

exports.setBlock = [
  requirePermission('user.manage'),
  handler(async (req, res) => {
    const { uid, status } = req.body;
    if (uid == null || status == null) return fail(res, '请确认信息完善');
    const denied = await guardPrivilegedTarget(req, uid);
    if (denied) return fail(res, denied);
    const r = await db.query('UPDATE userInfo SET inUse=? WHERE uid=?', [status, uid]);
    if (!r.affectedRows) return fail(res, 'failed');
    return ok(res);
  }),
];

// Batch封禁 / 解封。逐个跑 guardPrivilegedTarget，跳过越权目标（如 moderator
// 试图操作其他管理员），最后对放行的 uid 一次性 UPDATE。返回成功 / 跳过条数。
exports.setBlockBatch = [
  requirePermission('user.manage'),
  handler(async (req, res) => {
    const status = Number(req.body.status);
    const uids = Array.isArray(req.body.uids)
      ? [...new Set(req.body.uids.map((x) => parseInt(x, 10)).filter((x) => x > 0))]
      : [];
    if (!uids.length || (status !== 0 && status !== 1)) return fail(res, '请确认信息完善');

    const allowed = [];
    for (const uid of uids) {
      const denied = await guardPrivilegedTarget(req, uid);
      if (!denied) allowed.push(uid);
    }
    if (allowed.length) {
      await db.query('UPDATE userInfo SET inUse=? WHERE uid IN (?)', [status, allowed]);
    }
    return ok(res, { success: allowed.length, skipped: uids.length - allowed.length });
  }),
];

exports.updateUserInfo = [
  requirePermission('user.manage'),
  handler(async (req, res) => {
    const info = req.body.info || {};
    const uid = parseInt(info.uid, 10);
    const name = String(info.name || '').trim();
    const email = String(info.email || '').trim();
    if (!uid || !name) return fail(res, '请确认信息完善');
    if (!NAME_REGEX.test(name)) return fail(res, USERNAME_RULE_MESSAGE);
    if (email && !EMAIL_REGEX.test(email)) return fail(res, '请检查邮箱是否合法');
    const denied = await guardPrivilegedTarget(req, uid);
    if (denied) return fail(res, denied);
    const before = await db.one('SELECT name,email FROM userInfo WHERE uid=?', [uid]);
    if (!before) return fail(res, '用户不存在');
    const nameTaken = await db.exists('SELECT uid FROM userInfo WHERE name=? AND uid<>? LIMIT 1', [name, uid]);
    if (nameTaken) return fail(res, '此用户名已被注册');
    if (email) {
      const emailTaken = await db.exists('SELECT uid FROM userInfo WHERE email=? AND uid<>? LIMIT 1', [email, uid]);
      if (emailTaken) return fail(res, '此邮箱已绑定过其他账号');
    }
    const r = await db.query(
      'UPDATE userInfo SET name=?,email=? WHERE uid=?',
      [name, email, uid]
    );
    if (!r.affectedRows) return fail(res, 'failed');
    if (Number(req.session.uid) === uid) {
      req.session.name = name;
      req.session.email = email;
    }
    const detail = { targetUid: uid };
    if (before.name !== name) detail.name = { old: before.name, new: name };
    if ((before.email || '') !== email) detail.email = { old: before.email || '', new: email };
    recordEvent(req, 'admin.updateUserInfo', detail, uid);
    return ok(res);
  }),
];

exports.addAnnouncement = [
  requirePermission('announcement.manage'),
  handler(async (req, res) => {
    const r = await db.query(
      'INSERT INTO announcement(title,description,weight,time) VALUES (?,?,?,?)',
      ['请输入公告标题', '请输入公告描述', 10, new Date()]
    );
    if (!r.affectedRows) return fail(res, 'error');
    return ok(res, { aid: r.insertId });
  }),
];

exports.updateAnnouncement = [
  requirePermission('announcement.manage'),
  handler(async (req, res) => {
    const info = req.body.info || {};
    const { aid, title, description, weight } = info;
    const r = await db.query(
      'UPDATE announcement SET title=?,description=?,weight=? WHERE aid=?',
      [title, description, weight, aid]
    );
    if (!r.affectedRows) return fail(res, 'failed');
    return ok(res);
  }),
];

exports.listAuditLog = [
  requirePermission('audit.view'),
  handler(async (req, res) => {
    const { offset, limit } = paginate(req, 20);
    const filter = req.body.filter || {};

    const q = (filter.q || '').trim();
    const qLike = q ? `%${q}%` : null;
    const actorUid = filter.actorUid === '' || filter.actorUid == null ? null : Number(filter.actorUid);
    const eventType = filter.eventType === '' || filter.eventType == null ? null : Number(filter.eventType);
    const startTime = filter.startTime ? new Date(filter.startTime) : null;
    const endTime = filter.endTime ? new Date(filter.endTime) : null;
    const eventIds = q
      ? eventList
        .map((key, id) => ({ id, key, name: eventExp[id] || '' }))
        .filter((e) => e.key.includes(q) || e.name.includes(q))
        .map((e) => e.id)
      : [];
    const qClause = eventIds.length
      ? `(a.event IN (${eventIds.map(() => '?').join(',')}) OR u.name LIKE ? OR a.ip LIKE ? OR a.iploc LIKE ? OR a.browser LIKE ? OR a.os LIKE ? OR a.detail LIKE ?)`
      : '(u.name LIKE ? OR a.ip LIKE ? OR a.iploc LIKE ? OR a.browser LIKE ? OR a.os LIKE ? OR a.detail LIKE ?)';
    const qValues = eventIds.length
      ? [...eventIds, qLike, qLike, qLike, qLike, qLike, qLike]
      : [qLike, qLike, qLike, qLike, qLike, qLike];
    const { where, params } = buildWhere([
      Number.isNaN(actorUid) ? null : ['a.uid=?', actorUid],
      Number.isNaN(eventType) ? null : ['a.event=?', eventType],
      startTime && !Number.isNaN(startTime.getTime()) ? ['a.time>=?', startTime] : null,
      endTime && !Number.isNaN(endTime.getTime()) ? ['a.time<=?', endTime] : null,
      q ? [qClause, ...qValues] : null,
    ]);

    const list = await db.query(
      `SELECT a.uid, u.name AS actorName, a.event, a.ip, a.iploc, a.time, a.browser, a.os, a.detail
       FROM userAudit a LEFT JOIN userInfo u ON u.uid = a.uid${where}
       ORDER BY a.id DESC LIMIT ?,?`,
      [...params, offset, limit]
    );
    const cnt = await db.one(
      `SELECT COUNT(*) AS total FROM userAudit a LEFT JOIN userInfo u ON u.uid = a.uid${where}`,
      params
    );
    for (const r of list) {
      r.eventKey = eventList[r.event] || `event_${r.event}`;
      r.eventName = eventExp[r.event] || r.eventKey;
      if (r.time) r.time = Format(r.time);
      if (r.detail) {
        try { r.detail = JSON.parse(r.detail); } catch (_) {}
      }
    }
    return ok(res, { total: cnt.total, list, eventList, eventExp });
  }),
];

exports.getUserLoginLog = [
  requirePermission(['user.manage', 'user.role.admin']),
  handler(async (req, res) => {
    const uid = parseInt(req.body.uid, 10);
    if (!uid) return fail(res, '请确认信息完善');
    const list = await db.query(
      `SELECT token, browser, os, loginIp, loginLoc, time, lastact
       FROM userSession WHERE uid=? ORDER BY time DESC LIMIT 20`,
      [uid]
    );
    for (const r of list) {
      delete r.token;
      if (r.time) r.time = Format(r.time);
      if (r.lastact) r.lastact = Format(r.lastact);
    }
    return ok(res, { list });
  }),
];

exports.resetPassword = [
  requirePermission('user.manage'),
  handler(async (req, res) => {
    const bcrypt = require('bcryptjs');
    const uid = parseInt(req.body.uid, 10);
    if (!uid) return fail(res, '请确认信息完善');
    const denied = await guardPrivilegedTarget(req, uid);
    if (denied) return fail(res, denied);
    const newPwd = Math.random().toString(36).slice(2, 10);
    const hash = bcrypt.hashSync(newPwd, 12);
    const r = await db.query('UPDATE userInfo SET pwd=? WHERE uid=?', [hash, uid]);
    if (!r.affectedRows) return fail(res, '用户不存在');
    return ok(res, { newPassword: newPwd });
  }),
];

exports.getAdminStats = handler(async (req, res) => {
  if (!req.can('user.manage') && !req.can('user.role.admin'))
    return res.status(403).end('403 Forbidden');
  const [total, withRoles, banned, grantCount] = await Promise.all([
    db.one('SELECT COUNT(*) AS cnt FROM userInfo'),
    db.one('SELECT COUNT(DISTINCT uid) AS cnt FROM user_roles'),
    db.one('SELECT COUNT(*) AS cnt FROM userInfo WHERE inUse=0'),
    db.one('SELECT COUNT(*) AS cnt FROM user_permissions'),
  ]);
  return ok(res, {
    totalUsers: total.cnt,
    withRoles: withRoles.cnt,
    banned: banned.cnt,
    grantCount: grantCount.cnt,
  });
});

const probeSandbox = async () => {
  const started = Date.now();
  try {
    const run = await sandboxClient.runOne({
        command: ['/bin/true'],
        env: ['PATH=/usr/bin:/bin'],
        stdio: [{ content: '' }, { name: 'stdout', max: 1024 }, { name: 'stderr', max: 1024 }],
        limits: { cpuMs: 1000, wallMs: 2000, memoryMB: 64, stackMB: 64, processes: 10 },
      }, { timeout: 1500 });
    return {
      ok: run && run.status === 'Accepted',
      latency: Date.now() - started,
      status: run ? run.status : 'No Result',
      message: run && run.error ? run.error : '',
    };
  } catch (err) {
    return {
      ok: false,
      latency: Date.now() - started,
      status: 'Unavailable',
      message: err.message || 'sandbox unavailable',
    };
  }
};

// 探针会向 sandbox 真实提交一个任务。多个监控页 / 多管理员同时轮询时，缓存
// 结果一小段时间，避免每次请求都给沙箱加压、与真实评测抢并发。
const SANDBOX_PROBE_TTL = 15_000;
let sandboxProbeCache = { at: 0, value: null, inflight: null };
const probeSandboxCached = async () => {
  const now = Date.now();
  if (sandboxProbeCache.value && now - sandboxProbeCache.at < SANDBOX_PROBE_TTL) {
    return sandboxProbeCache.value;
  }
  // 合并并发请求：TTL 内只有一个真实探针在飞。
  if (!sandboxProbeCache.inflight) {
    sandboxProbeCache.inflight = probeSandbox()
      .then((value) => {
        sandboxProbeCache = { at: Date.now(), value, inflight: null };
        return value;
      })
      .catch((err) => {
        sandboxProbeCache.inflight = null;
        throw err;
      });
  }
  return sandboxProbeCache.inflight;
};

exports.getJudgeMonitor = [
  requirePermission(judgeMonitorPermission),
  handler(async (req, res) => {
    const queue = require('../judge/core').getJudgeQueueStats();
    const [sandbox, statusRows, recentFailures, machineRows, throughput, clientRows] = await Promise.all([
      probeSandboxCached(),
      db.query(
        'SELECT judgeResult, COUNT(*) AS cnt FROM submission WHERE judgeResult IN (0,1,2,12,16) GROUP BY judgeResult ORDER BY judgeResult'
      ),
      db.query(
        `SELECT s.sid,s.pid,s.uid,s.judgeResult,s.score,s.submitTime,s.machine,u.name,p.title
           FROM submission s
           INNER JOIN userInfo u ON u.uid=s.uid
           INNER JOIN problem p ON p.pid=s.pid
          WHERE s.judgeResult IN (12,16)
          ORDER BY s.sid DESC LIMIT 10`
      ),
      db.query(
        `SELECT COALESCE(machine, '未分配') AS machine, COUNT(*) AS cnt, MAX(submitTime) AS lastSubmit
           FROM submission
          WHERE submitTime >= DATE_SUB(NOW(), INTERVAL 1 DAY)
          GROUP BY COALESCE(machine, '未分配')
          ORDER BY cnt DESC`
      ),
      db.one(
        `SELECT
           SUM(submitTime >= DATE_SUB(NOW(), INTERVAL 1 HOUR)) AS lastHour,
           SUM(DATE(submitTime)=CURDATE()) AS today,
           COUNT(*) AS total
         FROM submission`
      ),
      judgeClients.listClients(),
    ]);

    for (const r of recentFailures) {
      r.judgeResult = judgeRes[r.judgeResult] || `Result ${r.judgeResult}`;
      if (r.submitTime) r.submitTime = Format(r.submitTime);
    }
    for (const r of machineRows) {
      if (r.lastSubmit) r.lastSubmit = Format(r.lastSubmit);
    }

    return ok(res, {
      data: {
        queue,
        sandbox,
        statuses: statusRows.map((r) => ({
          resultId: r.judgeResult,
          result: judgeRes[r.judgeResult] || `Result ${r.judgeResult}`,
          cnt: r.cnt,
        })),
        recentFailures,
        machines: machineRows,
        clients: clientRows.map((row) => judgeClients.formatClient(row)),
        canManageJudgeClients: req.can('judge.client.manage'),
        throughput: {
          lastHour: Number(throughput.lastHour || 0),
          today: Number(throughput.today || 0),
          total: Number(throughput.total || 0),
        },
        refreshedAt: Format(new Date()),
      },
    });
  }),
];

exports.listJudgeClients = [
  requirePermission(judgeMonitorPermission),
  handler(async (req, res) => {
    const rows = await judgeClients.listClients();
    return ok(res, { data: rows.map((row) => judgeClients.formatClient(row)) });
  }),
];

exports.createJudgeClient = [
  requirePermission(judgeClientPermission),
  handler(async (req, res) => {
    const { error, patch } = validateJudgeClientInput(req.body || {});
    if (error) return fail(res, error);
    try {
      const { client, clientKey } = await judgeClients.createClient(patch);
      return ok(res, { data: judgeClients.formatClient(client), clientKey });
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY') return fail(res, '评测机名称已存在');
      throw err;
    }
  }),
];

exports.updateJudgeClient = [
  requirePermission(judgeClientPermission),
  handler(async (req, res) => {
    const id = parseInt(req.body.id, 10);
    if (!id) return fail(res, '评测机 ID 无效');
    const { error, patch } = validateJudgeClientInput(req.body || {}, true);
    if (error) return fail(res, error);
    if (typeof req.body.enabled === 'boolean' || req.body.enabled === 0 || req.body.enabled === 1) {
      patch.enabled = !!req.body.enabled;
    }
    try {
      const client = await judgeClients.updateClient(id, patch);
      if (!client) return fail(res, '未找到评测机');
      return ok(res, { data: judgeClients.formatClient(client) });
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY') return fail(res, '评测机名称已存在');
      throw err;
    }
  }),
];

exports.resetJudgeClientKey = [
  requirePermission(judgeClientPermission),
  handler(async (req, res) => {
    const id = parseInt(req.body.id, 10);
    if (!id) return fail(res, '评测机 ID 无效');
    const result = await judgeClients.resetClientKey(id);
    if (!result) return fail(res, '未找到评测机');
    return ok(res, { data: judgeClients.formatClient(result.client), clientKey: result.clientKey });
  }),
];

exports.deleteJudgeClient = [
  requirePermission(judgeClientPermission),
  handler(async (req, res) => {
    const id = parseInt(req.body.id, 10);
    if (!id) return fail(res, '评测机 ID 无效');
    const result = await judgeClients.deleteClient(id);
    if (!result.affectedRows) return fail(res, '未找到评测机');
    return ok(res);
  }),
];
