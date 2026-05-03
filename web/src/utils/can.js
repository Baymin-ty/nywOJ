import store from '@/sto/store';

// UI-only permission check. Server is always the final arbiter.
// scope is { type, id } | undefined; scoped grants are fetched per-page on demand,
// so for now `can` only inspects the global keys returned by getUserInfo.
export const can = (key) => {
  if (!key) return false;
  const list = store.state.permissions || [];
  return list.indexOf(key) >= 0;
};

export const canAny = (...keys) => keys.some((k) => can(k));

// Mixin to expose this.$can(...) inside templates.
export default {
  install(app) {
    app.config.globalProperties.$can = can;
    app.config.globalProperties.$canAny = canAny;
  },
};
