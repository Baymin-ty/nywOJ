const { loadEffectivePermissions, can } = require('./policy');

// Attaches req.perms and req.can(key, scope?). Always runs after session middleware.
const attachPermissions = async (req, res, next) => {
  try {
    req.perms = await loadEffectivePermissions(req.session && req.session.uid);
    req.can = (key, scope) => can(req.perms, key, scope);
    return next();
  } catch (err) {
    return next(err);
  }
};

// Express middleware factory. `opts.scopeFrom(req)` -> { type, id } | undefined.
// The returned function carries `permissionKey` so the router stack can be
// walked to build a permission → endpoints map without a separate registry.
// `key` may be a single string OR an array of strings (any-of: passes if the
// caller holds at least one of them). The any-of form is for read endpoints
// usable by multiple admin sub-roles (e.g. user listing serves both
// user.manage and user.role.admin).
const requirePermission = (key, opts = {}) => {
  const keys = Array.isArray(key) ? key : [key];
  const fn = async (req, res, next) => {
    try {
      if (!req.perms) req.perms = await loadEffectivePermissions(req.session && req.session.uid);
      const scope = typeof opts.scopeFrom === 'function' ? opts.scopeFrom(req) : undefined;
      if (!keys.some((k) => can(req.perms, k, scope))) return res.status(403).end('403 Forbidden');
      return next();
    } catch (err) {
      return next(err);
    }
  };
  fn.permissionKey = key;
  return fn;
};

module.exports = { attachPermissions, requirePermission };
