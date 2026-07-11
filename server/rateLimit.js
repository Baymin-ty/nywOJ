// 统一限流中间件（内存令牌桶）。单实例内存实现——多实例部署需换 Redis。
// 配置见 config.SECURITY（enabled=false 一键关闭，本地/CI 友好）。
const conf = require('./config.json');
const { recordEvent } = require('./static');

const SEC = conf.SECURITY || {};
const ENABLED = SEC.enabled !== false; // 默认开启

// key -> { tokens, last }
const buckets = new Map();
// 429 频次统计（撞限流达阈值写审计）：key -> { count, windowStart }
const abuse = new Map();

const now = () => Date.now();

// app.js 已把可信 IP 落到 req.session.ip（只信任本机反代的 XFF）。
const ipOf = (req) => (req.session && req.session.ip) || req.ip || 'unknown';
const uidOf = (req) => (req.session && req.session.uid) || 0;

const keyOf = (req, name, by) => {
  if (by === 'ip') return `${name}:ip:${ipOf(req)}`;
  if (by === 'both') return `${name}:u${uidOf(req)}:${ipOf(req)}`;
  // 'uid'：登录用户按 uid，匿名回退 IP
  const uid = uidOf(req);
  return uid ? `${name}:u${uid}` : `${name}:ip:${ipOf(req)}`;
};

// 取一个令牌；返回 { ok, wait(秒) }
const take = (key, capacity, refillPerSec) => {
  const t = now();
  let b = buckets.get(key);
  if (!b) { b = { tokens: capacity, last: t }; buckets.set(key, b); }
  // 补充
  const elapsed = (t - b.last) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
  b.last = t;
  if (b.tokens >= 1) { b.tokens -= 1; return { ok: true, wait: 0 }; }
  const wait = Math.ceil((1 - b.tokens) / refillPerSec);
  return { ok: false, wait };
};

// 撞限流累计：1 分钟窗口内超阈值写一次审计（撞库/刷接口信号）
const noteAbuse = (req, name) => {
  const key = keyOf(req, name, 'both');
  const t = now();
  let a = abuse.get(key);
  if (!a || t - a.windowStart > 60000) { a = { count: 0, windowStart: t }; abuse.set(key, a); }
  a.count++;
  if (a.count === (SEC.abuseAuditThreshold || 20)) {
    try { recordEvent(req, 'security.rateLimit.abuse', { rule: name, count: a.count }); } catch (e) { /* best effort */ }
  }
};

// 工厂：rateLimit('submit', { capacity, refillPerSec, by })
const rateLimit = (name, { capacity, refillPerSec, by = 'uid' }) => (req, res, next) => {
  if (!ENABLED) return next();
  // 每条规则允许 config.SECURITY.rules[name] 覆盖 { capacity, refillPerSec }
  const ov = (SEC.rules && SEC.rules[name]) || {};
  const cap = ov.capacity != null ? ov.capacity : capacity;
  const refill = ov.refillPerSec != null ? ov.refillPerSec : refillPerSec;
  const { ok, wait } = take(keyOf(req, name, by), cap, refill);
  if (ok) return next();
  noteAbuse(req, name);
  return res.status(429).send({ message: `操作过于频繁，请 ${wait} 秒后再试`, wait });
};

// 定期清扫空闲桶，防内存无界
const sweep = () => {
  const t = now();
  for (const [k, b] of buckets) if (t - b.last > 600000) buckets.delete(k); // 10min 空闲
  for (const [k, a] of abuse) if (t - a.windowStart > 120000) abuse.delete(k);
};
const sweepTimer = setInterval(sweep, 300000);
if (sweepTimer.unref) sweepTimer.unref();

module.exports = { rateLimit, ENABLED, _buckets: buckets };
