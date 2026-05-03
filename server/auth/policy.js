const db = require('../db');

// Process-wide cache: uid -> { perms, expiresAt }.
// Invalidated explicitly by setUserRoles / grantUserPermission etc.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

const buildEmpty = () => ({
  global: new Set(),
  denies: new Set(),
  scoped: new Map(), // permKey -> Set<"type:id">
});

const loadEffectivePermissions = async (uid) => {
  if (!uid) return buildEmpty();

  const cached = cache.get(uid);
  if (cached && cached.expiresAt > Date.now()) return cached.perms;

  const perms = buildEmpty();

  // Permissions inherited from roles (always allow; deny is only expressible at user level).
  const rolePerms = await db.query(
    `SELECT DISTINCT p.\`key\`
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.uid = ?`,
    [uid]
  );
  for (const r of rolePerms) perms.global.add(r.key);

  // Direct user grants and denies; honor expires_at.
  const direct = await db.query(
    `SELECT p.\`key\` AS \`key\`, up.effect, up.resource_type, up.resource_id, up.expires_at
     FROM user_permissions up
     JOIN permissions p ON p.id = up.permission_id
     WHERE up.uid = ?`,
    [uid]
  );
  const now = Date.now();
  for (const row of direct) {
    if (row.expires_at && new Date(row.expires_at).getTime() < now) continue;
    if (row.effect === 'deny') {
      // Denies are global by design (resource-scoped denies add complexity we don't need yet).
      perms.denies.add(row.key);
      continue;
    }
    if (row.resource_type && row.resource_id != null) {
      let bucket = perms.scoped.get(row.key);
      if (!bucket) {
        bucket = new Set();
        perms.scoped.set(row.key, bucket);
      }
      bucket.add(`${row.resource_type}:${row.resource_id}`);
    } else {
      perms.global.add(row.key);
    }
  }

  cache.set(uid, { perms, expiresAt: Date.now() + CACHE_TTL_MS });
  return perms;
};

const invalidate = (uid) => {
  if (uid == null) cache.clear();
  else cache.delete(uid);
};

// scope: { type, id } | undefined
const can = (perms, key, scope) => {
  if (!perms) return false;
  if (perms.denies.has(key)) return false;
  if (perms.global.has(key)) return true;
  if (scope && scope.type && scope.id != null) {
    const bucket = perms.scoped.get(key);
    if (bucket && bucket.has(`${scope.type}:${scope.id}`)) return true;
  }
  return false;
};

// Convenience: flatten effective permission keys into an array (global only).
// Used by getUserInfo to feed the frontend `$can` helper.
const listGlobalKeys = (perms) => Array.from(perms.global).filter((k) => !perms.denies.has(k));

module.exports = {
  loadEffectivePermissions,
  invalidate,
  can,
  listGlobalKeys,
};
