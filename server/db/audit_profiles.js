#!/usr/bin/env node
// Profile health audit (read-only): for every problem, take its effective judge
// profile (stored, else derived from `type`) and run profileHealth — validate
// the profile + check every declared asset exists on disk.
//
//   node db/audit_profiles.js            # audit all problems
//   node db/audit_profiles.js --bad      # only print problems with errors
//
// Exit code 0 = all healthy, 1 = at least one problem has blocking errors.
const db = require('./');
const { profileForType, profileHealth, listAssetsOf } = require('../api/problem/judgeProfile');

const onlyBad = process.argv.includes('--bad');

(async () => {
  const rows = await db.query('SELECT pid, title, type, judgeProfile FROM problem ORDER BY pid');
  let bad = 0;
  let migrated = 0;
  for (const r of rows) {
    let profile = null;
    let stored = false;
    if (r.judgeProfile) { try { profile = JSON.parse(r.judgeProfile); stored = true; } catch (_) { profile = null; } }
    if (!profile) profile = profileForType(r.type);
    if (stored) migrated++;
    const assets = listAssetsOf(r.pid).map((a) => a.name);
    const h = profileHealth(profile, assets);
    if (!h.ok) bad++;
    if (h.ok && onlyBad) continue;
    const tag = h.ok ? 'OK ' : 'ERR';
    const src = stored ? 'stored' : `type=${r.type}→${profile.preset}`;
    console.log(`[${tag}] pid=${r.pid} (${src}) ${r.title || ''}`);
    h.errors.forEach((e) => console.log(`        ✗ ${e}`));
    h.warnings.forEach((w) => console.log(`        ! ${w}`));
  }
  console.log(`\n— ${rows.length} problems, ${migrated} with stored profile, ${bad} with errors —`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('audit failed:', e.message); process.exit(2); });
