#!/usr/bin/env node

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
      // Try the next common local port.
    }
  }
  throw new Error(`sandbox is not reachable; tried ${candidates.map(normalizeBase).join(', ')}`);
};

const base = await detectBase();
console.log(`malicious corpus target: ${base}`);

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
    // Keep the raw body for assertion messages.
  }
  return { ok: res.ok, status: res.status, text, json };
};

const run = async (cmd) => {
  const res = await postRun({ commands: [cmd] });
  if (!res.ok) throw new Error(`POST /api/run failed: ${res.status} ${res.text}`);
  return res.json[0];
};

const deleteCached = (fileId) =>
  fetch(`${base}/api/file/${fileId}`, { method: 'DELETE' }).catch(() => {});

const cachedIds = [];

const compileC = async (sourceName, outputName, compilerArgs = []) => {
  const source = readExample(sourceName);
  const result = await run(baseCmd([
    '/usr/bin/gcc',
    '-O2',
    '-std=c11',
    '-Wall',
    '-Wextra',
    ...compilerArgs,
    sourceName,
    '-o',
    outputName,
  ], {
    cpuMs: 10000,
    wallMs: 20000,
    memoryMB: 512,
    stackMB: 512,
    processes: 50,
    inputFiles: { [sourceName]: { content: source } },
    cachedOutputs: [outputName],
    cachePrefix: 'nywOJ_malicious_corpus',
  }));
  if (result.status !== 'Accepted' || !result.cachedFiles?.[outputName]) {
    throw new Error(`${sourceName} compile failed: ${JSON.stringify(result)}`);
  }
  cachedIds.push(result.cachedFiles[outputName]);
  return result.cachedFiles[outputName];
};

const runCached = (binaryName, fileId, extra = {}) =>
  run(baseCmd([binaryName], {
    inputFiles: { [binaryName]: { cachedFile: fileId } },
    ...extra,
  }));

const expect = (ok, message) => {
  if (!ok) throw new Error(message);
};

const expectStatus = (result, status, label) => {
  expect(result.status === status, `${label}: expected ${status}, got ${JSON.stringify(result)}`);
};

const expectAcceptedWithoutFail = (result, label) => {
  expectStatus(result, 'Accepted', label);
  expect(!/FAIL/.test(result.outputFiles?.stdout || ''), `${label}: stdout reported failure ${JSON.stringify(result.outputFiles)}`);
};

const tests = [];
const add = (category, name, fn) => tests.push({ category, name, fn });

add('resource', 'cpu spin is killed by time limit', async () => {
  const r = await run(baseCmd(['/bin/sh', '-c', 'while :; do :; done'], {
    cpuMs: 100,
    wallMs: 700,
    memoryMB: 64,
  }));
  expectStatus(r, 'Time Limit Exceeded', 'cpu spin');
});

add('resource', 'wall-clock sleep is killed by wall limit', async () => {
  const r = await run(baseCmd(['/bin/sh', '-c', 'sleep 5'], {
    cpuMs: 1000,
    wallMs: 300,
    memoryMB: 64,
  }));
  expectStatus(r, 'Time Limit Exceeded', 'wall sleep');
});

add('resource', 'memory hog is killed by cgroup memory limit', async () => {
  const r = await run(baseCmd(['/usr/bin/python3', '-c', 'a=[]\nwhile True: a.append(bytearray(1024*1024))'], {
    cpuMs: 2000,
    wallMs: 4000,
    memoryMB: 32,
  }));
  expectStatus(r, 'Memory Limit Exceeded', 'memory hog');
});

add('resource', 'stdout flood is truncated and marked OLE', async (ctx) => {
  const r = await runCached('output_flood', ctx.outputFlood, {
    stdio: stdFiles('', 4096, 4096),
  });
  expectStatus(r, 'Output Limit Exceeded', 'stdout flood');
  expect((r.outputFiles?.stdout || '').length === 4096, `stdout flood should capture exactly 4096 bytes: ${JSON.stringify(r.outputFiles)}`);
});

add('resource', 'stderr flood is truncated and marked OLE', async () => {
  const r = await run(baseCmd(['/usr/bin/python3', '-c', "import sys\nsys.stderr.write('E' * (1024 * 1024))"], {
    stdio: stdFiles('', 4096, 4096),
  }));
  expectStatus(r, 'Output Limit Exceeded', 'stderr flood');
  expect((r.outputFiles?.stderr || '').length === 4096, `stderr flood should capture exactly 4096 bytes: ${JSON.stringify(r.outputFiles)}`);
});

add('resource', 'RLIMIT_NOFILE stops descriptor spray', async (ctx) => {
  const r = await runCached('fd_stress', ctx.fdStress);
  expectAcceptedWithoutFail(r, 'fd_stress');
  expect(/PASS nofile/.test(r.outputFiles?.stdout || ''), `fd_stress stdout unexpected: ${JSON.stringify(r.outputFiles)}`);
});

add('resource', 'cgroup pids.max stops fork spray', async (ctx) => {
  const r = await runCached('proc_stress', ctx.procStress, {
    processes: 16,
    wallMs: 4000,
  });
  expectAcceptedWithoutFail(r, 'proc_stress');
  expect(/PASS pids/.test(r.outputFiles?.stdout || ''), `proc_stress stdout unexpected: ${JSON.stringify(r.outputFiles)}`);
});

add('resource', 'cgroup pids.max stops thread spray', async (ctx) => {
  const r = await runCached('thread_stress', ctx.threadStress, {
    processes: 24,
    wallMs: 4000,
  });
  expectAcceptedWithoutFail(r, 'thread_stress');
  expect(/PASS thread/.test(r.outputFiles?.stdout || ''), `thread_stress stdout unexpected: ${JSON.stringify(r.outputFiles)}`);
});

add('resource', 'private /tmp fill hits a bounded limit', async () => {
  const r = await run(baseCmd(['/usr/bin/python3', 'tmp_fill.py'], {
    inputFiles: { 'tmp_fill.py': { content: readExample('tmp_fill.py') } },
    cpuMs: 5000,
    wallMs: 10000,
    memoryMB: 128,
  }));
  expectAcceptedWithoutFail(r, 'tmp_fill');
  expect(/PASS tmp fill/.test(r.outputFiles?.stdout || ''), `tmp_fill stdout unexpected: ${JSON.stringify(r.outputFiles)}`);
});

add('filesystem', 'runtime path probe cannot read or write outside allowed areas', async (ctx) => {
  const r = await runCached('path_probe', ctx.pathProbe);
  expectAcceptedWithoutFail(r, 'path_probe');
});

add('filesystem', 'privilege operations are denied after drop', async (ctx) => {
  const r = await runCached('privilege_probe', ctx.privilegeProbe);
  expectAcceptedWithoutFail(r, 'privilege_probe');
});

add('filesystem', 'common escape control surfaces are absent or denied', async () => {
  const r = await run(baseCmd(['/usr/bin/python3', 'escape_surface_probe.py'], {
    inputFiles: { 'escape_surface_probe.py': { content: readExample('escape_surface_probe.py') } },
  }));
  expectAcceptedWithoutFail(r, 'escape_surface_probe');
});

add('filesystem', 'hardlink to read-only system file is denied', async () => {
  const code = [
    'import errno, os, sys',
    "try:",
    "    os.link('/etc/passwd', '/box/passwd_link')",
    "except OSError as e:",
    "    print('PASS hardlink denied', e.errno, e.strerror)",
    "    sys.exit(0 if e.errno in (errno.EPERM, errno.EXDEV, errno.EACCES, errno.EROFS) else 1)",
    "print('FAIL hardlink unexpectedly succeeded')",
    "sys.exit(1)",
    '',
  ].join('\n');
  const r = await run(baseCmd(['/usr/bin/python3', '-c', code]));
  expectAcceptedWithoutFail(r, 'hardlink deny');
});

add('filesystem', 'output file refuses sandbox-created symlink to host path', async () => {
  const r = await run(baseCmd(['/usr/bin/python3', '-c', "import os\nos.symlink('/etc/passwd', 'leak')"], {
    outputFiles: ['stdout', 'stderr', 'leak'],
  }));
  expectStatus(r, 'Internal Error', 'output symlink');
});

add('filesystem', 'cached output refuses sandbox-created symlink to host path', async () => {
  const r = await run(baseCmd(['/usr/bin/python3', '-c', "import os\nos.symlink('/etc/passwd', 'leak')"], {
    cachedOutputs: ['leak'],
    cachePrefix: 'nywOJ_symlink_probe',
  }));
  expectStatus(r, 'Internal Error', 'cached output symlink');
  expect(!r.cachedFiles?.leak, `symlink should not be cached: ${JSON.stringify(r)}`);
});

add('proc', 'proc namespace and security flags look isolated', async () => {
  const r = await run(baseCmd(['/usr/bin/python3', 'proc_probe.py'], {
    inputFiles: { 'proc_probe.py': { content: readExample('proc_probe.py') } },
  }));
  expectAcceptedWithoutFail(r, 'proc_probe');
});

add('proc', 'environment does not leak sandbox service variables', async () => {
  const r = await run(baseCmd(['/usr/bin/env'], {
    env: ['PATH=/usr/bin:/bin', 'HOME=/tmp', 'NYWOJ_ALLOWED_MARK=present'],
  }));
  expectStatus(r, 'Accepted', 'env probe');
  const out = r.outputFiles?.stdout || '';
  expect(out.includes('NYWOJ_ALLOWED_MARK=present'), `allowed env missing: ${JSON.stringify(out)}`);
  for (const forbidden of ['SANDBOX_CLI=', 'JOBS_ROOT=', 'SANDBOX_FILE_ROOT=', 'RUST_LOG=', 'DATABASE_URL=', 'MYSQL_PASSWORD=']) {
    expect(!out.includes(forbidden), `forbidden env leaked: ${forbidden} in ${JSON.stringify(out)}`);
  }
});

add('network', 'INET/INET6/UNIX sockets are denied by seccomp', async () => {
  const code = [
    'import errno, socket, sys',
    "families = [('inet', socket.AF_INET), ('inet6', socket.AF_INET6), ('unix', socket.AF_UNIX)]",
    'bad = 0',
    'for name, family in families:',
    '    try:',
    '        socket.socket(family, socket.SOCK_STREAM, 0)',
    '    except OSError as e:',
    "        print('PASS socket denied', name, e.errno, e.strerror)",
    '        bad += 0 if e.errno == errno.EPERM else 1',
    '    else:',
    "        print('FAIL socket unexpectedly created', name)",
    '        bad += 1',
    'sys.exit(1 if bad else 0)',
    '',
  ].join('\n');
  const r = await run(baseCmd(['/usr/bin/python3', '-c', code]));
  expectAcceptedWithoutFail(r, 'socket families');
});

add('syscall', 'dangerous syscall corpus returns EPERM', async (ctx) => {
  const r = await runCached('syscall_probe', ctx.syscallProbe);
  expectAcceptedWithoutFail(r, 'syscall_probe');
});

add('api', 'inputFiles traversal is rejected before execution', async () => {
  const r = await run(baseCmd(['/bin/true'], {
    inputFiles: { 'nested/../../escape': { content: 'x' } },
  }));
  expectStatus(r, 'Internal Error', 'inputFiles traversal');
});

add('api', 'absolute inputFiles path is rejected before execution', async () => {
  const r = await run(baseCmd(['/bin/true'], {
    inputFiles: { '/tmp/escape': { content: 'x' } },
  }));
  expectStatus(r, 'Internal Error', 'absolute inputFiles');
});

add('api', 'absolute stdin file name is rejected before execution', async () => {
  const r = await run(baseCmd(['/bin/cat'], {
    stdio: [{ name: '/etc/passwd' }, { name: 'stdout', max: 1024 }, { name: 'stderr', max: 1024 }],
  }));
  expectStatus(r, 'Internal Error', 'absolute stdin');
});

add('api', 'output path traversal is rejected after execution', async () => {
  const r = await run(baseCmd(['/bin/true'], {
    outputFiles: ['../escape'],
  }));
  expectStatus(r, 'Internal Error', 'output traversal');
});

add('api', 'absolute output path is rejected after execution', async () => {
  const r = await run(baseCmd(['/bin/true'], {
    outputFiles: ['/etc/passwd'],
  }));
  expectStatus(r, 'Internal Error', 'absolute output');
});

add('api', 'cached output traversal is rejected after execution', async () => {
  const r = await run(baseCmd(['/bin/true'], {
    cachedOutputs: ['../escape'],
  }));
  expectStatus(r, 'Internal Error', 'cached output traversal');
});

add('api', 'cached file id traversal is rejected before execution', async () => {
  const r = await run(baseCmd(['/bin/true'], {
    inputFiles: { payload: { cachedFile: '../outside-cache' } },
  }));
  expectStatus(r, 'Internal Error', 'fileId traversal');
});

add('api', 'commands in one /api/run request do not share /box', async () => {
  const res = await postRun({
    commands: [
      baseCmd(['/bin/sh', '-c', 'printf secret > shared']),
      baseCmd(['/bin/sh', '-c', 'test ! -e shared && printf isolated']),
    ],
  });
  expect(res.ok, `multi command run failed: ${res.status} ${res.text}`);
  expect(Array.isArray(res.json) && res.json.length === 2, `multi command shape unexpected: ${res.text}`);
  expectStatus(res.json[0], 'Accepted', 'multi command writer');
  expectStatus(res.json[1], 'Accepted', 'multi command reader');
  expect(res.json[1].outputFiles?.stdout === 'isolated', `second command saw first command file: ${JSON.stringify(res.json[1])}`);
});

add('api', 'invalid pipes index is rejected with HTTP 400', async () => {
  const res = await postRun({
    commands: [baseCmd(['/bin/true'])],
    pipes: [{ from: { command: 0, fd: 1 }, to: { command: 9, fd: 0 } }],
  });
  expect(!res.ok && res.status === 400, `invalid pipes should return 400: ${res.status} ${res.text}`);
});

const context = {
  pathProbe: await compileC('path_probe.c', 'path_probe'),
  fdStress: await compileC('fd_stress.c', 'fd_stress'),
  procStress: await compileC('proc_stress.c', 'proc_stress'),
  syscallProbe: await compileC('syscall_probe.c', 'syscall_probe'),
  outputFlood: await compileC('output_flood.c', 'output_flood'),
  privilegeProbe: await compileC('privilege_probe.c', 'privilege_probe'),
  threadStress: await compileC('thread_stress.c', 'thread_stress', ['-pthread']),
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
console.log(`malicious corpus summary: ${passed}/${tests.length} passed`);
if (failures > 0) {
  process.exit(1);
}
