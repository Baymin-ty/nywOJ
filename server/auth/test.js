// Integration tests for the RBAC permission system. Runs against the real
// database in server/config.json. The legacy `userInfo.gid` column is dropped
// during sync (one-time on first start), so this test seeds users without gid
// and assigns roles directly via user_roles.
//
//   node server/auth/test.js

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../db');
const policy = require('./policy');
const { syncPermissionCatalog } = require('./sync');
const { PERMISSIONS, BUILTIN_ROLES, RESOURCE_GRANTABLE } = require('./permissions');

const auth = require('../api/auth');

let pass = 0, fail = 0;
const results = [];
const ok = (name) => { pass++; results.push(['ok ', name]); };
const ko = (name, err) => { fail++; results.push(['FAIL', `${name} -- ${err && err.message ? err.message : err}`]); };
const assert = (cond, name) => { if (cond) ok(name); else ko(name, 'assertion failed'); };
const assertEq = (a, b, name) => {
  if (a === b) ok(name);
  else ko(name, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const assertSetEq = (got, want, name) => {
  const A = new Set(got), B = new Set(want);
  if (A.size !== B.size) return ko(name, `size ${A.size} vs ${B.size}; got=${[...A]} want=${[...B]}`);
  for (const x of B) if (!A.has(x)) return ko(name, `missing ${x}; got=${[...A]}`);
  ok(name);
};
const test = async (name, fn) => {
  try { await fn(); }
  catch (err) { ko(name, err); }
};

// ----- fake req helpers -----
const makeReq = (uid, perms) => ({
  body: {},
  // recordEvent reads ip + useragent; provide harmless defaults so handlers
  // don't crash inside the audit-log path during tests.
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

// ----- sandbox helpers -----
let createdUids = [];

const mkUser = async (roleKeys = []) => {
  const r = await db.query(
    'INSERT INTO userInfo(name, pwd, reg_time, inUse) VALUES (?,?,NOW(),1)',
    ['_t_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), 'x']
  );
  createdUids.push(r.insertId);
  if (roleKeys.length) {
    const rolesRows = await db.query('SELECT id, `key` FROM roles WHERE `key` IN (?)', [roleKeys]);
    if (rolesRows.length !== roleKeys.length) {
      throw new Error('unknown role: ' + roleKeys.filter((k) => !rolesRows.some((r) => r.key === k)).join(','));
    }
    const values = rolesRows.map((row) => [r.insertId, row.id, null]);
    await db.query('INSERT INTO user_roles (uid, role_id, granted_by) VALUES ?', [values]);
  }
  return r.insertId;
};

const cleanupSandbox = async () => {
  if (createdUids.length) {
    await db.query('DELETE FROM userInfo WHERE uid IN (?)', [createdUids]);
  }
  await db.query("DELETE FROM roles WHERE `key` LIKE 'test\\_%' ESCAPE '\\\\'");
};

// ============================================================
//                          TESTS
// ============================================================

(async () => {
  try {
    // -------- 0. Schema sync (idempotent + drops legacy gid) --------
    await test('syncPermissionCatalog runs without error', async () => {
      await syncPermissionCatalog();
    });

    await test('legacy userInfo.gid column is gone after sync', async () => {
      const row = await db.one(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name='userInfo' AND column_name='gid' LIMIT 1`
      );
      assert(!row, 'userInfo.gid column dropped');
    });

    // -------- 1. Catalog sanity --------
    await test('all code-defined permissions are upserted', async () => {
      const rows = await db.query('SELECT `key` FROM permissions');
      const dbKeys = new Set(rows.map((r) => r.key));
      for (const k of Object.keys(PERMISSIONS)) {
        if (!dbKeys.has(k)) throw new Error('missing permission: ' + k);
      }
    });

    await test('all builtin roles upserted with builtin=1', async () => {
      const rows = await db.query("SELECT `key`, builtin, legacy_gid FROM roles WHERE `key` IN (?)", [Object.keys(BUILTIN_ROLES)]);
      const map = new Map(rows.map((r) => [r.key, r]));
      for (const [k, meta] of Object.entries(BUILTIN_ROLES)) {
        const row = map.get(k);
        if (!row) throw new Error('missing role: ' + k);
        if (row.builtin !== 1) throw new Error(`role ${k} should have builtin=1`);
      }
    });

    await test('moderator role has the unified permission set', async () => {
      const rows = await db.query(
        `SELECT p.\`key\` AS k FROM roles r
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE r.\`key\`='moderator'`
      );
      assertSetEq(rows.map((r) => r.k), BUILTIN_ROLES.moderator.permissions, 'moderator permission set');
    });

    await test('super_admin role has every permission', async () => {
      const rows = await db.query(
        `SELECT p.\`key\` AS k FROM roles r
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE r.\`key\`='super_admin'`
      );
      assertSetEq(rows.map((r) => r.k), Object.keys(PERMISSIONS), 'super_admin includes every permission');
    });

    // -------- 2. policy.loadEffectivePermissions --------
    let normalUid, modUid, superUid;
    await test('seed sandbox users with explicit role assignments', async () => {
      normalUid = await mkUser([]);
      modUid = await mkUser(['moderator']);
      superUid = await mkUser(['super_admin']);
    });

    await test('normal user has zero global permissions', async () => {
      policy.invalidate();
      const p = await policy.loadEffectivePermissions(normalUid);
      assertEq(p.global.size, 0, 'global set is empty');
      assertEq(p.denies.size, 0, 'denies set is empty');
      assertEq(p.scoped.size, 0, 'scoped map is empty');
    });

    await test('moderator user inherits the moderator permission set', async () => {
      policy.invalidate();
      const p = await policy.loadEffectivePermissions(modUid);
      assertSetEq([...p.global], BUILTIN_ROLES.moderator.permissions, 'moderator effective.global');
    });

    await test('super_admin user inherits every permission', async () => {
      policy.invalidate();
      const p = await policy.loadEffectivePermissions(superUid);
      assertSetEq([...p.global], Object.keys(PERMISSIONS), 'super_admin effective.global');
    });

    // -------- 3. user_permissions: global allow + scoped + deny --------
    await test('grant global allow → appears in effective.global', async () => {
      const perm = await db.one("SELECT id FROM permissions WHERE `key`='contest.create'");
      await db.query(
        `INSERT INTO user_permissions (uid, permission_id, effect, resource_type, resource_id) VALUES (?,?,?,?,?)`,
        [normalUid, perm.id, 'allow', null, null]
      );
      policy.invalidate(normalUid);
      const p = await policy.loadEffectivePermissions(normalUid);
      assert(p.global.has('contest.create'), 'normal user gained contest.create globally');
    });

    await test('grant scoped allow → appears in effective.scoped, not in global', async () => {
      const perm = await db.one("SELECT id FROM permissions WHERE `key`='problem.edit.any'");
      await db.query(
        `INSERT INTO user_permissions (uid, permission_id, effect, resource_type, resource_id) VALUES (?,?,?,?,?)`,
        [normalUid, perm.id, 'allow', 'problem', 42]
      );
      policy.invalidate(normalUid);
      const p = await policy.loadEffectivePermissions(normalUid);
      assert(!p.global.has('problem.edit.any'), 'scoped grant must NOT pollute global set');
      assert(p.scoped.get('problem.edit.any')?.has('problem:42'), 'scoped grant lands in scoped[problem:42]');
    });

    await test('policy.can: scoped grant authorizes only the matching scope', async () => {
      const p = await policy.loadEffectivePermissions(normalUid);
      assert(policy.can(p, 'problem.edit.any', { type: 'problem', id: 42 }), 'allowed for pid=42');
      assert(!policy.can(p, 'problem.edit.any', { type: 'problem', id: 43 }), 'denied for pid=43');
      assert(!policy.can(p, 'problem.edit.any'), 'no global grant');
    });

    await test('global deny overrides role-derived allow', async () => {
      const perm = await db.one("SELECT id FROM permissions WHERE `key`='problem.delete.any'");
      await db.query(
        `INSERT INTO user_permissions (uid, permission_id, effect, resource_type, resource_id) VALUES (?,?,?,?,?)`,
        [modUid, perm.id, 'deny', null, null]
      );
      policy.invalidate(modUid);
      const p = await policy.loadEffectivePermissions(modUid);
      assert(!policy.can(p, 'problem.delete.any'), 'moderator denied problem.delete.any after explicit deny');
    });

    // -------- 4. Expires honored --------
    await test('expired allow does not take effect', async () => {
      const perm = await db.one("SELECT id FROM permissions WHERE `key`='announcement.manage'");
      const past = new Date(Date.now() - 60_000);
      await db.query(
        `INSERT INTO user_permissions (uid, permission_id, effect, resource_type, resource_id, expires_at) VALUES (?,?,?,?,?,?)`,
        [normalUid, perm.id, 'allow', null, null, past]
      );
      policy.invalidate(normalUid);
      const p = await policy.loadEffectivePermissions(normalUid);
      assert(!p.global.has('announcement.manage'), 'expired grant filtered out');
    });

    // -------- 5. Cache + invalidate --------
    await test('policy cache returns the same object until invalidate', async () => {
      policy.invalidate(superUid);
      const p1 = await policy.loadEffectivePermissions(superUid);
      const p2 = await policy.loadEffectivePermissions(superUid);
      assert(p1 === p2, 'cache reused across calls');
      policy.invalidate(superUid);
      const p3 = await policy.loadEffectivePermissions(superUid);
      assert(p1 !== p3, 'invalidate forces a fresh load');
    });

    // -------- 6. /api/auth handlers --------
    const superPerms = await policy.loadEffectivePermissions(superUid);
    const normalPerms = () => policy.loadEffectivePermissions(normalUid);

    await test('listPermissions returns the catalog (super_admin)', async () => {
      const req = makeReq(superUid, superPerms);
      const res = await runHandler(auth.listPermissions, req);
      assertEq(res.statusCode, 200, 'status 200');
      assert(Array.isArray(res.payload.permissions), 'permissions array');
      assert(res.payload.permissions.length >= Object.keys(PERMISSIONS).length, 'has all code-defined keys');
      // Every payload row carries an endpoints[] array (may be empty for
      // permissions only consulted via inline req.can in handlers).
      for (const p of res.payload.permissions) {
        if (!Array.isArray(p.endpoints)) throw new Error(`permission ${p.key} missing endpoints`);
      }
      // problem.create is enforced via requirePermission middleware on
      // /api/problem/createProblem, so the registry must surface it.
      const create = res.payload.permissions.find((p) => p.key === 'problem.create');
      assert(create && create.endpoints.some((e) => e.includes('/api/problem/createProblem')),
        'problem.create endpoint registry includes createProblem');
    });

    await test('searchProblems / searchContests reject non-grantor', async () => {
      // a normal user (no roles) cannot use the resource pickers
      policy.invalidate(normalUid);
      const r1 = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
      r1.body = { q: '1' };
      const res1 = await runHandler(auth.searchProblems, r1);
      assertEq(res1.statusCode, 403, 'searchProblems 403 for normal user');
      const r2 = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
      r2.body = { q: '1' };
      const res2 = await runHandler(auth.searchContests, r2);
      assertEq(res2.statusCode, 403, 'searchContests 403 for normal user');
    });

    await test('searchProblems works for super_admin', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { q: '1' }; // numeric — searches by pid OR title
      const res = await runHandler(auth.searchProblems, req);
      assertEq(res.statusCode, 200, 'status 200');
      assert(Array.isArray(res.payload.problems), 'problems array');
    });

    await test('listPermissions returns 403 for normal user', async () => {
      policy.invalidate(normalUid);
      const req = makeReq(normalUid, await normalPerms());
      const res = await runHandler(auth.listPermissions, req);
      assertEq(res.statusCode, 403, 'status 403');
    });

    await test('listRoles returns roles with permission keys', async () => {
      const req = makeReq(superUid, superPerms);
      const res = await runHandler(auth.listRoles, req);
      assertEq(res.statusCode, 200, 'status 200');
      const sa = res.payload.roles.find((r) => r.key === 'super_admin');
      assert(sa && sa.permissions.length === Object.keys(PERMISSIONS).length, 'super_admin payload includes every permission');
    });

    let customRoleId = null;
    await test('createRole creates a custom role', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { key: 'test_custom1', name: '测试角色', description: 'desc', permissionKeys: ['problem.create'] };
      const res = await runHandler(auth.createRole, req);
      assertEq(res.statusCode, 200, 'status 200');
      const row = await db.one("SELECT id, builtin FROM roles WHERE `key`=?", ['test_custom1']);
      assert(row, 'role exists');
      assertEq(row.builtin, 0, 'builtin=0');
      customRoleId = row.id;
      const link = await db.exists(
        `SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.\`key\`='problem.create'`,
        [customRoleId]
      );
      assert(link, 'role_permissions row created');
    });

    await test('createRole rejects an illegal key', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { key: 'BAD-KEY', name: 'x', permissionKeys: [] };
      const res = await runHandler(auth.createRole, req);
      assertEq(res.statusCode, 202, 'status 202 (validation error via fail())');
      assert(/格式/.test(res.payload.message || ''), 'rejection message about format');
    });

    await test('updateRole rejects builtin role for non-root', async () => {
      // sandbox superUid has user.role.assign but is not uid=1
      const req = makeReq(superUid, superPerms);
      req.body = { key: 'super_admin', name: 'pwn' };
      const res = await runHandler(auth.updateRole, req);
      assertEq(res.statusCode, 202, 'status 202');
      assert(/root/.test(res.payload.message || ''), 'rejection message mentions root');
    });

    await test('updateRole accepts builtin role for root (uid=1)', async () => {
      // Only run if uid=1 actually exists and has user.role.assign
      const root = await db.exists('SELECT 1 FROM userInfo WHERE uid=1');
      if (!root) return ok('skip (uid=1 absent)');
      const rootPerms = await policy.loadEffectivePermissions(1);
      if (!rootPerms.global.has('user.role.assign'))
        return ok('skip (uid=1 has no user.role.assign)');
      // Read current super_admin metadata so we can restore identical values.
      const before = await db.one("SELECT name, description FROM roles WHERE `key`='super_admin'");
      const linkRows = await db.query(
        `SELECT p.\`key\` AS k FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         JOIN roles r ON r.id = rp.role_id WHERE r.\`key\`='super_admin'`
      );
      const beforePerms = linkRows.map((r) => r.k);

      const req = makeReq(1, rootPerms);
      req.body = {
        key: 'super_admin',
        name: before.name,                  // identical
        description: before.description,    // identical
        permissionKeys: beforePerms,        // identical
      };
      const res = await runHandler(auth.updateRole, req);
      assertEq(res.statusCode, 200, 'status 200 (root bypass)');
    });

    await test('updateRole modifies a custom role and resets permissions', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { key: 'test_custom1', name: '改了名', permissionKeys: ['contest.create', 'problem.create'] };
      const res = await runHandler(auth.updateRole, req);
      assertEq(res.statusCode, 200, 'status 200');
      const links = await db.query(
        `SELECT p.\`key\` AS k FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?`,
        [customRoleId]
      );
      assertSetEq(links.map((l) => l.k), ['contest.create', 'problem.create'], 'permission set replaced');
    });

    await test('setUserRoles assigns custom + builtin role to a normal user', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { uid: normalUid, roleKeys: ['test_custom1', 'problem_setter'] };
      const res = await runHandler(auth.setUserRoles, req);
      assertEq(res.statusCode, 200, 'status 200');

      policy.invalidate(normalUid);
      const p = await policy.loadEffectivePermissions(normalUid);
      assert(p.global.has('problem.create'), 'has problem.create from problem_setter');
      assert(p.global.has('contest.create'), 'has contest.create from custom role');
      assert(p.global.has('problem.edit.any'), 'has problem.edit.any from problem_setter');
    });

    await test('setUserRoles overwrites: removing a role drops its perms', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { uid: normalUid, roleKeys: [] };
      const res = await runHandler(auth.setUserRoles, req);
      assertEq(res.statusCode, 200, 'status 200');

      policy.invalidate(normalUid);
      const p = await policy.loadEffectivePermissions(normalUid);
      assert(!p.global.has('problem.create'), 'problem.create dropped');
      // the contest.create grant from the direct user_permissions allow earlier still applies
      assert(p.global.has('contest.create'), 'direct user_permissions allow survives role clear');
    });

    await test('deleteRole succeeds for unused custom role', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { key: 'test_custom1' };
      const res = await runHandler(auth.deleteRole, req);
      assertEq(res.statusCode, 200, 'status 200');
      const exists = await db.exists("SELECT 1 FROM roles WHERE `key`=?", ['test_custom1']);
      assert(!exists, 'role removed');
    });

    await test('deleteRole rejects when role still in use', async () => {
      const r1 = makeReq(superUid, superPerms);
      r1.body = { key: 'test_custom2', name: 'x', permissionKeys: [] };
      await runHandler(auth.createRole, r1);
      const r2 = makeReq(superUid, superPerms);
      r2.body = { uid: normalUid, roleKeys: ['test_custom2'] };
      await runHandler(auth.setUserRoles, r2);
      const r3 = makeReq(superUid, superPerms);
      r3.body = { key: 'test_custom2' };
      const res = await runHandler(auth.deleteRole, r3);
      assertEq(res.statusCode, 202, 'status 202');
      assert(/持有/.test(res.payload.message || ''), 'message mentions still in use');
      const r4 = makeReq(superUid, superPerms);
      r4.body = { uid: normalUid, roleKeys: [] };
      await runHandler(auth.setUserRoles, r4);
      const r5 = makeReq(superUid, superPerms);
      r5.body = { key: 'test_custom2' };
      const res2 = await runHandler(auth.deleteRole, r5);
      assertEq(res2.statusCode, 200, 'cleanup delete ok');
    });

    await test('grantUserPermission rejects scoped grant on non-scopable key', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = {
        uid: normalUid, permissionKey: 'problem.create', effect: 'allow',
        resourceType: 'problem', resourceId: 99,
      };
      const res = await runHandler(auth.grantUserPermission, req);
      assertEq(res.statusCode, 202, 'status 202');
      assert(/作用域/.test(res.payload.message || ''), 'rejection mentions scope');
    });

    await test('grantUserPermission upserts scoped allow then revokeUserPermission removes it', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = {
        uid: normalUid, permissionKey: 'problem.case.manage', effect: 'allow',
        resourceType: 'problem', resourceId: 7,
      };
      const res = await runHandler(auth.grantUserPermission, req);
      assertEq(res.statusCode, 200, 'grant ok');

      policy.invalidate(normalUid);
      const p1 = await policy.loadEffectivePermissions(normalUid);
      assert(p1.scoped.get('problem.case.manage')?.has('problem:7'), 'scoped grant active');

      const req2 = makeReq(superUid, superPerms);
      req2.body = { ...req.body, expiresAt: new Date(Date.now() + 60_000).toISOString() };
      const res2 = await runHandler(auth.grantUserPermission, req2);
      assertEq(res2.statusCode, 200, 'upsert ok');
      const cnt = await db.one(
        `SELECT COUNT(*) c FROM user_permissions up JOIN permissions p ON p.id=up.permission_id
         WHERE up.uid=? AND p.\`key\`='problem.case.manage' AND up.resource_type='problem' AND up.resource_id=7`,
        [normalUid]
      );
      assertEq(cnt.c, 1, 'exactly one row (upserted)');

      const row = await db.one(
        `SELECT up.id FROM user_permissions up JOIN permissions p ON p.id=up.permission_id
         WHERE up.uid=? AND p.\`key\`='problem.case.manage' AND up.resource_type='problem' AND up.resource_id=7`,
        [normalUid]
      );
      const req3 = makeReq(superUid, superPerms);
      req3.body = { id: row.id };
      const res3 = await runHandler(auth.revokeUserPermission, req3);
      assertEq(res3.statusCode, 200, 'revoke ok');

      policy.invalidate(normalUid);
      const p2 = await policy.loadEffectivePermissions(normalUid);
      assert(!p2.scoped.get('problem.case.manage')?.has('problem:7'), 'scoped grant gone');
    });

    await test('listUserGrants returns roles + permissions', async () => {
      const r1 = makeReq(superUid, superPerms);
      r1.body = { uid: normalUid, roleKeys: ['problem_setter'] };
      await runHandler(auth.setUserRoles, r1);
      const r2 = makeReq(superUid, superPerms);
      r2.body = { uid: normalUid, permissionKey: 'announcement.manage', effect: 'allow' };
      await runHandler(auth.grantUserPermission, r2);

      const r3 = makeReq(superUid, superPerms);
      r3.body = { uid: normalUid };
      const res = await runHandler(auth.listUserGrants, r3);
      assertEq(res.statusCode, 200, 'status 200');
      assert(res.payload.roles.includes('problem_setter'), 'roles list includes problem_setter');
      const perms = res.payload.permissions.map((p) => p.permissionKey);
      assert(perms.includes('announcement.manage'), 'permissions list includes announcement.manage');
    });

    await test('searchUsers finds the sandbox normal user by uid', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { q: String(normalUid) };
      const res = await runHandler(auth.searchUsers, req);
      assertEq(res.statusCode, 200, 'status 200');
      const found = res.payload.users.find((u) => u.uid === normalUid);
      assert(!!found, 'user appears in search results');
    });

    // -------- 7. Resource-owner authorization path --------
    await test('resource owner can grant whitelisted permission without user.permission.grant', async () => {
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags) VALUES (?,?,?,NOW(),?)`,
        ['_test_problem', 'desc', normalUid, '[]']
      );
      const pid = r.insertId;

      try {
        policy.invalidate(normalUid);
        const ownerPerms = await policy.loadEffectivePermissions(normalUid);
        const req = makeReq(normalUid, ownerPerms);
        req.body = {
          uid: modUid,
          permissionKey: 'problem.case.manage',
          effect: 'allow',
          resourceType: 'problem',
          resourceId: pid,
        };
        const res = await runHandler(auth.grantUserPermission, req);
        assertEq(res.statusCode, 200, 'owner-as-grantor ok');

        policy.invalidate(modUid);
        const mp = await policy.loadEffectivePermissions(modUid);
        assert(mp.scoped.get('problem.case.manage')?.has(`problem:${pid}`),
          `modUid has problem.case.manage scoped to problem:${pid}`);

        const req2 = makeReq(normalUid, ownerPerms);
        req2.body = {
          uid: modUid,
          permissionKey: 'problem.view.private',
          effect: 'allow',
          resourceType: 'problem',
          resourceId: pid,
        };
        const res2 = await runHandler(auth.grantUserPermission, req2);
        assert(res2.statusCode !== 200, 'non-whitelisted grant rejected');
      } finally {
        await db.query('DELETE FROM user_permissions WHERE resource_type=? AND resource_id=?', ['problem', pid]);
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
      }
    });

    await test('listResourceGrants returns all grants on a resource for the owner', async () => {
      const start = new Date();
      const c = await db.query(
        `INSERT INTO contest(title, host, start, length, type, isPublic) VALUES (?,?,?,?,?,?)`,
        ['_test_contest', normalUid, start, 60, 0, 0]
      );
      const cid = c.insertId;
      try {
        const grant = makeReq(superUid, superPerms);
        grant.body = { uid: modUid, permissionKey: 'contest.player.manage', effect: 'allow', resourceType: 'contest', resourceId: cid };
        await runHandler(auth.grantUserPermission, grant);

        policy.invalidate(normalUid);
        const ownerPerms = await policy.loadEffectivePermissions(normalUid);
        const req = makeReq(normalUid, ownerPerms);
        req.body = { resourceType: 'contest', resourceId: cid };
        const res = await runHandler(auth.listResourceGrants, req);
        assertEq(res.statusCode, 200, 'owner can list resource grants');
        assert(res.payload.grants.some((g) => g.uid === modUid && g.permissionKey === 'contest.player.manage'),
          'returned grant matches');
        assertSetEq(res.payload.grantablePermissions, RESOURCE_GRANTABLE.contest, 'returns whitelist for contest');
      } finally {
        await db.query('DELETE FROM user_permissions WHERE resource_type=? AND resource_id=?', ['contest', cid]);
        await db.query('DELETE FROM contest WHERE cid=?', [cid]);
      }
    });

    // -------- 8. requirePermission middleware --------
    await test('requirePermission middleware blocks insufficient perms', async () => {
      const { requirePermission } = require('./middleware');
      const mw = requirePermission('user.role.assign');
      // Strip every role + grant from normalUid first.
      await db.query('DELETE FROM user_roles WHERE uid=?', [normalUid]);
      await db.query('DELETE FROM user_permissions WHERE uid=?', [normalUid]);
      policy.invalidate(normalUid);
      const req = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
      const res = fakeRes();
      let nextCalled = false;
      await new Promise((resolve) => {
        const r = mw(req, res, () => { nextCalled = true; resolve(); });
        if (r && typeof r.then === 'function') r.then(() => resolve());
      });
      assert(!nextCalled, 'next() not called');
      assertEq(res.statusCode, 403, 'status 403');
    });

    await test('requirePermission middleware lets super_admin through', async () => {
      const { requirePermission } = require('./middleware');
      const mw = requirePermission('user.role.assign');
      const req = makeReq(superUid, superPerms);
      const res = fakeRes();
      let nextCalled = false;
      await new Promise((resolve) => {
        const r = mw(req, res, () => { nextCalled = true; resolve(); });
        if (r && typeof r.then === 'function') r.then(() => resolve());
      });
      assert(nextCalled, 'next() called');
    });

    await test('requirePermission with scopeFrom honors scoped grants', async () => {
      const { requirePermission } = require('./middleware');
      const mw = requirePermission('problem.edit.any', {
        scopeFrom: (req) => ({ type: 'problem', id: +req.body.pid }),
      });
      // normalUid currently has no roles/grants — give it ONLY a scoped allow on pid 99.
      const perm = await db.one("SELECT id FROM permissions WHERE `key`='problem.edit.any'");
      await db.query(
        `INSERT INTO user_permissions (uid, permission_id, effect, resource_type, resource_id) VALUES (?,?,?,?,?)`,
        [normalUid, perm.id, 'allow', 'problem', 99]
      );
      policy.invalidate(normalUid);
      const req = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
      req.body = { pid: 99 };
      const res = fakeRes();
      let nextCalled = false;
      await new Promise((resolve) => {
        const r = mw(req, res, () => { nextCalled = true; resolve(); });
        if (r && typeof r.then === 'function') r.then(() => resolve());
      });
      assert(nextCalled, 'allowed for pid=99');

      const req2 = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
      req2.body = { pid: 100 };
      const res2 = fakeRes();
      let nextCalled2 = false;
      await new Promise((resolve) => {
        const r = mw(req2, res2, () => { nextCalled2 = true; resolve(); });
        if (r && typeof r.then === 'function') r.then(() => resolve());
      });
      assert(!nextCalled2, 'blocked for pid=100');
      assertEq(res2.statusCode, 403, 'status 403');
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
