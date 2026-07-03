#!/usr/bin/env node
// Backfill judgeProfile for every problem that has none, deriving the canonical
// profile from its existing `type` (profileForType). Idempotent: problems that
// already have a stored profile are left untouched.
//
//   node db/migrate_profiles.js          # dry run: show what WOULD change
//   node db/migrate_profiles.js --apply  # write the backfill
const db = require('./');
const { profileForType } = require('../api/problem/judgeProfile');

const apply = process.argv.includes('--apply');

(async () => {
  const rows = await db.query('SELECT pid, type, judgeProfile FROM problem ORDER BY pid');
  let changed = 0;

  for (const r of rows) {
    if (r.judgeProfile) continue; // already configured — never clobber
    const profile = profileForType(r.type);
    console.log(`backfill pid=${r.pid} type=${r.type} → preset=${profile.preset}`);
    if (apply) await db.query('UPDATE problem SET judgeProfile=? WHERE pid=?', [JSON.stringify(profile), r.pid]);
    changed++;
  }
  console.log(`\n${changed} problem(s) ${apply ? 'backfilled' : 'would be backfilled (dry run — pass --apply to write)'}`);
  process.exit(0);
})().catch((e) => { console.error('migrate failed:', e.message); process.exit(1); });
