// Walks the express router stack and returns a map of permission key →
// list of endpoints (e.g. "POST /api/problem/createProblem"). Built lazily
// on first call to avoid the require cycle (router → api/auth → endpoints
// → router). Cached; the router is static after boot.

let cached = null;

const buildEndpointMap = () => {
  if (cached) return cached;
  // Lazy require to break the cycle.
  const router = require('../router');
  const map = new Map();
  const stack = (router && router.stack) || [];

  for (const layer of stack) {
    if (!layer.route) continue;
    const path = layer.route.path;
    const methods = Object.keys(layer.route.methods || {});
    const method = methods[0] ? methods[0].toUpperCase() : 'POST';
    // route.stack contains one Layer per handler; the requirePermission
    // wrapper is tagged with permissionKey on its `handle` property.
    for (const sub of (layer.route.stack || [])) {
      const handle = sub && sub.handle;
      const key = handle && handle.permissionKey;
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(`${method} ${path}`);
    }
  }
  cached = map;
  return map;
};

const endpointsFor = (permissionKey) => {
  const map = buildEndpointMap();
  return map.get(permissionKey) || [];
};

module.exports = { buildEndpointMap, endpointsFor };
