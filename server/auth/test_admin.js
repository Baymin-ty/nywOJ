// Integration tests for the admin endpoints used by the unified
// permission management page (web/src/components/admin/permissionCenter.vue).
// Runs against the real database in server/config.json.
//
//   node server/auth/test_admin.js

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../db');
const policy = require('./policy');
const { syncPermissionCatalog } = require('./sync');

const admin = require('../api/admin');

let pass = 0, fail = 0;
const results = [];
const ok = (name) => { pass++; results.push(['ok ', name]); };
const ko = (name, err) => { fail++; results.push(['FAIL', `${name} -- ${err && err.message ? err.message : err}`]); };
const assert = (cond, name) => { if (cond) ok(name); else ko(name, 'assertion failed'); };
const assertEq = (a, b, name) => {
  if (a === b) ok(name);
  else ko(name, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const test = async (name, fn) => {
  try { await fn(); }
  catch (err) { ko(name, err); }
};

const makeReq = (uid, perms) => ({
  body: {},
  session: { uid, ip: '127.0.0.1' },
  useragent: { browser: { name: 'test', version: '0' }, os: { name: 'test', version: '0' } },
  can: (key, scope) => policy.can(perms, key, scope),
  perms,
});
const fakeRes = () => {
  const r = {
    statusCode: 200,
    payload: null,
    status(s) { r.statusCode = s; return r; },
    send(p) { r.payload = p; return r; },
    end() { r.payload = null; return r; },
  };
  return r;
};
const runHandler = async (handler, req) => {
  const fns = Array.isArray(handler) ? handler : [handler];
  const res = fakeRes();
  for (const fn of fns) {
    let nextCalled = false;
    await new Promise((resolve) => {
      const next = () => { nextCalled = true; resolve(); };
      const ret = fn(req, res, next);
      if (ret && typeof ret.then === 'function') ret.then(() => { if (!nextCalled) resolve(); });
      else if (!nextCalled) resolve();
    });
    if (res.statusCode >= 400 || res.payload != null) break;
  }
  return res;
};

let createdUids = [];
const mkUser = async (roleKeys = [], banned = false) => {
  const r = await db.query(
    'INSERT INTO userInfo(name, pwd, reg_time, inUse) VALUES (?,?,NOW(),?)',
    ['_ta_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), 'x', banned ? 0 : 1]
  );
  createdUids.push(r.insertId);
  if (roleKeys.length) {
    const rolesRows = await db.query('SELECT id, `key` FROM roles WHERE `key` IN (?)', [roleKeys]);
    const values = rolesRows.map((row) => [r.insertId, row.id, null]);
    await db.query('INSERT INTO user_roles (uid, role_id, granted_by) VALUES ?', [values]);
  }
  return r.insertId;
};
const cleanupSandbox = async () => {
  if (createdUids.length) {
    await db.query('DELETE FROM userInfo WHERE uid IN (?)', [createdUids]);
  }
};

(async () => {
  try {
    await syncPermissionCatalog();

    // ----- seed: create a super_admin user, a normal user, a banned user -----
    let superUid, normalUid, modUid, bannedUid;
    await test('seed sandbox users', async () => {
      superUid = await mkUser(['super_admin']);
      modUid = await mkUser(['moderator']);
      normalUid = await mkUser([]);
      bannedUid = await mkUser([], true);
    });

    const superPerms = await policy.loadEffectivePermissions(superUid);
    const modPerms = await policy.loadEffectivePermissions(modUid);
    const normalPerms = await policy.loadEffectivePermissions(normalUid);

    // ============================================================
    //   1. getUserInfoList — enhanced response
    // ============================================================

    await test('getUserInfoList: basic listing returns the new fields', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { pageId: 1, pageSize: 50 };
      const res = await runHandler(admin.getUserInfoList, req);
      assertEq(res.statusCode, 200, 'status 200');
      const list = res.payload.userList;
      assert(Array.isArray(list), 'userList is array');
      const me = list.find((u) => u.uid === superUid);
      assert(me, 'super user present');
      assert(typeof me.solved === 'number', 'solved is a number');
      assert('regDate' in me, 'regDate field present');
      assert('lastLogin' in me, 'lastLogin field present');
      assert('grantCount' in me, 'grantCount field present');
      assert(Array.isArray(me.roles), 'roles array present');
      assert(me.roles.includes('super_admin'), 'super_admin role attached');
    });

    await test('getUserInfoList: filter by uid', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { filter: { uid: normalUid } };
      const res = await runHandler(admin.getUserInfoList, req);
      assertEq(res.statusCode, 200, 'status 200');
      assertEq(res.payload.userList.length, 1, 'exactly one row');
      assertEq(res.payload.userList[0].uid, normalUid, 'matches uid');
    });

    await test('getUserInfoList: filter by roleKey returns only users with that role', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { pageSize: 100, filter: { roleKey: 'moderator' } };
      const res = await runHandler(admin.getUserInfoList, req);
      assertEq(res.statusCode, 200, 'status 200');
      assert(res.payload.userList.some((u) => u.uid === modUid), 'modUid included');
      assert(!res.payload.userList.some((u) => u.uid === normalUid), 'normalUid excluded');
      // every returned row should actually have moderator
      for (const u of res.payload.userList) {
        assert(u.roles.includes('moderator'), `uid=${u.uid} has moderator role`);
      }
    });

    await test('getUserInfoList: filter roleKey=__none__ excludes role-bearing users', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { pageSize: 100, filter: { roleKey: '__none__' } };
      const res = await runHandler(admin.getUserInfoList, req);
      assertEq(res.statusCode, 200, 'status 200');
      assert(res.payload.userList.some((u) => u.uid === normalUid), 'normalUid included');
      assert(!res.payload.userList.some((u) => u.uid === modUid), 'modUid excluded');
      for (const u of res.payload.userList) {
        assertEq(u.roles.length, 0, `uid=${u.uid} has no roles`);
      }
    });

    await test('getUserInfoList: filter inUse=0 returns banned users', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { pageSize: 100, filter: { inUse: 0 } };
      const res = await runHandler(admin.getUserInfoList, req);
      assertEq(res.statusCode, 200, 'status 200');
      assert(res.payload.userList.some((u) => u.uid === bannedUid), 'bannedUid included');
      assert(!res.payload.userList.some((u) => u.uid === normalUid), 'normalUid excluded');
      for (const u of res.payload.userList) assertEq(u.inUse, 0, `uid=${u.uid} is banned`);
    });

    await test('getUserInfoList: filter inUse=1 returns active users', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { pageSize: 100, filter: { inUse: 1 } };
      const res = await runHandler(admin.getUserInfoList, req);
      assertEq(res.statusCode, 200, 'status 200');
      assert(!res.payload.userList.some((u) => u.uid === bannedUid), 'bannedUid excluded');
      for (const u of res.payload.userList) assertEq(u.inUse, 1, `uid=${u.uid} is active`);
    });

    await test('getUserInfoList: sort by uid desc', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { pageSize: 5, sort: { key: 'uid', dir: 'desc' } };
      const res = await runHandler(admin.getUserInfoList, req);
      assertEq(res.statusCode, 200, 'status 200');
      const uids = res.payload.userList.map((u) => u.uid);
      const sorted = [...uids].sort((a, b) => b - a);
      assert(uids.every((v, i) => v === sorted[i]), 'uids sorted descending');
    });

    await test('getUserInfoList: sort by lastLogin/solved/name without SQL error', async () => {
      for (const key of ['lastLogin', 'solved', 'name']) {
        const req = makeReq(superUid, superPerms);
        req.body = { pageSize: 5, sort: { key, dir: 'asc' } };
        const res = await runHandler(admin.getUserInfoList, req);
        assertEq(res.statusCode, 200, `status 200 (sort by ${key})`);
      }
    });

    await test('getUserInfoList: rejected for user without user.list', async () => {
      const req = makeReq(normalUid, normalPerms);
      req.body = {};
      const res = await runHandler(admin.getUserInfoList, req);
      assertEq(res.statusCode, 403, 'status 403');
    });

    await test('getUserInfoList: q matches numeric-prefixed name (regression: previously treated "1" as exact uid)', async () => {
      // Seed a user whose name starts with "11451" — searching '11451' should
      // find it via name LIKE, not be misinterpreted as uid=11451.
      const r = await db.query(
        'INSERT INTO userInfo(name, pwd, reg_time, inUse) VALUES (?,?,NOW(),1)',
        ['_ta_11451' + Math.random().toString(36).slice(2, 6), 'x']
      );
      const seedUid = r.insertId;
      createdUids.push(seedUid);
      try {
        const req = makeReq(superUid, superPerms);
        req.body = { pageSize: 50, filter: { q: '11451' } };
        const res = await runHandler(admin.getUserInfoList, req);
        assertEq(res.statusCode, 200, 'status 200');
        assert(res.payload.userList.some((u) => u.uid === seedUid), 'seeded user found by name-prefix q');
      } finally {
        await db.query('DELETE FROM userInfo WHERE uid=?', [seedUid]);
      }
    });

    await test('getUserInfoList: q matches by email substring', async () => {
      const r = await db.query(
        'INSERT INTO userInfo(name, pwd, email, reg_time, inUse) VALUES (?,?,?,NOW(),1)',
        ['_ta_email_' + Math.random().toString(36).slice(2, 6), 'x', 'unique_xyz_test@nyw.example']
      );
      const seedUid = r.insertId;
      createdUids.push(seedUid);
      try {
        const req = makeReq(superUid, superPerms);
        req.body = { pageSize: 50, filter: { q: 'unique_xyz_test' } };
        const res = await runHandler(admin.getUserInfoList, req);
        assertEq(res.statusCode, 200, 'status 200');
        assertEq(res.payload.total, 1, 'exactly one match');
        assertEq(res.payload.userList[0].uid, seedUid, 'matches by email substring');
      } finally {
        await db.query('DELETE FROM userInfo WHERE uid=?', [seedUid]);
      }
    });

    await test('getUserInfoList: q with pure-number also matches uid', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { filter: { q: String(normalUid) } };
      const res = await runHandler(admin.getUserInfoList, req);
      assertEq(res.statusCode, 200, 'status 200');
      assert(res.payload.userList.some((u) => u.uid === normalUid), 'numeric q matches uid');
    });

    await test('getUserInfoList: solved counts judgeResult=4 (Accepted)', async () => {
      // Insert one AC submission for normalUid
      const sub = await db.query(
        `INSERT INTO submission (uid, pid, code, judgeResult, time, memory, score, submitTime, codeLength, lang)
         VALUES (?, 1, 'x', 4, 0, 0, 100, NOW(), 1, 1)`,
        [normalUid]
      );
      const sid = sub.insertId;
      try {
        const req = makeReq(superUid, superPerms);
        req.body = { filter: { uid: normalUid } };
        const res = await runHandler(admin.getUserInfoList, req);
        assertEq(res.statusCode, 200, 'status 200');
        const me = res.payload.userList[0];
        assert(me.solved >= 1, `solved >=1, got ${me.solved}`);
      } finally {
        await db.query('DELETE FROM submission WHERE sid=?', [sid]);
      }
    });

    await test('getUserInfoList: grantCount reflects user_permissions rows', async () => {
      // Grant two distinct allows to normalUid
      const perms = await db.query(
        "SELECT id FROM permissions WHERE `key` IN ('contest.create', 'announcement.manage')"
      );
      for (const p of perms) {
        await db.query(
          `INSERT INTO user_permissions (uid, permission_id, effect, resource_type, resource_id) VALUES (?,?, 'allow', NULL, NULL)
           ON DUPLICATE KEY UPDATE granted_at=CURRENT_TIMESTAMP`,
          [normalUid, p.id]
        );
      }
      try {
        const req = makeReq(superUid, superPerms);
        req.body = { filter: { uid: normalUid } };
        const res = await runHandler(admin.getUserInfoList, req);
        const me = res.payload.userList[0];
        assert(me.grantCount >= 2, `grantCount >=2, got ${me.grantCount}`);
      } finally {
        await db.query('DELETE FROM user_permissions WHERE uid=?', [normalUid]);
        policy.invalidate(normalUid);
      }
    });

    // ============================================================
    //   2. listAuditLog
    // ============================================================

    await test('listAuditLog: rejected without audit.view', async () => {
      const req = makeReq(modUid, modPerms);
      const res = await runHandler(admin.listAuditLog, req);
      assertEq(res.statusCode, 403, 'status 403 for moderator (no audit.view)');
    });

    await test('listAuditLog: super_admin gets the list', async () => {
      // Seed an audit row so the list isn't empty
      await db.query(
        `INSERT INTO userAudit(uid, event, ip, iploc, time, browser, os) VALUES (?, 0, '127.0.0.1', '本地', NOW(), 'test', 'test')`,
        [superUid]
      );
      const req = makeReq(superUid, superPerms);
      const res = await runHandler(admin.listAuditLog, req);
      assertEq(res.statusCode, 200, 'status 200');
      assert(Array.isArray(res.payload.list), 'list is array');
      assert(res.payload.total >= 1, 'total >= 1');
      assert(Array.isArray(res.payload.eventList), 'eventList exposed');
      const sample = res.payload.list[0];
      assert('eventKey' in sample && 'eventName' in sample, 'eventKey/eventName decoded');
    });

    await test('listAuditLog: filter by actorUid', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { filter: { actorUid: superUid } };
      const res = await runHandler(admin.listAuditLog, req);
      assertEq(res.statusCode, 200, 'status 200');
      for (const r of res.payload.list) assertEq(r.uid, superUid, 'all rows match actorUid');
    });

    // ============================================================
    //   3. getUserLoginLog
    // ============================================================

    await test('getUserLoginLog: rejected without user.list', async () => {
      const req = makeReq(normalUid, normalPerms);
      req.body = { uid: normalUid };
      const res = await runHandler(admin.getUserLoginLog, req);
      assertEq(res.statusCode, 403, 'status 403');
    });

    await test('getUserLoginLog: missing uid → fail', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = {};
      const res = await runHandler(admin.getUserLoginLog, req);
      assertEq(res.statusCode, 202, 'status 202 (validation error)');
    });

    await test('getUserLoginLog: returns sessions with no token leakage', async () => {
      await db.query(
        `INSERT INTO userSession(uid, token, browser, os, loginIp, loginLoc, time, lastact)
         VALUES (?, 'tok_test_xx', 'chrome', 'mac', '127.0.0.1', '本地', NOW(), NOW())`,
        [normalUid]
      );
      try {
        const req = makeReq(superUid, superPerms);
        req.body = { uid: normalUid };
        const res = await runHandler(admin.getUserLoginLog, req);
        assertEq(res.statusCode, 200, 'status 200');
        assert(Array.isArray(res.payload.list), 'list array');
        assert(res.payload.list.length >= 1, 'has the seeded session');
        for (const r of res.payload.list) {
          assert(!('token' in r), 'token field stripped');
          assert(typeof r.loginIp === 'string', 'loginIp present');
        }
      } finally {
        await db.query('DELETE FROM userSession WHERE token=?', ['tok_test_xx']);
      }
    });

    // ============================================================
    //   4. resetPassword
    // ============================================================

    await test('resetPassword: rejected without user.edit', async () => {
      const req = makeReq(normalUid, normalPerms);
      req.body = { uid: normalUid };
      const res = await runHandler(admin.resetPassword, req);
      assertEq(res.statusCode, 403, 'status 403');
    });

    await test('resetPassword: missing uid → fail', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = {};
      const res = await runHandler(admin.resetPassword, req);
      assertEq(res.statusCode, 202, 'status 202 (validation error)');
    });

    await test('resetPassword: writes a new bcrypt hash and returns plaintext', async () => {
      const before = await db.one('SELECT pwd FROM userInfo WHERE uid=?', [normalUid]);
      const req = makeReq(superUid, superPerms);
      req.body = { uid: normalUid };
      const res = await runHandler(admin.resetPassword, req);
      assertEq(res.statusCode, 200, 'status 200');
      assert(typeof res.payload.newPassword === 'string', 'newPassword string returned');
      assert(res.payload.newPassword.length > 0, 'newPassword non-empty');
      const after = await db.one('SELECT pwd FROM userInfo WHERE uid=?', [normalUid]);
      assert(after.pwd !== before.pwd, 'pwd hash changed in DB');
      const bcrypt = require('bcryptjs');
      assert(bcrypt.compareSync(res.payload.newPassword, after.pwd), 'new plaintext matches stored hash');
    });

    await test('resetPassword: nonexistent uid → fail', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { uid: 999999999 };
      const res = await runHandler(admin.resetPassword, req);
      assertEq(res.statusCode, 202, 'status 202 (user does not exist)');
    });

    // ============================================================
    //   5. getAdminStats
    // ============================================================

    await test('getAdminStats: rejected without user.list', async () => {
      const req = makeReq(normalUid, normalPerms);
      const res = await runHandler(admin.getAdminStats, req);
      assertEq(res.statusCode, 403, 'status 403');
    });

    await test('getAdminStats: super_admin gets the four counts', async () => {
      const req = makeReq(superUid, superPerms);
      const res = await runHandler(admin.getAdminStats, req);
      assertEq(res.statusCode, 200, 'status 200');
      const p = res.payload;
      assert(typeof p.totalUsers === 'number' && p.totalUsers >= 4, `totalUsers >=4 (got ${p.totalUsers})`);
      assert(typeof p.withRoles === 'number' && p.withRoles >= 2, `withRoles >=2 (got ${p.withRoles})`);
      assert(typeof p.banned === 'number' && p.banned >= 1, `banned >=1 (got ${p.banned})`);
      assert(typeof p.grantCount === 'number', 'grantCount is a number');
    });

    // ============================================================
    //   6. setBlock + updateUserInfo (regression: existing endpoints still work)
    // ============================================================

    await test('setBlock: ban then unban a user', async () => {
      const r1 = makeReq(superUid, superPerms);
      r1.body = { uid: normalUid, status: 0 };
      const res1 = await runHandler(admin.setBlock, r1);
      assertEq(res1.statusCode, 200, 'ban ok');
      const after1 = await db.one('SELECT inUse FROM userInfo WHERE uid=?', [normalUid]);
      assertEq(after1.inUse, 0, 'inUse=0 after ban');

      const r2 = makeReq(superUid, superPerms);
      r2.body = { uid: normalUid, status: 1 };
      const res2 = await runHandler(admin.setBlock, r2);
      assertEq(res2.statusCode, 200, 'unban ok');
      const after2 = await db.one('SELECT inUse FROM userInfo WHERE uid=?', [normalUid]);
      assertEq(after2.inUse, 1, 'inUse=1 after unban');
    });

    await test('updateUserInfo: writes new name + email', async () => {
      const newName = '_ta_renamed_' + Math.random().toString(36).slice(2, 6);
      const req = makeReq(superUid, superPerms);
      req.body = { info: { uid: normalUid, name: newName, email: 'a@b.cc' } };
      const res = await runHandler(admin.updateUserInfo, req);
      assertEq(res.statusCode, 200, 'status 200');
      const row = await db.one('SELECT name, email FROM userInfo WHERE uid=?', [normalUid]);
      assertEq(row.name, newName, 'name updated');
      assertEq(row.email, 'a@b.cc', 'email updated');
    });
  } catch (err) {
    console.error('FATAL:', err && err.stack ? err.stack : err);
    fail++;
  } finally {
    await cleanupSandbox().catch((e) => console.error('cleanup error:', e));
    for (const [tag, msg] of results) {
      console.log(`  ${tag} ${msg}`);
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    db.pool.end(() => process.exit(fail ? 1 : 0));
  }
})();
