#!/usr/bin/env node

const base = (process.env.SANDBOX_URL || 'http://127.0.0.1:5050').replace(/\/+$/, '');

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const run = async (body) => {
  const res = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  assert(res.ok, `POST /api/run failed: ${res.status} ${text}`);
  return JSON.parse(text);
};

const defaultLimits = {
  cpuMs: 2000,
  wallMs: 5000,
  memoryMB: 128,
  stackMB: 128,
  processes: 20,
};

const user = [
  'import sys',
  'x = sys.stdin.readline().strip()',
  "print('reply:' + x, flush=True)",
  '',
].join('\n');

const judge = [
  'import sys',
  "print('ping', flush=True)",
  'got = sys.stdin.readline().strip()',
  "print('ok ' + got, file=sys.stderr, flush=True)",
  '',
].join('\n');

const results = await run({
  commands: [
    {
      command: ['/usr/bin/python3', '-u', '-c', user],
      env: ['PATH=/usr/bin:/bin', 'HOME=/tmp'],
      stdio: [null, null, { name: 'stderr', max: 1024 * 1024 }],
      limits: defaultLimits,
    },
    {
      command: ['/usr/bin/python3', '-u', '-c', judge],
      env: ['PATH=/usr/bin:/bin', 'HOME=/tmp'],
      stdio: [null, null, { name: 'stderr', max: 1024 * 1024 }],
      limits: defaultLimits,
    },
  ],
  pipes: [
    { from: { command: 0, fd: 1 }, to: { command: 1, fd: 0 } },
    { from: { command: 1, fd: 1 }, to: { command: 0, fd: 0 } },
  ],
});

assert(Array.isArray(results) && results.length === 2, `unexpected result shape: ${JSON.stringify(results)}`);
assert(results[0].status === 'Accepted', `user status=${results[0].status}`);
assert(results[1].status === 'Accepted', `judge status=${results[1].status}`);
assert((results[1].outputFiles && results[1].outputFiles.stderr || '').includes('ok reply:ping'), `judge stderr=${JSON.stringify(results[1].outputFiles)}`);

console.log('pipe smoke passed');
