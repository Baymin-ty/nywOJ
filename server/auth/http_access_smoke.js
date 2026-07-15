// HTTP-level access smoke tests for auth/RBAC.
//
// This script seeds temporary users/resources, creates real express-session
// rows, then calls the running API over HTTP. If port 1234 is not already
// serving nywOJ, it starts server/app.js and shuts it down after the run.
//
//   node server/auth/http_access_smoke.js

const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const signature = require('cookie-signature');
const { sessionSecret } = require('../sessionSecret');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SERVER_ROOT = path.join(__dirname, '..');
const BASE = process.env.NYWOJ_HTTP_BASE || 'http://127.0.0.1:1234';
const SESSION_COOKIE = 'token';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

process.chdir(REPO_ROOT);

const db = require('../db');
const { syncPermissionCatalog } = require('./sync');
const { profileForType } = require('../api/problem/judgeProfile');

const state = {
  uids: [],
  sids: [],
  pids: [],
  cids: [],
  gids: [],
};

let pass = 0;
let fail = 0;
const results = [];

const ok = (name) => {
  pass += 1;
  results.push(['ok  ', name]);
};

const ko = (name, detail) => {
  fail += 1;
  results.push(['FAIL', detail ? `${name} -- ${detail}` : name]);
};

const assert = (name, condition, detail) => {
  if (condition) ok(name);
  else ko(name, detail || 'assertion failed');
};

const expectStatus = (name, res, status) => {
  assert(name, res.status === status, `expected HTTP ${status}, got ${res.status}; body=${JSON.stringify(res.body)}`);
};

const rand = (prefix) => `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
const tempUsername = (label) => {
  const compact = String(label || 'u').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return `_ht_${compact}_${crypto.randomBytes(4).toString('hex')}`;
};

const q = async (sql, params) => db.query(sql, params);
const one = async (sql, params) => db.one(sql, params);

const post = (identity, apiPath, body = {}) => request(identity, 'POST', apiPath, body);

const request = async (identity, method, apiPath, body) => {
  const headers = {
    referer: 'http://localhost/',
    'user-agent': 'nywOJ-http-access-smoke/1.0',
  };
  const init = { method, headers };
  if (identity && identity.cookie) headers.cookie = identity.cookie;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${apiPath}`, init);
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (_) {
    parsed = text;
  }
  return { status: res.status, body: parsed, text };
};

const isServerUp = async () => {
  try {
    const res = await fetch(`${BASE}/api/common/getHomeConfig`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', referer: 'http://localhost/' },
      body: '{}',
    });
    return res.status < 500;
  } catch (_) {
    return false;
  }
};

const ensureServer = async () => {
  if (await isServerUp()) return null;

  const child = spawn(process.execPath, ['app.js'], {
    cwd: SERVER_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk.toString(); });
  child.stderr.on('data', (chunk) => { log += chunk.toString(); });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`server exited early (${child.exitCode}): ${log}`);
    if (await isServerUp()) return child;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  try { child.kill(); } catch (_) { /* best effort */ }
  throw new Error(`server did not become ready: ${log}`);
};

const stopServer = async (child) => {
  if (!child) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) { /* best effort */ }
      resolve();
    }, 2500);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
};

const roleIds = async (keys) => {
  if (!keys.length) return [];
  const rows = await q('SELECT id, `key` FROM roles WHERE `key` IN (?)', [keys]);
  const byKey = new Map(rows.map((row) => [row.key, row.id]));
  const missing = keys.filter((key) => !byKey.has(key));
  if (missing.length) throw new Error(`missing roles: ${missing.join(', ')}`);
  return keys.map((key) => byKey.get(key));
};

const createUser = async (label, roles = []) => {
  const name = tempUsername(label);
  const pwd = bcrypt.hashSync('access-smoke-password', 4);
  const r = await q(
    'INSERT INTO userInfo(name, pwd, email, reg_time, inUse) VALUES (?,?,?,?,1)',
    [name, pwd, `${name}@example.test`, new Date()]
  );
  state.uids.push(r.insertId);
  const ids = await roleIds(roles);
  if (ids.length) {
    await q('INSERT INTO user_roles(uid, role_id, granted_by) VALUES ?', [
      ids.map((id) => [r.insertId, id, 1]),
    ]);
  }
  return { uid: r.insertId, name };
};

const createSession = async (user) => {
  const sid = `http-smoke-${crypto.randomUUID()}`;
  const expires = Math.floor((Date.now() + SESSION_MAX_AGE_MS) / 1000);
  const data = {
    cookie: {
      originalMaxAge: SESSION_MAX_AGE_MS,
      expires: new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString(),
      httpOnly: true,
      path: '/',
    },
    uid: user.uid,
    name: user.name,
    ip: '127.0.0.1',
  };
  await q('INSERT INTO sessions(session_id, expires, data) VALUES (?,?,?)', [
    sid,
    expires,
    JSON.stringify(data),
  ]);
  state.sids.push(sid);
  const signed = `s:${signature.sign(sid, sessionSecret)}`;
  return { ...user, sid, cookie: `${SESSION_COOKIE}=${encodeURIComponent(signed)}` };
};

const createProblem = async ({ ownerUid, isPublic, title }) => {
  const profile = JSON.stringify(profileForType(0));
  const r = await q(
    `INSERT INTO problem(title, description, publisher, time, tags, isPublic, type, judgeProfile)
     VALUES (?,?,?,NOW(),?,?,0,?)`,
    [title || rand('_http_problem'), 'http access smoke problem', ownerUid, '[]', isPublic ? 1 : 0, profile]
  );
  state.pids.push(r.insertId);
  return r.insertId;
};

const createContest = async ({ ownerUid, isPublic, title }) => {
  const r = await q(
    'INSERT INTO contest(title, host, start, length, type, isPublic) VALUES (?,?,?,?,?,?)',
    [title || rand('_http_contest'), ownerUid, new Date(Date.now() + 86400_000), 60, 0, isPublic ? 1 : 0]
  );
  state.cids.push(r.insertId);
  return r.insertId;
};

const createGroupDirect = async (name) => {
  const r = await q(
    'INSERT INTO user_groups(name, memberCnt, createTime) VALUES (?,?,?)',
    [name || rand('_http_group'), 0, new Date()]
  );
  state.gids.push(r.insertId);
  return r.insertId;
};

const cleanup = async () => {
  const safe = (work) => work().catch((err) => console.error('[cleanup]', err.message || err));
  if (state.sids.length) await safe(() => q('DELETE FROM sessions WHERE session_id IN (?)', [state.sids]));
  if (state.pids.length) {
    await safe(() => q('DELETE FROM user_permissions WHERE resource_type=? AND resource_id IN (?)', ['problem', state.pids]));
    await safe(() => q('DELETE FROM group_permissions WHERE resource_type=? AND resource_id IN (?)', ['problem', state.pids]));
    await safe(() => q('DELETE FROM problemSolution WHERE pid IN (?)', [state.pids]));
    await safe(() => q('DELETE FROM problemSample WHERE pid IN (?)', [state.pids]));
    await safe(() => q('DELETE FROM problemCompatMeta WHERE pid IN (?)', [state.pids]));
    await safe(() => q('DELETE FROM problem WHERE pid IN (?)', [state.pids]));
  }
  if (state.cids.length) {
    await safe(() => q('DELETE FROM user_permissions WHERE resource_type=? AND resource_id IN (?)', ['contest', state.cids]));
    await safe(() => q('DELETE FROM group_permissions WHERE resource_type=? AND resource_id IN (?)', ['contest', state.cids]));
    await safe(() => q('DELETE FROM contestPlayer WHERE cid IN (?)', [state.cids]));
    await safe(() => q('DELETE FROM contestProblem WHERE cid IN (?)', [state.cids]));
    await safe(() => q('DELETE FROM contest WHERE cid IN (?)', [state.cids]));
  }
  if (state.gids.length) {
    await safe(() => q('DELETE FROM group_permissions WHERE gid IN (?)', [state.gids]));
    await safe(() => q('DELETE FROM group_members WHERE gid IN (?)', [state.gids]));
    await safe(() => q('DELETE FROM user_groups WHERE gid IN (?)', [state.gids]));
  }
  if (state.uids.length) {
    await safe(() => q('DELETE FROM user_roles WHERE uid IN (?)', [state.uids]));
    await safe(() => q('DELETE FROM user_permissions WHERE uid IN (?)', [state.uids]));
    await safe(() => q('DELETE FROM group_members WHERE uid IN (?)', [state.uids]));
    await safe(() => q('DELETE FROM userInfo WHERE uid IN (?)', [state.uids]));
  }
};

const run = async () => {
  await syncPermissionCatalog();

  const users = {};
  users.normal = await createSession(await createUser('normal'));
  users.viewer = await createSession(await createUser('viewer'));
  users.problemSetter = await createSession(await createUser('problem_setter', ['problem_setter']));
  users.contestManager = await createSession(await createUser('contest_manager', ['contest_manager']));
  users.judgeAdmin = await createSession(await createUser('judge_admin', ['judge_admin']));
  users.solutionAdmin = await createSession(await createUser('solution_admin', ['solution_admin']));
  users.moderator = await createSession(await createUser('moderator', ['moderator']));
  users.superAdmin = await createSession(await createUser('super_admin', ['super_admin']));
  users.target = await createSession(await createUser('target'));

  const publicPid = await createProblem({ ownerUid: users.superAdmin.uid, isPublic: true, title: rand('_http_public_problem') });
  const privatePid = await createProblem({ ownerUid: users.superAdmin.uid, isPublic: false, title: rand('_http_private_problem') });
  const setterOwnPid = await createProblem({ ownerUid: users.problemSetter.uid, isPublic: false, title: rand('_http_setter_problem') });
  const ownerPid = await createProblem({ ownerUid: users.normal.uid, isPublic: false, title: rand('_http_owner_problem') });
  const otherContestCid = await createContest({ ownerUid: users.superAdmin.uid, isPublic: false, title: rand('_http_other_contest') });

  const server = await ensureServer();
  try {
    let res;

    res = await post(null, '/api/auth/listPermissions', {});
    expectStatus('anonymous cannot reach protected auth center route through app gate', res, 404);

    res = await post(users.normal, '/api/auth/listPermissions', {});
    expectStatus('normal user is forbidden from listing permission catalog', res, 403);

    res = await post(users.moderator, '/api/auth/listPermissions', {});
    expectStatus('moderator can list permission catalog via user.manage/group.manage', res, 200);
    assert('permission catalog response contains permissions', Array.isArray(res.body && res.body.permissions), JSON.stringify(res.body));

    res = await post(users.normal, '/api/auth/searchUsers', { q: String(users.superAdmin.uid) });
    expectStatus('logged-in normal user can use user picker', res, 200);
    assert('user picker finds target uid', (res.body.users || []).some((u) => u.uid === users.superAdmin.uid), JSON.stringify(res.body));

    res = await post(null, '/api/auth/searchUsers', { q: String(users.superAdmin.uid) });
    expectStatus('anonymous user picker is blocked by app gate', res, 404);

    res = await post(null, '/api/ide/problemContext', { pid: publicPid });
    expectStatus('anonymous can load public IDE problem context', res, 200);
    assert('public IDE context pid matches', res.body && res.body.data && res.body.data.pid === publicPid, JSON.stringify(res.body));

    res = await post(null, '/api/ide/problemContext', { pid: privatePid });
    expectStatus('anonymous cannot load private IDE problem context', res, 202);
    assert('private IDE context reports permission failure', /权限不足/.test((res.body && res.body.message) || ''), JSON.stringify(res.body));

    res = await post(null, '/api/ide/profileRun', { pid: publicPid, lang: 1, files: ['int main(){return 0;}'] });
    expectStatus('anonymous cannot start IDE profile run', res, 202);
    assert('anonymous profileRun reports login requirement', /请先登录/.test((res.body && res.body.message) || ''), JSON.stringify(res.body));

    res = await post(users.normal, '/api/problem/getProblemInfo', { pid: privatePid });
    expectStatus('normal user cannot read unrelated private problem', res, 202);

    res = await post(users.problemSetter, '/api/problem/getProblemAuth', { pid: privatePid });
    expectStatus('problem_setter can query auth on private problem', res, 200);
    assert('problem_setter can view but not manage other problem',
      res.body && res.body.data && res.body.data.view === true && res.body.data.manage === false,
      JSON.stringify(res.body));

    res = await post(users.problemSetter, '/api/problem/getProblemAuth', { pid: setterOwnPid });
    expectStatus('problem_setter can query auth on own problem', res, 200);
    assert('problem_setter can manage own problem',
      res.body && res.body.data && res.body.data.manage === true,
      JSON.stringify(res.body));

    res = await post(users.problemSetter, '/api/problem/createProblem', {});
    expectStatus('problem_setter can create problem through HTTP route', res, 200);
    assert('createProblem returns pid', res.body && Number(res.body.pid || res.body.id) > 0, JSON.stringify(res.body));
    if (res.body && Number(res.body.pid || res.body.id) > 0) state.pids.push(Number(res.body.pid || res.body.id));

    res = await post(users.normal, '/api/auth/grantUserPermission', {
      uid: users.viewer.uid,
      permissionKey: 'problem.view.any',
      effect: 'allow',
      resourceType: 'problem',
      resourceId: ownerPid,
    });
    expectStatus('resource owner can grant view-only collaborator over HTTP', res, 200);

    res = await post(users.viewer, '/api/problem/getProblemInfo', { pid: ownerPid });
    expectStatus('view-only collaborator can read private problem over HTTP', res, 200);

    res = await post(users.viewer, '/api/auth/grantUserPermission', {
      uid: users.target.uid,
      permissionKey: 'problem.view.any',
      effect: 'allow',
      resourceType: 'problem',
      resourceId: ownerPid,
    });
    expectStatus('view-only collaborator cannot grant another collaborator', res, 403);

    res = await post(users.contestManager, '/api/contest/createContest', {});
    expectStatus('contest_manager can create contest', res, 200);
    assert('createContest returns cid', res.body && Number(res.body.cid) > 0, JSON.stringify(res.body));
    if (res.body && Number(res.body.cid) > 0) state.cids.push(Number(res.body.cid));

    res = await post(users.contestManager, '/api/contest/updateContestInfo', {
      cid: otherContestCid,
      info: {
        title: 'should not update',
        start: new Date(Date.now() + 172800_000).toISOString(),
        length: 90,
        type: 'OI',
        isPublic: false,
      },
    });
    expectStatus('contest_manager cannot manage someone else contest', res, 202);

    res = await post(users.solutionAdmin, '/api/problem/getProblemAuth', { pid: publicPid });
    expectStatus('solution_admin can query public problem auth', res, 200);
    assert('solution_admin gets solutionManage but not problem manage',
      res.body && res.body.data && res.body.data.solutionManage === true && res.body.data.manage === false,
      JSON.stringify(res.body));

    res = await post(users.judgeAdmin, '/api/admin/getJudgeMonitor', {});
    expectStatus('judge_admin can access judge monitor', res, 200);

    res = await post(users.moderator, '/api/auth/setUserRoles', { uid: users.target.uid, roleKeys: ['problem_setter'] });
    expectStatus('moderator cannot assign roles without user.role.admin', res, 403);

    res = await post(users.superAdmin, '/api/auth/setUserRoles', { uid: users.target.uid, roleKeys: ['problem_setter'] });
    expectStatus('super_admin can assign roles', res, 200);

    const gid = await createGroupDirect(rand('_http_group'));
    res = await post(users.moderator, '/api/group/addMember', { gid, uid: users.normal.uid });
    expectStatus('moderator can add group member', res, 200);

    res = await post(users.moderator, '/api/group/grantGroupPermission', {
      gid,
      permissionKey: 'user.manage',
      effect: 'allow',
    });
    expectStatus('moderator can grant group permission', res, 200);

    res = await post(users.normal, '/api/auth/listPermissions', {});
    expectStatus('normal user inherits user.manage through group grant', res, 200);

    const grantRow = await one(
      `SELECT gp.id
         FROM group_permissions gp
         JOIN permissions p ON p.id=gp.permission_id
        WHERE gp.gid=? AND p.\`key\`='user.manage'
        LIMIT 1`,
      [gid]
    );
    res = await post(users.moderator, '/api/group/revokeGroupPermission', { id: grantRow.id });
    expectStatus('moderator can revoke group permission', res, 200);

    res = await post(users.normal, '/api/auth/listPermissions', {});
    expectStatus('normal user loses group-inherited user.manage after revoke', res, 403);
  } finally {
    await stopServer(server);
  }
};

(async () => {
  try {
    await run();
  } catch (err) {
    ko('fatal error', err && err.stack ? err.stack : String(err));
  } finally {
    await cleanup();
    for (const [tag, msg] of results) console.log(`  ${tag} ${msg}`);
    console.log(`\n${pass} passed, ${fail} failed`);
    db.pool.end(() => process.exit(fail ? 1 : 0));
  }
})();
