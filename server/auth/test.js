// Integration tests for the RBAC permission system. Runs against the real
// database in server/config.json. The legacy user level column is dropped
// during sync (one-time on first start), so this test seeds users without it
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
    // -------- 0. Schema sync (idempotent + drops legacy level) --------
    await test('syncPermissionCatalog runs without error', async () => {
      await syncPermissionCatalog();
    });

    await test('legacy user level column is gone after sync', async () => {
      const row = await db.one(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name='userInfo' AND column_name='gid' LIMIT 1`
      );
      assert(!row, 'legacy user level column dropped');
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
      const rows = await db.query("SELECT `key`, builtin FROM roles WHERE `key` IN (?)", [Object.keys(BUILTIN_ROLES)]);
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
      const perm = await db.one("SELECT id FROM permissions WHERE `key`='problem.manage.any'");
      await db.query(
        `INSERT INTO user_permissions (uid, permission_id, effect, resource_type, resource_id) VALUES (?,?,?,?,?)`,
        [normalUid, perm.id, 'allow', 'problem', 42]
      );
      policy.invalidate(normalUid);
      const p = await policy.loadEffectivePermissions(normalUid);
      assert(!p.global.has('problem.manage.any'), 'scoped grant must NOT pollute global set');
      assert(p.scoped.get('problem.manage.any')?.has('problem:42'), 'scoped grant lands in scoped[problem:42]');
    });

    await test('policy.can: scoped grant authorizes only the matching scope', async () => {
      const p = await policy.loadEffectivePermissions(normalUid);
      assert(policy.can(p, 'problem.manage.any', { type: 'problem', id: 42 }), 'allowed for pid=42');
      assert(!policy.can(p, 'problem.manage.any', { type: 'problem', id: 43 }), 'denied for pid=43');
      assert(!policy.can(p, 'problem.manage.any'), 'no global grant');
    });

    await test('global deny overrides role-derived allow', async () => {
      const perm = await db.one("SELECT id FROM permissions WHERE `key`='problem.manage.any'");
      await db.query(
        `INSERT INTO user_permissions (uid, permission_id, effect, resource_type, resource_id) VALUES (?,?,?,?,?)`,
        [modUid, perm.id, 'deny', null, null]
      );
      policy.invalidate(modUid);
      const p = await policy.loadEffectivePermissions(modUid);
      assert(!policy.can(p, 'problem.manage.any'), 'moderator denied problem.manage.any after explicit deny');
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

    await test('searchProblems / searchContests are open to any logged-in user', async () => {
      // Resource owners need these pickers to find their own problems/contests
      // when adding collaborators — gating on user.permission.grant would
      // lock them out. The pickers respect visibility: searchProblems hides
      // private problems unless the caller has problem.view.any.
      policy.invalidate(normalUid);
      const r1 = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
      r1.body = { q: '1' };
      const res1 = await runHandler(auth.searchProblems, r1);
      assertEq(res1.statusCode, 200, 'searchProblems open to logged-in user');
      const r2 = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
      r2.body = { q: '1' };
      const res2 = await runHandler(auth.searchContests, r2);
      assertEq(res2.statusCode, 200, 'searchContests open to logged-in user');
    });

    await test('searchProblems hides private problems for users without view.any', async () => {
      // Insert a private problem owned by superUid
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags, isPublic) VALUES (?,?,?,NOW(),?,0)`,
        ['_test_p_search_private_unique_xyz', 'desc', superUid, '[]']
      );
      const pid = r.insertId;
      try {
        // normalUid currently has roles + grants from prior tests; just
        // checking its existing perms. Should not have view.any (no
        // problem_setter role yet at this point in the suite).
        policy.invalidate(normalUid);
        const req = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
        req.body = { q: '_test_p_search_private_unique_xyz' };
        const res = await runHandler(auth.searchProblems, req);
        assertEq(res.statusCode, 200, 'status 200');
        assert(!res.payload.problems.some((p) => p.pid === pid),
          'private problem hidden from non-viewer');

        // superUid (has view.any via super_admin) sees it
        const req2 = makeReq(superUid, superPerms);
        req2.body = { q: '_test_p_search_private_unique_xyz' };
        const res2 = await runHandler(auth.searchProblems, req2);
        assert(res2.payload.problems.some((p) => p.pid === pid),
          'super_admin sees private problem in search');
      } finally {
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
      }
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
    await test('createRole rejects a non-root role admin', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { key: 'test_custom_reject', name: '测试角色', permissionKeys: [] };
      const res = await runHandler(auth.createRole, req);
      assertEq(res.statusCode, 403, 'status 403');
    });

    await test('createRole creates a custom role for uid=1', async () => {
      const req = makeReq(1, superPerms);
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
      const req = makeReq(1, superPerms);
      req.body = { key: 'BAD-KEY', name: 'x', permissionKeys: [] };
      const res = await runHandler(auth.createRole, req);
      assertEq(res.statusCode, 202, 'status 202 (validation error via fail())');
      assert(/格式/.test(res.payload.message || ''), 'rejection message about format');
    });

    await test('updateRole rejects non-root role admin', async () => {
      const req = makeReq(superUid, superPerms);
      req.body = { key: 'test_custom1', name: 'pwn' };
      const res = await runHandler(auth.updateRole, req);
      assertEq(res.statusCode, 403, 'status 403');
    });

    await test('updateRole accepts builtin role for uid=1', async () => {
      // Read current super_admin metadata so we can restore identical values.
      const before = await db.one("SELECT name, description FROM roles WHERE `key`='super_admin'");
      const linkRows = await db.query(
        `SELECT p.\`key\` AS k FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         JOIN roles r ON r.id = rp.role_id WHERE r.\`key\`='super_admin'`
      );
      const beforePerms = linkRows.map((r) => r.k);

      const req = makeReq(1, superPerms);
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
      const req = makeReq(1, superPerms);
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
      assert(p.global.has('problem.manage.self'), 'has problem.manage.self from problem_setter');
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
      const req = makeReq(1, superPerms);
      req.body = { key: 'test_custom1' };
      const res = await runHandler(auth.deleteRole, req);
      assertEq(res.statusCode, 200, 'status 200');
      const exists = await db.exists("SELECT 1 FROM roles WHERE `key`=?", ['test_custom1']);
      assert(!exists, 'role removed');
    });

    await test('deleteRole rejects when role still in use', async () => {
      const r1 = makeReq(1, superPerms);
      r1.body = { key: 'test_custom2', name: 'x', permissionKeys: [] };
      await runHandler(auth.createRole, r1);
      const r2 = makeReq(superUid, superPerms);
      r2.body = { uid: normalUid, roleKeys: ['test_custom2'] };
      await runHandler(auth.setUserRoles, r2);
      const r3 = makeReq(1, superPerms);
      r3.body = { key: 'test_custom2' };
      const res = await runHandler(auth.deleteRole, r3);
      assertEq(res.statusCode, 202, 'status 202');
      assert(/持有/.test(res.payload.message || ''), 'message mentions still in use');
      const r4 = makeReq(superUid, superPerms);
      r4.body = { uid: normalUid, roleKeys: [] };
      await runHandler(auth.setUserRoles, r4);
      const r5 = makeReq(1, superPerms);
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
        uid: normalUid, permissionKey: 'problem.manage.any', effect: 'allow',
        resourceType: 'problem', resourceId: 7,
      };
      const res = await runHandler(auth.grantUserPermission, req);
      assertEq(res.statusCode, 200, 'grant ok');

      policy.invalidate(normalUid);
      const p1 = await policy.loadEffectivePermissions(normalUid);
      assert(p1.scoped.get('problem.manage.any')?.has('problem:7'), 'scoped grant active');

      const req2 = makeReq(superUid, superPerms);
      req2.body = { ...req.body, expiresAt: new Date(Date.now() + 60_000).toISOString() };
      const res2 = await runHandler(auth.grantUserPermission, req2);
      assertEq(res2.statusCode, 200, 'upsert ok');
      const cnt = await db.one(
        `SELECT COUNT(*) c FROM user_permissions up JOIN permissions p ON p.id=up.permission_id
         WHERE up.uid=? AND p.\`key\`='problem.manage.any' AND up.resource_type='problem' AND up.resource_id=7`,
        [normalUid]
      );
      assertEq(cnt.c, 1, 'exactly one row (upserted)');

      const row = await db.one(
        `SELECT up.id FROM user_permissions up JOIN permissions p ON p.id=up.permission_id
         WHERE up.uid=? AND p.\`key\`='problem.manage.any' AND up.resource_type='problem' AND up.resource_id=7`,
        [normalUid]
      );
      const req3 = makeReq(superUid, superPerms);
      req3.body = { id: row.id };
      const res3 = await runHandler(auth.revokeUserPermission, req3);
      assertEq(res3.statusCode, 200, 'revoke ok');

      policy.invalidate(normalUid);
      const p2 = await policy.loadEffectivePermissions(normalUid);
      assert(!p2.scoped.get('problem.manage.any')?.has('problem:7'), 'scoped grant gone');
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
          permissionKey: 'problem.manage.any',
          effect: 'allow',
          resourceType: 'problem',
          resourceId: pid,
        };
        const res = await runHandler(auth.grantUserPermission, req);
        assertEq(res.statusCode, 200, 'owner-as-grantor ok');

        policy.invalidate(modUid);
        const mp = await policy.loadEffectivePermissions(modUid);
        assert(mp.scoped.get('problem.manage.any')?.has(`problem:${pid}`),
          `modUid has problem.manage.any scoped to problem:${pid}`);

        // owner-as-grantor must NOT be able to grant a permission that isn't
        // on the resource's whitelist. contest.manage.any is scopable so the
        // generic scopable check would pass — the whitelist is what blocks it.
        const req2 = makeReq(normalUid, ownerPerms);
        req2.body = {
          uid: modUid,
          permissionKey: 'contest.manage.any',
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
        grant.body = { uid: modUid, permissionKey: 'contest.manage.any', effect: 'allow', resourceType: 'contest', resourceId: cid };
        await runHandler(auth.grantUserPermission, grant);

        policy.invalidate(normalUid);
        const ownerPerms = await policy.loadEffectivePermissions(normalUid);
        const req = makeReq(normalUid, ownerPerms);
        req.body = { resourceType: 'contest', resourceId: cid };
        const res = await runHandler(auth.listResourceGrants, req);
        assertEq(res.statusCode, 200, 'owner can list resource grants');
        assert(res.payload.grants.some((g) => g.uid === modUid && g.permissionKey === 'contest.manage.any'),
          'returned grant matches');
        assertSetEq(res.payload.grantablePermissions, RESOURCE_GRANTABLE.contest, 'returns whitelist for contest');
        const permKeys = new Set((res.payload.permissions || []).map((p) => p.key));
        assert(permKeys.has('contest.manage.any'), 'permissions include contest.manage.any');
      } finally {
        await db.query('DELETE FROM user_permissions WHERE resource_type=? AND resource_id=?', ['contest', cid]);
        await db.query('DELETE FROM contest WHERE cid=?', [cid]);
      }
    });

    // -------- 8. requirePermission middleware --------
    await test('requirePermission middleware blocks insufficient perms', async () => {
      const { requirePermission } = require('./middleware');
      const mw = requirePermission('user.role.admin');
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
      const mw = requirePermission('user.role.admin');
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
      const mw = requirePermission('problem.manage.any', {
        scopeFrom: (req) => ({ type: 'problem', id: +req.body.pid }),
      });
      // normalUid currently has no roles/grants — give it ONLY a scoped allow on pid 99.
      const perm = await db.one("SELECT id FROM permissions WHERE `key`='problem.manage.any'");
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

    // -------- 9. New problem permission model (manage.any / manage.self / view.any) --------
    await test('problemAuth: owner with manage.self can manage own problem', async () => {
      const { problemAuth } = require('../api/problem');
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags, isPublic) VALUES (?,?,?,NOW(),?,0)`,
        ['_test_p_msself', 'desc', normalUid, '[]']
      );
      const pid = r.insertId;
      try {
        // Give normalUid problem.manage.self (it doesn't have it from clean state).
        await db.query('DELETE FROM user_roles WHERE uid=?', [normalUid]);
        await db.query('DELETE FROM user_permissions WHERE uid=?', [normalUid]);
        const perm = await db.one("SELECT id FROM permissions WHERE `key`='problem.manage.self'");
        await db.query(
          'INSERT INTO user_permissions (uid, permission_id, effect) VALUES (?,?,?)',
          [normalUid, perm.id, 'allow']
        );
        policy.invalidate(normalUid);
        const req = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
        req.body = { pid };
        const auth = await problemAuth(req, pid);
        assertEq(auth.manage, true, 'owner with manage.self can manage');
        assertEq(auth.view, true, 'owner can always view own problem');
      } finally {
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
        await db.query('DELETE FROM user_permissions WHERE uid=?', [normalUid]);
        policy.invalidate(normalUid);
      }
    });

    await test('problemAuth: owner WITHOUT manage.self cannot manage', async () => {
      const { problemAuth } = require('../api/problem');
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags, isPublic) VALUES (?,?,?,NOW(),?,0)`,
        ['_test_p_owneronly', 'desc', normalUid, '[]']
      );
      const pid = r.insertId;
      try {
        // normalUid has no roles + no perms
        policy.invalidate(normalUid);
        const req = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
        req.body = { pid };
        const auth = await problemAuth(req, pid);
        assertEq(auth.manage, false, 'plain owner without manage.self cannot manage');
        assertEq(auth.view, true, 'owner can still view own problem');
      } finally {
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
      }
    });

    await test('problemAuth: non-owner with manage.any (scoped) can manage', async () => {
      const { problemAuth } = require('../api/problem');
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags, isPublic) VALUES (?,?,?,NOW(),?,0)`,
        ['_test_p_scoped', 'desc', superUid, '[]']
      );
      const pid = r.insertId;
      try {
        const perm = await db.one("SELECT id FROM permissions WHERE `key`='problem.manage.any'");
        await db.query(
          'INSERT INTO user_permissions (uid, permission_id, effect, resource_type, resource_id) VALUES (?,?,?,?,?)',
          [normalUid, perm.id, 'allow', 'problem', pid]
        );
        policy.invalidate(normalUid);
        const req = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
        const auth = await problemAuth(req, pid);
        assertEq(auth.manage, true, 'non-owner with manage.any@pid can manage');
      } finally {
        await db.query('DELETE FROM user_permissions WHERE uid=?', [normalUid]);
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
        policy.invalidate(normalUid);
      }
    });

    await test('problemAuth: non-owner without view.any cannot view a private problem', async () => {
      const { problemAuth } = require('../api/problem');
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags, isPublic) VALUES (?,?,?,NOW(),?,0)`,
        ['_test_p_private', 'desc', superUid, '[]']
      );
      const pid = r.insertId;
      try {
        policy.invalidate(normalUid);
        const req = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
        const auth = await problemAuth(req, pid);
        assertEq(auth.view, false, 'no view.any + non-owner + private = no view');
      } finally {
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
      }
    });

    await test('problem_setter role grants create + manage.self + view.any (NOT manage.any)', async () => {
      const role = await db.one('SELECT id FROM roles WHERE `key`=?', ['problem_setter']);
      const links = await db.query(
        `SELECT p.\`key\` AS k FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?`,
        [role.id]
      );
      const keys = new Set(links.map((l) => l.k));
      assert(keys.has('problem.create'), 'has problem.create');
      assert(keys.has('problem.manage.self'), 'has problem.manage.self');
      assert(keys.has('problem.view.any'), 'has problem.view.any');
      assert(!keys.has('problem.manage.any'), 'does NOT have problem.manage.any (problem_setters can only manage own)');
    });

    await test('moderator role grants problem.manage.any', async () => {
      const role = await db.one('SELECT id FROM roles WHERE `key`=?', ['moderator']);
      const links = await db.query(
        `SELECT p.\`key\` AS k FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?`,
        [role.id]
      );
      const keys = new Set(links.map((l) => l.k));
      assert(keys.has('problem.manage.any'), 'moderator has problem.manage.any');
      assert(keys.has('problem.manage.self'), 'moderator has problem.manage.self');
      assert(keys.has('problem.view.any'), 'moderator has problem.view.any');
    });

    await test('migration: old keys (problem.edit.any etc.) no longer exist', async () => {
      for (const oldKey of ['problem.edit.any', 'problem.delete.any', 'problem.case.manage', 'problem.view.private']) {
        const row = await db.exists('SELECT 1 FROM permissions WHERE `key`=?', [oldKey]);
        assert(!row, `${oldKey} removed from catalog`);
      }
    });

    await test('RESOURCE_GRANTABLE.problem whitelists problem.manage.any + problem.view.any', async () => {
      assertSetEq(RESOURCE_GRANTABLE.problem,
        ['problem.manage.any', 'problem.view.any'],
        'problem grantable list');
    });

    await test('solution_admin role grants problem.solmanage without paste.edit.any', async () => {
      const role = await db.one('SELECT id FROM roles WHERE `key`=?', ['solution_admin']);
      const links = await db.query(
        `SELECT p.\`key\` AS k FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?`,
        [role.id]
      );
      const keys = new Set(links.map((l) => l.k));
      assert(keys.has('problem.solmanage'), 'solution_admin has problem.solmanage');
      assert(!keys.has('paste.edit.any'), 'solution_admin does not get paste.edit.any');
      assert(!keys.has('problem.manage.any'), 'solution_admin does not get problem.manage.any');
    });

    // -------- 10. New contest permission model (manage.any / manage.self) --------
    await test('contest old keys (edit.any / player.manage) removed from catalog', async () => {
      for (const oldKey of ['contest.edit.any', 'contest.player.manage']) {
        const row = await db.exists('SELECT 1 FROM permissions WHERE `key`=?', [oldKey]);
        assert(!row, `${oldKey} removed`);
      }
    });

    await test('contest new keys present and contest.manage.any is scopable', async () => {
      const row = await db.one('SELECT scopable FROM permissions WHERE `key`=?', ['contest.manage.any']);
      assert(row, 'contest.manage.any exists');
      assertEq(row.scopable, 1, 'contest.manage.any scopable');
      const self = await db.one('SELECT scopable FROM permissions WHERE `key`=?', ['contest.manage.self']);
      assert(self, 'contest.manage.self exists');
      assertEq(self.scopable, 0, 'contest.manage.self NOT scopable');
    });

    await test('contest_manager role grants manage.self (NOT manage.any)', async () => {
      const role = await db.one('SELECT id FROM roles WHERE `key`=?', ['contest_manager']);
      const links = await db.query(
        `SELECT p.\`key\` AS k FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?`,
        [role.id]
      );
      const keys = new Set(links.map((l) => l.k));
      assert(keys.has('contest.create'), 'has contest.create');
      assert(keys.has('contest.manage.self'), 'has contest.manage.self');
      assert(!keys.has('contest.manage.any'), 'does NOT have contest.manage.any');
    });

    await test('moderator role grants contest.manage.any', async () => {
      const role = await db.one('SELECT id FROM roles WHERE `key`=?', ['moderator']);
      const links = await db.query(
        `SELECT p.\`key\` AS k FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?`,
        [role.id]
      );
      const keys = new Set(links.map((l) => l.k));
      assert(keys.has('contest.manage.any'), 'has contest.manage.any');
      assert(keys.has('contest.manage.self'), 'has contest.manage.self');
    });

    await test('canManageContest: host with manage.self can manage own contest', async () => {
      const { canManageContest } = require('../api/contest');
      const c = await db.query(
        `INSERT INTO contest(title, host, start, length, type, isPublic) VALUES (?,?,?,?,?,?)`,
        ['_test_c_self', normalUid, new Date(), 60, 0, 0]
      );
      const cid = c.insertId;
      try {
        // Give normalUid contest.manage.self
        await db.query('DELETE FROM user_roles WHERE uid=?', [normalUid]);
        await db.query('DELETE FROM user_permissions WHERE uid=?', [normalUid]);
        const perm = await db.one("SELECT id FROM permissions WHERE `key`='contest.manage.self'");
        await db.query(
          'INSERT INTO user_permissions (uid, permission_id, effect) VALUES (?,?,?)',
          [normalUid, perm.id, 'allow']
        );
        policy.invalidate(normalUid);
        const req = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
        assertEq(await canManageContest(req, cid), true, 'host with manage.self can manage');
      } finally {
        await db.query('DELETE FROM contest WHERE cid=?', [cid]);
        await db.query('DELETE FROM user_permissions WHERE uid=?', [normalUid]);
        policy.invalidate(normalUid);
      }
    });

    await test('canManageContest: host WITHOUT manage.self cannot manage', async () => {
      const { canManageContest } = require('../api/contest');
      const c = await db.query(
        `INSERT INTO contest(title, host, start, length, type, isPublic) VALUES (?,?,?,?,?,?)`,
        ['_test_c_owneronly', normalUid, new Date(), 60, 0, 0]
      );
      const cid = c.insertId;
      try {
        policy.invalidate(normalUid);
        const req = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
        assertEq(await canManageContest(req, cid), false, 'host without manage.self cannot manage');
      } finally {
        await db.query('DELETE FROM contest WHERE cid=?', [cid]);
      }
    });

    await test('canManageContest: scoped manage.any grants management to non-host', async () => {
      const { canManageContest } = require('../api/contest');
      const c = await db.query(
        `INSERT INTO contest(title, host, start, length, type, isPublic) VALUES (?,?,?,?,?,?)`,
        ['_test_c_collab', superUid, new Date(), 60, 0, 0]
      );
      const cid = c.insertId;
      try {
        const perm = await db.one("SELECT id FROM permissions WHERE `key`='contest.manage.any'");
        await db.query(
          'INSERT INTO user_permissions (uid, permission_id, effect, resource_type, resource_id) VALUES (?,?,?,?,?)',
          [normalUid, perm.id, 'allow', 'contest', cid]
        );
        policy.invalidate(normalUid);
        const req = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
        assertEq(await canManageContest(req, cid), true, 'collaborator with manage.any@cid can manage');
      } finally {
        await db.query('DELETE FROM user_permissions WHERE uid=?', [normalUid]);
        await db.query('DELETE FROM contest WHERE cid=?', [cid]);
        policy.invalidate(normalUid);
      }
    });

    // -------- 11. Collaborators cannot grant new collaborators --------
    await test('collaborator (manage.any scoped) CANNOT grant new collaborators', async () => {
      // superUid creates a problem; normalUid is added as a collaborator with
      // manage.any scoped. normalUid (collaborator, not owner) tries to grant
      // a third user manage.any on the same problem ⇒ must be rejected.
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags) VALUES (?,?,?,NOW(),?)`,
        ['_test_p_collab', 'desc', superUid, '[]']
      );
      const pid = r.insertId;
      try {
        // Make normalUid a collaborator
        const perm = await db.one("SELECT id FROM permissions WHERE `key`='problem.manage.any'");
        await db.query(
          'INSERT INTO user_permissions (uid, permission_id, effect, resource_type, resource_id) VALUES (?,?,?,?,?)',
          [normalUid, perm.id, 'allow', 'problem', pid]
        );
        policy.invalidate(normalUid);
        const collabPerms = await policy.loadEffectivePermissions(normalUid);
        // normalUid (collaborator) tries to grant modUid the same scoped perm
        const req = makeReq(normalUid, collabPerms);
        req.body = {
          uid: modUid,
          permissionKey: 'problem.manage.any',
          effect: 'allow',
          resourceType: 'problem',
          resourceId: pid,
        };
        const res = await runHandler(auth.grantUserPermission, req);
        assertEq(res.statusCode, 403, 'collaborator cannot grant — only owner can');
      } finally {
        await db.query('DELETE FROM user_permissions WHERE resource_type=? AND resource_id=?', ['problem', pid]);
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
        policy.invalidate(normalUid);
      }
    });

    await test('regression: collaborator (scoped manage.any) can fetch a private problem via getProblemInfo', async () => {
      const problemApi = require('../api/problem');
      // superUid creates a private problem; normalUid gets manage.any scoped to it.
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags, isPublic) VALUES (?,?,?,NOW(),?,0)`,
        ['_test_p_collab_view', 'desc', superUid, '[]']
      );
      const pid = r.insertId;
      try {
        // Strip normalUid back to a clean state (some prior tests left grants)
        await db.query('DELETE FROM user_roles WHERE uid=?', [normalUid]);
        await db.query('DELETE FROM user_permissions WHERE uid=?', [normalUid]);
        // Add the scoped manage.any grant
        const perm = await db.one("SELECT id FROM permissions WHERE `key`='problem.manage.any'");
        await db.query(
          'INSERT INTO user_permissions (uid, permission_id, effect, resource_type, resource_id) VALUES (?,?,?,?,?)',
          [normalUid, perm.id, 'allow', 'problem', pid]
        );
        policy.invalidate(normalUid);

        const req = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
        req.body = { pid };
        const res = await runHandler(problemApi.getProblemInfo, req);
        assertEq(res.statusCode, 200, 'getProblemInfo returns 200 for scoped collaborator');
        assert(res.payload?.data?.pid === pid, 'returns the requested problem');
      } finally {
        await db.query('DELETE FROM user_permissions WHERE resource_type=? AND resource_id=?', ['problem', pid]);
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
        policy.invalidate(normalUid);
      }
    });

    await test('regression: collaborator (scoped manage.any) sees the private problem in getProblemList', async () => {
      const problemApi = require('../api/problem');
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags, isPublic) VALUES (?,?,?,NOW(),?,0)`,
        ['_test_p_collab_list_unique_marker', 'desc', superUid, '[]']
      );
      const pid = r.insertId;
      try {
        await db.query('DELETE FROM user_roles WHERE uid=?', [normalUid]);
        await db.query('DELETE FROM user_permissions WHERE uid=?', [normalUid]);
        const perm = await db.one("SELECT id FROM permissions WHERE `key`='problem.manage.any'");
        await db.query(
          'INSERT INTO user_permissions (uid, permission_id, effect, resource_type, resource_id) VALUES (?,?,?,?,?)',
          [normalUid, perm.id, 'allow', 'problem', pid]
        );
        policy.invalidate(normalUid);

        const req = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
        req.body = { pageSize: 100, filter: { name: '_test_p_collab_list_unique_marker' } };
        const res = await runHandler(problemApi.getProblemList, req);
        assertEq(res.statusCode, 200, 'getProblemList returns 200');
        assert(res.payload.data.some((p) => p.pid === pid),
          'collaborator finds private problem in list');

        // Sanity: a third user (modUid) without the scoped grant should NOT see it.
        // modUid is a moderator (has problem.manage.any GLOBAL) so they would see it
        // regardless. Strip to plain user temporarily.
        const cleanUid = await mkUser([]);
        const req2 = makeReq(cleanUid, await policy.loadEffectivePermissions(cleanUid));
        req2.body = { pageSize: 100, filter: { name: '_test_p_collab_list_unique_marker' } };
        const res2 = await runHandler(problemApi.getProblemList, req2);
        assert(!res2.payload.data.some((p) => p.pid === pid),
          'unrelated user does NOT see private problem in list');
      } finally {
        await db.query('DELETE FROM user_permissions WHERE resource_type=? AND resource_id=?', ['problem', pid]);
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
        policy.invalidate(normalUid);
      }
    });

    await test('regression: anonymous (no session) reading getProblemList does not crash', async () => {
      const problemApi = require('../api/problem');
      const req = {
        body: { pageSize: 5 },
        session: {},
        useragent: { browser: { name: 'test', version: '0' }, os: { name: 'test', version: '0' } },
        can: () => false,
        // perms intentionally undefined
      };
      const res = await runHandler(problemApi.getProblemList, req);
      assertEq(res.statusCode, 200, 'anonymous gets 200');
      assert(Array.isArray(res.payload.data), 'data array');
      // Every visible problem must be public (no perms means public-only)
      for (const p of res.payload.data) assertEq(p.isPublic, 1, `pid ${p.pid} is public`);
    });

    await test('owner CAN grant new collaborators (regression for above test)', async () => {
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags) VALUES (?,?,?,NOW(),?)`,
        ['_test_p_owner_grants', 'desc', normalUid, '[]']
      );
      const pid = r.insertId;
      try {
        policy.invalidate(normalUid);
        const ownerPerms = await policy.loadEffectivePermissions(normalUid);
        const req = makeReq(normalUid, ownerPerms);
        req.body = {
          uid: modUid,
          permissionKey: 'problem.manage.any',
          effect: 'allow',
          resourceType: 'problem',
          resourceId: pid,
        };
        const res = await runHandler(auth.grantUserPermission, req);
        assertEq(res.statusCode, 200, 'owner can grant scoped manage.any');
      } finally {
        await db.query('DELETE FROM user_permissions WHERE resource_type=? AND resource_id=?', ['problem', pid]);
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
      }
    });

    // -------- 12. Solution binding permissions --------
    await test('solution_admin can bind and unbind public paste on a viewable problem without problem manage', async () => {
      const problemApi = require('../api/problem');
      const solutionUid = await mkUser(['solution_admin']);
      const ownerUid = await mkUser([]);
      const mark = `_test_sol_pub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags, isPublic) VALUES (?,?,?,NOW(),?,1)`,
        ['_test_solution_public_problem', 'desc', ownerUid, '[]']
      );
      const pid = r.insertId;
      try {
        await db.query(
          'INSERT INTO pastes(mark,title,content,uid,time,isPublic) VALUES (?,?,?,?,NOW(),1)',
          [mark, '_test public sol', 'content', ownerUid]
        );
        policy.invalidate(solutionUid);
        const req = makeReq(solutionUid, await policy.loadEffectivePermissions(solutionUid));
        req.body = { pid, mark };
        const bindRes = await runHandler(problemApi.bindPaste2Problem, req);
        assertEq(bindRes.statusCode, 200, 'solution_admin can bind public paste');

        const link = await db.one('SELECT id, `show` FROM problemSolution WHERE pid=? AND mark=?', [pid, mark]);
        assert(link && link.show === 1, 'problemSolution link created');

        req.body = { pid };
        const authRes = await runHandler(problemApi.getProblemAuth, req);
        assertEq(authRes.payload.data.manage, false, 'solution_admin still cannot manage problem');
        assertEq(authRes.payload.data.solutionManage, true, 'solution_admin can manage solutions for viewable problem');

        req.body = { id: link.id };
        const unbindRes = await runHandler(problemApi.unbindSol, req);
        assertEq(unbindRes.statusCode, 200, 'solution_admin can unbind solution');
        const after = await db.one('SELECT `show` FROM problemSolution WHERE id=?', [link.id]);
        assertEq(after.show, 0, 'problemSolution link hidden after unbind');
      } finally {
        await db.query('DELETE FROM problemSolution WHERE mark=?', [mark]);
        await db.query('DELETE FROM pastes WHERE mark=?', [mark]);
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
        policy.invalidate(solutionUid);
      }
    });

    await test('solution_admin cannot bind another user private paste', async () => {
      const problemApi = require('../api/problem');
      const solutionUid = await mkUser(['solution_admin']);
      const ownerUid = await mkUser([]);
      const mark = `_test_sol_private_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags, isPublic) VALUES (?,?,?,NOW(),?,1)`,
        ['_test_solution_private_problem', 'desc', ownerUid, '[]']
      );
      const pid = r.insertId;
      try {
        await db.query(
          'INSERT INTO pastes(mark,title,content,uid,time,isPublic) VALUES (?,?,?,?,NOW(),0)',
          [mark, '_test private sol', 'content', ownerUid]
        );
        policy.invalidate(solutionUid);
        const req = makeReq(solutionUid, await policy.loadEffectivePermissions(solutionUid));
        req.body = { pid, mark };
        const res = await runHandler(problemApi.bindPaste2Problem, req);
        assertEq(res.statusCode, 202, 'private paste bind rejected');
        assert(/有权查看/.test(res.payload.message || ''), 'message explains paste visibility');
        const linked = await db.exists('SELECT 1 FROM problemSolution WHERE pid=? AND mark=?', [pid, mark]);
        assert(!linked, 'private paste was not linked');
      } finally {
        await db.query('DELETE FROM problemSolution WHERE mark=?', [mark]);
        await db.query('DELETE FROM pastes WHERE mark=?', [mark]);
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
        policy.invalidate(solutionUid);
      }
    });

    await test('bindPaste2Problem rejects duplicate active binding', async () => {
      const problemApi = require('../api/problem');
      const solutionUid = await mkUser(['solution_admin']);
      const ownerUid = await mkUser([]);
      const mark = `_test_sol_duplicate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags, isPublic) VALUES (?,?,?,NOW(),?,1)`,
        ['_test_solution_duplicate_problem', 'desc', ownerUid, '[]']
      );
      const pid = r.insertId;
      try {
        await db.query(
          'INSERT INTO pastes(mark,title,content,uid,time,isPublic) VALUES (?,?,?,?,NOW(),1)',
          [mark, '_test duplicate sol', 'content', ownerUid]
        );
        policy.invalidate(solutionUid);
        const req = makeReq(solutionUid, await policy.loadEffectivePermissions(solutionUid));
        req.body = { pid, mark };
        const first = await runHandler(problemApi.bindPaste2Problem, req);
        assertEq(first.statusCode, 200, 'first bind succeeds');
        const second = await runHandler(problemApi.bindPaste2Problem, req);
        assertEq(second.statusCode, 202, 'second bind rejected');
        assert(/已绑定/.test(second.payload.message || ''), 'duplicate message explains binding exists');
        const cnt = await db.one('SELECT COUNT(*) AS cnt FROM problemSolution WHERE pid=? AND mark=? AND `show`=1', [pid, mark]);
        assertEq(cnt.cnt, 1, 'only one active binding remains');
      } finally {
        await db.query('DELETE FROM problemSolution WHERE mark=?', [mark]);
        await db.query('DELETE FROM pastes WHERE mark=?', [mark]);
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
      }
    });

    await test('getProblemSol deduplicates legacy duplicate rows and unbind hides all copies', async () => {
      const problemApi = require('../api/problem');
      const solutionUid = await mkUser(['solution_admin']);
      const ownerUid = await mkUser([]);
      const mark = `_test_sol_legacy_dup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags, isPublic) VALUES (?,?,?,NOW(),?,1)`,
        ['_test_solution_legacy_duplicate_problem', 'desc', ownerUid, '[]']
      );
      const pid = r.insertId;
      try {
        await db.query(
          'INSERT INTO pastes(mark,title,content,uid,time,isPublic) VALUES (?,?,?,?,NOW(),1)',
          [mark, '_test legacy duplicate sol', 'content', ownerUid]
        );
        await db.query('INSERT INTO problemSolution(pid,mark) VALUES (?,?),(?,?)', [pid, mark, pid, mark]);
        const req = makeReq(solutionUid, await policy.loadEffectivePermissions(solutionUid));
        req.body = { pid };
        const listRes = await runHandler(problemApi.getProblemSol, req);
        assertEq(listRes.statusCode, 200, 'solution list succeeds with duplicates');
        const rows = listRes.payload.data.filter((row) => row.mark === mark);
        assertEq(rows.length, 1, 'legacy duplicate rows are displayed once');

        req.body = { id: rows[0].id };
        const unbindRes = await runHandler(problemApi.unbindSol, req);
        assertEq(unbindRes.statusCode, 200, 'unbind succeeds');
        const active = await db.one('SELECT COUNT(*) AS cnt FROM problemSolution WHERE pid=? AND mark=? AND `show`=1', [pid, mark]);
        assertEq(active.cnt, 0, 'all duplicate active rows hidden');
      } finally {
        await db.query('DELETE FROM problemSolution WHERE mark=?', [mark]);
        await db.query('DELETE FROM pastes WHERE mark=?', [mark]);
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
      }
    });

    await test('solution_admin cannot bind on a private problem they cannot view', async () => {
      const problemApi = require('../api/problem');
      const solutionUid = await mkUser(['solution_admin']);
      const ownerUid = await mkUser([]);
      const mark = `_test_sol_private_problem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags, isPublic) VALUES (?,?,?,NOW(),?,0)`,
        ['_test_solution_private_unviewable_problem', 'desc', ownerUid, '[]']
      );
      const pid = r.insertId;
      try {
        await db.query(
          'INSERT INTO pastes(mark,title,content,uid,time,isPublic) VALUES (?,?,?,?,NOW(),1)',
          [mark, '_test public sol private problem', 'content', ownerUid]
        );
        policy.invalidate(solutionUid);
        const req = makeReq(solutionUid, await policy.loadEffectivePermissions(solutionUid));
        req.body = { pid, mark };
        const res = await runHandler(problemApi.bindPaste2Problem, req);
        assertEq(res.statusCode, 202, 'unviewable problem bind rejected');
        const linked = await db.exists('SELECT 1 FROM problemSolution WHERE pid=? AND mark=?', [pid, mark]);
        assert(!linked, 'solution was not linked to unviewable problem');
      } finally {
        await db.query('DELETE FROM problemSolution WHERE mark=?', [mark]);
        await db.query('DELETE FROM pastes WHERE mark=?', [mark]);
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
        policy.invalidate(solutionUid);
      }
    });

    await test('solution_admin cannot edit another user paste', async () => {
      const commonApi = require('../api/common');
      const solutionUid = await mkUser(['solution_admin']);
      const ownerUid = await mkUser([]);
      const mark = `_test_sol_no_edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await db.query(
          'INSERT INTO pastes(mark,title,content,uid,time,isPublic) VALUES (?,?,?,?,NOW(),1)',
          [mark, '_test original title', 'content', ownerUid]
        );
        policy.invalidate(solutionUid);
        const req = makeReq(solutionUid, await policy.loadEffectivePermissions(solutionUid));
        req.body = {
          paste: {
            mark,
            title: '_test changed title',
            content: 'changed',
            isPublic: 1,
          },
        };
        const res = await runHandler(commonApi.updatePaste, req);
        assertEq(res.statusCode, 202, 'solution_admin paste edit rejected');
        const paste = await db.one('SELECT title FROM pastes WHERE mark=?', [mark]);
        assertEq(paste.title, '_test original title', 'paste title unchanged');
      } finally {
        await db.query('DELETE FROM pastes WHERE mark=?', [mark]);
        policy.invalidate(solutionUid);
      }
    });

    await test('getProblemSol hides private paste metadata from users who cannot view that paste', async () => {
      const problemApi = require('../api/problem');
      const pasteOwnerUid = await mkUser([]);
      const viewerUid = await mkUser([]);
      const mark = `_test_sol_hidden_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const r = await db.query(
        `INSERT INTO problem(title, description, publisher, time, tags, isPublic) VALUES (?,?,?,NOW(),?,1)`,
        ['_test_solution_hidden_problem', 'desc', pasteOwnerUid, '[]']
      );
      const pid = r.insertId;
      try {
        await db.query(
          'INSERT INTO pastes(mark,title,content,uid,time,isPublic) VALUES (?,?,?,?,NOW(),0)',
          [mark, '_test hidden sol', 'content', pasteOwnerUid]
        );
        await db.query('INSERT INTO problemSolution(pid,mark) VALUES (?,?)', [pid, mark]);

        const viewerReq = makeReq(viewerUid, await policy.loadEffectivePermissions(viewerUid));
        viewerReq.body = { pid };
        const viewerRes = await runHandler(problemApi.getProblemSol, viewerReq);
        assertEq(viewerRes.statusCode, 200, 'viewer can list solutions');
        assert(!viewerRes.payload.data.some((row) => row.mark === mark), 'private paste metadata hidden from viewer');

        const ownerReq = makeReq(pasteOwnerUid, await policy.loadEffectivePermissions(pasteOwnerUid));
        ownerReq.body = { pid };
        const ownerRes = await runHandler(problemApi.getProblemSol, ownerReq);
        assert(ownerRes.payload.data.some((row) => row.mark === mark), 'paste owner still sees private solution row');
      } finally {
        await db.query('DELETE FROM problemSolution WHERE mark=?', [mark]);
        await db.query('DELETE FROM pastes WHERE mark=?', [mark]);
        await db.query('DELETE FROM problem WHERE pid=?', [pid]);
      }
    });

    // -------- 13. Personal audit filters --------
    await test('listAudits filters current user audit rows by eventType and keyword', async () => {
      const userApi = require('../api/user');
      const marker = `_self_audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await db.query(
          `INSERT INTO userAudit(uid, event, ip, iploc, time, browser, os, detail)
           VALUES (?, 5, '127.0.0.1', '本地', NOW(), 'test-browser', 'test-os', ?)`,
          [normalUid, JSON.stringify({ marker })]
        );
        await db.query(
          `INSERT INTO userAudit(uid, event, ip, iploc, time, browser, os, detail)
           VALUES (?, 4, '127.0.0.1', '本地', NOW(), 'test-browser', 'test-os', ?)`,
          [normalUid, JSON.stringify({ marker: marker + '_other' })]
        );
        const req = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
        req.body = { filter: { eventType: 5, q: marker } };
        const res = await runHandler(userApi.listAudits, req);
        assertEq(res.statusCode, 200, 'status 200');
        assert(res.payload.data.length >= 1, 'filtered self audit rows returned');
        assert(Array.isArray(res.payload.eventList), 'event catalog returned');
        for (const r of res.payload.data) {
          assertEq(r.event, 'auth.changePassword', 'self audit rows match eventType');
          assert(String(r.detail || '').includes(marker), 'self audit rows match keyword marker');
        }
      } finally {
        await db.query('DELETE FROM userAudit WHERE detail LIKE ?', [`%${marker}%`]);
      }
    });

    // -------- 14. searchUsers is now open to any logged-in user --------
    await test('searchUsers: any logged-in user can search (was: only role/grant holders)', async () => {
      // normalUid currently has no roles/perms (cleaned in earlier tests).
      policy.invalidate(normalUid);
      const req = makeReq(normalUid, await policy.loadEffectivePermissions(normalUid));
      req.body = { q: String(superUid) };
      const res = await runHandler(auth.searchUsers, req);
      assertEq(res.statusCode, 200, 'logged-in user gets results');
      assert(res.payload.users.some((u) => u.uid === superUid), 'found by uid');
    });

    await test('searchUsers: anonymous (no session) is rejected', async () => {
      const req = {
        body: { q: '1' }, session: {}, perms: undefined,
        useragent: { browser: { name: 'test', version: '0' }, os: { name: 'test', version: '0' } },
        can: () => false
      };
      const res = await runHandler(auth.searchUsers, req);
      assertEq(res.statusCode, 403, 'anonymous user rejected');
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
