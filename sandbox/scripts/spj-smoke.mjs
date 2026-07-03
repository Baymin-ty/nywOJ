#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.env.SANDBOX_URL || 'http://127.0.0.1:5050').replace(/\/+$/, '');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const run = async (cmd) => {
  const res = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commands: [cmd] }),
  });
  const text = await res.text();
  assert(res.ok, `POST /api/run failed: ${res.status} ${text}`);
  return JSON.parse(text)[0];
};

const deleteCached = (fileId) =>
  fetch(`${base}/api/file/${fileId}`, { method: 'DELETE' }).catch(() => {});

const stdFiles = (input = '', stdoutMax = 1024 * 1024, stderrMax = 1024 * 1024) => [
  { content: input },
  { name: 'stdout', max: stdoutMax },
  { name: 'stderr', max: stderrMax },
];

const testlib = fs.readFileSync(path.join(root, 'server/comparer/testlib.h'), 'utf8');
const checker = String.raw`
#include "testlib.h"

int main(int argc, char *argv[]) {
  registerTestlibCmd(argc, argv);
  int got = ouf.readInt();
  int expected = ans.readInt();
  if (got == expected) quitf(_ok, "answer is %d", got);
  if (got == 42) quitp(0.5, "partial credit path");
  quitf(_wa, "expected %d, found %d", expected, got);
}
`;

const compile = await run({
  command: ['/usr/bin/g++-9', '-O2', '-std=c++14', '-DONLINE_JUDGE', 'checker.cpp', '-o', 'spj'],
  env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'HOME=/tmp'],
  stdio: stdFiles(),
  limits: {
    cpuMs: 10000,
    wallMs: 20000,
    memoryMB: 512,
    stackMB: 512,
    processes: 50,
  },
  inputFiles: {
    'checker.cpp': { content: checker },
    'testlib.h': { content: testlib },
  },
  outputFiles: ['stdout', 'stderr'],
  cachedOutputs: ['spj'],
  cachePrefix: 'nywOJ_spj_smoke',
});

assert(compile.status === 'Accepted' && compile.exitCode === 0, `SPJ compile failed: ${JSON.stringify(compile)}`);
const fileId = compile.cachedFiles && compile.cachedFiles.spj;
assert(fileId, `SPJ compile did not return fileId: ${JSON.stringify(compile)}`);

const check = (usr, ans) => run({
  command: ['spj', 'data.in', 'usr.out', 'data.out'],
  env: ['PATH=/usr/bin:/bin', 'HOME=/tmp'],
  stdio: stdFiles(),
  limits: {
    cpuMs: 5000,
    wallMs: 10000,
    memoryMB: 512,
    stackMB: 512,
    processes: 50,
  },
  inputFiles: {
    spj: { cachedFile: fileId },
    'data.in': { content: 'case\n' },
    'usr.out': { content: `${usr}\n` },
    'data.out': { content: `${ans}\n` },
  },
  outputFiles: ['stdout', 'stderr'],
});

try {
  const ok = await check(7, 7);
  assert(ok.status === 'Accepted' && ok.exitCode === 0, `SPJ ok verdict failed: ${JSON.stringify(ok)}`);
  assert(/^ok/i.test((ok.outputFiles && ok.outputFiles.stderr) || ''), `SPJ ok stderr unexpected: ${JSON.stringify(ok.outputFiles)}`);

  const wa = await check(3, 7);
  assert(wa.status === 'Nonzero Exit Status' && wa.exitCode === 1, `SPJ wa verdict failed: ${JSON.stringify(wa)}`);
  assert(/^wrong answer/i.test((wa.outputFiles && wa.outputFiles.stderr) || ''), `SPJ wa stderr unexpected: ${JSON.stringify(wa.outputFiles)}`);

  const partial = await check(42, 7);
  assert(partial.status === 'Nonzero Exit Status' && partial.exitCode === 7, `SPJ partial verdict failed: ${JSON.stringify(partial)}`);
  assert(/^points/i.test((partial.outputFiles && partial.outputFiles.stderr) || ''), `SPJ partial stderr unexpected: ${JSON.stringify(partial.outputFiles)}`);
} finally {
  await deleteCached(fileId);
}

console.log('spj smoke passed');
