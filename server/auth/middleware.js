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
const requirePermission = (key, opts = {}) => async (req, res, next) => {
  try {
    if (!req.perms) req.perms = await loadEffectivePermissions(req.session && req.session.uid);
    const scope = typeof opts.scopeFrom === 'function' ? opts.scopeFrom(req) : undefined;
    if (!can(req.perms, key, scope)) return res.status(403).end('403 Forbidden');
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = { attachPermissions, requirePermission };
