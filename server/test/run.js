#!/usr/bin/env node
// =============================================================================
// 回归测试 runner。按 manifest 顺序 fork 执行每个测试脚本，汇总结果。
// 任一脚本非零退出 -> 整体非零退出（CI 红）。
//
//   node test/run.js logic     只跑纯逻辑层（CI）
//   node test/run.js e2e       只跑 e2e 层（需活沙箱 / LLM key，本地）
//   node test/run.js all       先 logic 再 e2e（e2e 前置不满足则跳过并提示）
//   node test/run.js           等价 all
// =============================================================================
const path = require('path');
const { spawnSync } = require('child_process');
const http = require('http');

const SERVER_DIR = path.join(__dirname, '..');
const manifest = require('./manifest');

const layer = (process.argv[2] || 'all').toLowerCase();

// e2e 前置探测：sandbox(:5050) 是否可达 / 是否配置了 LLM key。
const probeSandbox = () =>
  new Promise((resolve) => {
    const url = process.env.NYWOJ_SANDBOX_URL || 'http://127.0.0.1:5050';
    const req = http.get(`${url}/api/version`, { timeout: 2500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });

const hasLlmKey = () => {
  try {
    const conf = require(path.join(SERVER_DIR, 'config.json'));
    return !!(process.env.NYWOJ_LLM_KEY || (conf.LLM && conf.LLM.apiKey) || conf.LLM_TEST_KEY);
  } catch (e) { return false; }
};

const runOne = (entry) => {
  const started = Date.now();
  const res = spawnSync('node', [entry.path, ...(entry.args || [])], {
    cwd: SERVER_DIR,
    stdio: 'inherit',
    env: process.env,
  });
  const ms = Date.now() - started;
  const code = res.status == null ? 1 : res.status;
  return { code, ms };
};

(async () => {
  const layers = layer === 'all' ? ['logic', 'e2e'] : [layer];
  if (!['logic', 'e2e', 'all'].includes(layer)) {
    console.error(`未知层 "${layer}"，用 logic | e2e | all`);
    process.exit(2);
  }

  const sandboxUp = layers.includes('e2e') ? await probeSandbox() : false;
  const llmUp = layers.includes('e2e') ? hasLlmKey() : false;

  const results = [];
  let failed = 0;

  for (const lyr of layers) {
    const entries = manifest[lyr] || [];
    console.log(`\n======== ${lyr.toUpperCase()} 层（${entries.length} 项）========`);
    for (const entry of entries) {
      if (entry.needs === 'sandbox' && !sandboxUp) {
        console.log(`\n[跳过] ${entry.path} — 需要活沙箱(:5050)，未探测到`);
        results.push({ ...entry, skipped: true });
        continue;
      }
      if (entry.needs === 'llm' && !llmUp) {
        console.log(`\n[跳过] ${entry.path} — 需要 LLM key，未配置`);
        results.push({ ...entry, skipped: true });
        continue;
      }
      console.log(`\n---- ${entry.path} — ${entry.desc} ----`);
      const { code, ms } = runOne(entry);
      if (code !== 0) failed++;
      results.push({ ...entry, code, ms });
    }
  }

  console.log('\n======== 汇总 ========');
  for (const r of results) {
    if (r.skipped) { console.log(`  SKIP  ${r.path}`); continue; }
    const tag = r.code === 0 ? ' OK ' : 'FAIL';
    console.log(`  ${tag}  ${r.path}  (${r.ms}ms)`);
  }
  const ran = results.filter((r) => !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`\n${ran} ran, ${failed} failed, ${skipped} skipped`);
  process.exit(failed > 0 ? 1 : 0);
})();
