// CI/全新库最小种子数据（逻辑测试前置）。幂等，可重复执行。
//   node scripts/ci_seed.js
//
// 为什么需要：
//   - uid=1 恒为 root（拥有全部权限）。空库 userInfo AUTO_INCREMENT 从 1 起，
//     测试自种的第一个用户会撞成 uid=1=root，破坏所有权限隔离断言。
//     先占住 uid=1，后续种子用户即 uid≥2。
//   - languages 表需有基础语言行（判题 / 提交路径引用）。
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const db = require('../db');
const { syncLanguages } = require('./../api/judge/languages');

(async () => {
  try {
    await db.query(
      'INSERT INTO userInfo (uid, name, pwd, reg_time) VALUES (1, ?, ?, NOW()) ' +
      'ON DUPLICATE KEY UPDATE uid=uid',
      ['root', '!ci-placeholder']
    );
    await syncLanguages(db);
    const langs = await db.one('SELECT COUNT(*) AS c FROM languages');
    console.log(`ci seed 完成：uid=1 占位；languages=${langs.c}`);
    db.pool.end(() => process.exit(0));
  } catch (e) {
    console.error('ci seed 失败:', e && e.stack || e);
    db.pool.end(() => process.exit(1));
  }
})();
