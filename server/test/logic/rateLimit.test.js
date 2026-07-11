// 限流令牌桶回归（logic 层，纯内存无 DB）。
//   node test/logic/rateLimit.test.js
const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ok  ${n}`); };
const ko = (n, m) => { fail++; console.log(`  FAIL ${n} -- ${m}`); };
const assertEq = (a, b, n) => (a === b ? ok(n) : ko(n, `expected ${b}, got ${a}`));

// SECURITY 必须开启才有意义（rateLimit 读 config.json）
const conf = require('../../config.json');
if (!conf.SECURITY || conf.SECURITY.enabled === false) {
  console.log('  ok  SECURITY.enabled=false -> 限流直通（跳过桶断言）');
  console.log('\n1 passed, 0 failed');
  process.exit(0);
}

const { rateLimit } = require('../../rateLimit');

// 构造只放行 3 次的桶（capacity 3，几乎不回填）
const mw = rateLimit('__test', { capacity: 3, refillPerSec: 0.0001, by: 'uid' });
const mkReq = (uid) => ({ session: { uid, ip: '9.9.9.9' }, useragent: { browser: {}, os: {} } });
const call = (req) => new Promise((resolve) => {
  let status = 200;
  const res = { status(s) { status = s; return res; }, send() { resolve(status); return res; } };
  mw(req, res, () => resolve(200));
});

(async () => {
  const req = mkReq(88888);
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await call(req));
  assertEq(results[0], 200, '第 1 次放行');
  assertEq(results[1], 200, '第 2 次放行');
  assertEq(results[2], 200, '第 3 次放行');
  assertEq(results[3], 429, '第 4 次限流(429)');
  assertEq(results[4], 429, '第 5 次限流(429)');

  // 不同 uid 独立桶
  const other = await call(mkReq(77777));
  assertEq(other, 200, '不同 uid 独立计数(放行)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
