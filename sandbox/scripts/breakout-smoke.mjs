#!/usr/bin/env node
//
// Breakout battery — adversarial "爆破" probes that push on attack surfaces the
// baseline corpus does not cover: parallel CPU accounting, whole-cgroup memory
// accounting across processes, raw device / kernel memory nodes, procfs kernel
// knobs + oom_score_adj lowering, and output/cached-output symlink exfiltration.
//
// These programs are defensive regression tests. None of them attempt a real
// escape or exfiltration payload beyond reading world-readable probe files;
// each one asserts that the sandbox *refuses* or *bounds* the operation.
//
//   SANDBOX_URL=http://127.0.0.1:5050 node scripts/breakout-smoke.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = process.env.SANDBOX_URL
  ? [process.env.SANDBOX_URL]
  : ['http://127.0.0.1:5050', 'http://127.0.0.1:1145'];

const normalizeBase = (url) => url.replace(/\/+$/, '');

const detectBase = async () => {
  for (const raw of candidates) {
    const base = normalizeBase(raw);
    try {
      const res = await fetch(`${base}/api/version`);
      if (res.ok) return base;
    } catch {
      // try next
    }
  }
  throw new Error(`sandbox is not reachable; tried ${candidates.map(normalizeBase).join(', ')}`);
};

const base = await detectBase();
console.log(`breakout battery target: ${base}`);

const stdFiles = (input = '', stdoutMax = 256 * 1024, stderrMax = 256 * 1024) => [
  { content: input },
  { name: 'stdout', max: stdoutMax },
  { name: 'stderr', max: stderrMax },
];

const baseCmd = (command, extra = {}) => {
  const { cpuMs, wallMs, memoryMB, stackMB, processes, ...rest } = extra;
  return {
    command,
    env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'HOME=/tmp'],
    stdio: stdFiles(),
    limits: {
      cpuMs: cpuMs ?? 2000,
      wallMs: wallMs ?? 5000,
      memoryMB: memoryMB ?? 128,
      stackMB: stackMB ?? 128,
      processes: processes ?? 20,
    },
    outputFiles: ['stdout', 'stderr'],
    ...rest,
  };
};

const readExample = (name) => fs.readFileSync(path.join(root, 'examples', name), 'utf8');

const postRun = async (body) => {
  const res = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep raw text for assertions
  }
  return { ok: res.ok, status: res.status, text, json };
};

const run = async (cmd) => {
  const res = await postRun({ commands: [cmd] });
  if (!res.ok) throw new Error(`POST /api/run failed: ${res.status} ${res.text}`);
  return res.json[0];
};

const deleteCached = (fileId) => fetch(`${base}/api/file/${fileId}`, { method: 'DELETE' }).catch(() => {});
const cachedIds = [];

const compileC = async (sourceName, outputName, compilerArgs = []) => {
  const source = readExample(sourceName);
  const result = await run(baseCmd([
    '/usr/bin/gcc', '-O2', '-std=c11', '-Wall', '-Wextra',
    ...compilerArgs, sourceName, '-o', outputName,
  ], {
    cpuMs: 10000,
    wallMs: 20000,
    memoryMB: 512,
    stackMB: 512,
    processes: 50,
    inputFiles: { [sourceName]: { content: source } },
    cachedOutputs: [outputName],
    cachePrefix: 'nywOJ_breakout',
  }));
  if (result.status !== 'Accepted' || !result.cachedFiles?.[outputName]) {
    throw new Error(`${sourceName} compile failed: ${JSON.stringify(result)}`);
  }
  cachedIds.push(result.cachedFiles[outputName]);
  return result.cachedFiles[outputName];
};

const runCached = (binaryName, fileId, extra = {}) =>
  run(baseCmd([binaryName], { inputFiles: { [binaryName]: { cachedFile: fileId } }, ...extra }));

const expect = (ok, message) => { if (!ok) throw new Error(message); };
const expectStatus = (result, status, label) =>
  expect(result.status === status, `${label}: expected ${status}, got ${JSON.stringify(result)}`);
const expectAcceptedWithoutFail = (result, label) => {
  expectStatus(result, 'Accepted', label);
  expect(!/FAIL/.test(result.outputFiles?.stdout || ''), `${label}: probe reported FAIL ${JSON.stringify(result.outputFiles)}`);
};

const tests = [];
const add = (category, name, fn) => tests.push({ category, name, fn });

add('cpu', 'parallel CPU farm is bounded, not left running', async (ctx) => {
  const r = await runCached('cpu_farm', ctx.cpuFarm, {
    cpuMs: 2000,
    wallMs: 700,
    memoryMB: 64,
    processes: 16,
  });
  expectStatus(r, 'Time Limit Exceeded', 'cpu farm');
  // Not asserted, just surfaced: main-process CPU accounting can look tiny
  // next to wall time if group accounting regresses.
  console.log(`      cpu_farm cpuTimeMs=${r.cpuTimeMs}ms wallTimeMs=${r.wallTimeMs}ms`);
});

add('cpu', 'forking cannot multiply the CPU budget past the limit', async (ctx) => {
  // 5 workers each burn a bounded amount of CPU in parallel; the main process
  // only waits. Whole-cgroup CPU must be accounted, so this is TLE even though
  // the main process burns little CPU and the wall time stays under the limit.
  const r = await runCached('cpu_multiplier', ctx.cpuMultiplier, {
    cpuMs: 1000,
    wallMs: 6000,
    memoryMB: 128,
    processes: 16,
  });
  expectStatus(r, 'Time Limit Exceeded', 'cpu multiplier');
  expect(r.cpuTimeMs >= 1000, `group CPU should be accounted >= 1000ms, got ${r.cpuTimeMs}ms`);
});

add('memory', 'multi-process memory bomb hits cgroup limit', async (ctx) => {
  const r = await runCached('mem_multiproc', ctx.memMultiproc, {
    cpuMs: 3000,
    wallMs: 5000,
    memoryMB: 64,
    processes: 16,
  });
  expectStatus(r, 'Memory Limit Exceeded', 'mem multiproc');
});

add('device', 'raw device / kernel memory nodes are unreachable', async (ctx) => {
  const r = await runCached('dev_probe', ctx.devProbe);
  expectAcceptedWithoutFail(r, 'dev_probe');
});

add('procfs', 'kernel knobs and oom_score_adj lowering are denied', async (ctx) => {
  const r = await runCached('procfs_probe', ctx.procfsProbe);
  expectAcceptedWithoutFail(r, 'procfs_probe');
});

add('fd', 'only stdio fds are inherited across execve', async (ctx) => {
  const r = await runCached('fd_leak_probe', ctx.fdLeakProbe);
  expectAcceptedWithoutFail(r, 'fd_leak_probe');
});

add('escape', 'pivot_root contains .. / proc-root traversal', async (ctx) => {
  const r = await runCached('box_escape_probe', ctx.boxEscapeProbe);
  expectAcceptedWithoutFail(r, 'box_escape_probe');
});

add('namespace', 'clone(CLONE_NEWUSER) cannot nest a user namespace', async (ctx) => {
  const r = await runCached('userns_probe', ctx.usernsProbe);
  expectAcceptedWithoutFail(r, 'userns_probe');
});

add('pipe', 'unread pipe consumer cannot hang the judge', async () => {
  // cmd0 floods its stdout (mapped into cmd1's stdin); cmd1 sleeps and never
  // reads. The 64K pipe fills, cmd0 blocks on write, and both must be bounded
  // by the wall limit — the request must return, not hang the supervisor.
  const res = await postRun({
    commands: [
      baseCmd(['/bin/sh', '-c', 'dd if=/dev/zero bs=65536 count=1000000 2>/dev/null'], {
        wallMs: 700, cpuMs: 2000,
      }),
      baseCmd(['/bin/sh', '-c', 'sleep 5'], {
        wallMs: 700, cpuMs: 2000,
      }),
    ],
    pipes: [{ from: { command: 0, fd: 1 }, to: { command: 1, fd: 0 } }],
  });
  expect(res.ok, `piped run failed: ${res.status} ${res.text}`);
  expect(Array.isArray(res.json) && res.json.length === 2, `piped shape unexpected: ${res.text}`);
  expectStatus(res.json[0], 'Time Limit Exceeded', 'blocked pipe writer');
  expectStatus(res.json[1], 'Time Limit Exceeded', 'idle pipe reader');
});

add('pipe', 'pipe writer exit gives reader a clean EOF', async () => {
  const res = await postRun({
    commands: [
      baseCmd(['/bin/sh', '-c', 'printf hello'], { wallMs: 2000 }),
      baseCmd(['/bin/cat'], { wallMs: 2000, outputFiles: ['stdout', 'stderr'] }),
    ],
    pipes: [{ from: { command: 0, fd: 1 }, to: { command: 1, fd: 0 } }],
  });
  expect(res.ok, `piped run failed: ${res.status} ${res.text}`);
  expect(Array.isArray(res.json) && res.json.length === 2, `piped shape unexpected: ${res.text}`);
  expectStatus(res.json[0], 'Accepted', 'pipe writer');
  expectStatus(res.json[1], 'Accepted', 'pipe reader');
  expect(res.json[1].outputFiles?.stdout === 'hello', `reader should see piped data: ${JSON.stringify(res.json[1])}`);
});

add('exfil', 'output file symlink to host file is refused', async () => {
  const r = await run(baseCmd(['/usr/bin/python3', '-c', "import os\nos.symlink('/etc/passwd', 'leak')"], {
    outputFiles: ['stdout', 'stderr', 'leak'],
  }));
  expectStatus(r, 'Internal Error', 'output symlink');
  expect(!(r.outputFiles?.leak), `output symlink leaked host file: ${JSON.stringify(r.outputFiles)}`);
});

add('exfil', 'cached output symlink to host file is refused', async () => {
  const r = await run(baseCmd(['/usr/bin/python3', '-c', "import os\nos.symlink('/etc/shadow', 'leak')"], {
    cachedOutputs: ['leak'],
    cachePrefix: 'nywOJ_breakout_exfil',
  }));
  expectStatus(r, 'Internal Error', 'cached output symlink');
  expect(!r.cachedFiles?.leak, `cached output symlink cached host file: ${JSON.stringify(r)}`);
});

add('exfil', 'nested output symlink to host file is refused', async () => {
  const r = await run(baseCmd(['/usr/bin/python3', '-c', "import os\nos.mkdir('d')\nos.symlink('/etc/passwd', 'd/leak')"], {
    outputFiles: ['stdout', 'stderr', 'd/leak'],
  }));
  expectStatus(r, 'Internal Error', 'nested output symlink');
  expect(!(r.outputFiles?.['d/leak']), `nested output symlink leaked host file: ${JSON.stringify(r.outputFiles)}`);
});

const context = {
  cpuFarm: await compileC('cpu_farm.c', 'cpu_farm'),
  cpuMultiplier: await compileC('cpu_multiplier.c', 'cpu_multiplier'),
  memMultiproc: await compileC('mem_multiproc.c', 'mem_multiproc'),
  devProbe: await compileC('dev_probe.c', 'dev_probe'),
  procfsProbe: await compileC('procfs_probe.c', 'procfs_probe'),
  fdLeakProbe: await compileC('fd_leak_probe.c', 'fd_leak_probe'),
  boxEscapeProbe: await compileC('box_escape_probe.c', 'box_escape_probe'),
  usernsProbe: await compileC('userns_probe.c', 'userns_probe'),
};

let failures = 0;
try {
  for (const { category, name, fn } of tests) {
    try {
      await fn(context);
      console.log(`PASS [${category}] ${name}`);
    } catch (err) {
      failures++;
      console.error(`FAIL [${category}] ${name}`);
      console.error(`  ${err.message}`);
    }
  }
} finally {
  await Promise.all(cachedIds.map(deleteCached));
}

const passed = tests.length - failures;
console.log(`breakout battery summary: ${passed}/${tests.length} passed`);
if (failures > 0) process.exit(1);
