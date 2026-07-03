#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = process.env.SANDBOX_URL
  ? [process.env.SANDBOX_URL]
  : ['http://127.0.0.1:5050', 'http://127.0.0.1:1145'];

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

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
console.log(`adversarial smoke target: ${base}`);

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

const compileC = async (sourceName, outputName) => {
  const source = readExample(sourceName);
  const result = await run(baseCmd(['/usr/bin/gcc', '-O2', '-std=c11', '-Wall', sourceName, '-o', outputName], {
    cpuMs: 10000,
    wallMs: 20000,
    memoryMB: 512,
    stackMB: 512,
    processes: 50,
    inputFiles: { [sourceName]: { content: source } },
    cachedOutputs: [outputName],
    cachePrefix: 'nywOJ_adversarial_smoke',
  }));
  assert(result.status === 'Accepted' && result.cachedFiles && result.cachedFiles[outputName], `${sourceName} compile failed: ${JSON.stringify(result)}`);
  return result.cachedFiles[outputName];
};

const runCached = (binaryName, fileId, extra = {}) =>
  run(baseCmd([binaryName], {
    inputFiles: { [binaryName]: { cachedFile: fileId } },
    ...extra,
  }));

const compiled = [];
try {
  const pathProbe = await compileC('path_probe.c', 'path_probe');
  compiled.push(pathProbe);
  const pathResult = await runCached('path_probe', pathProbe);
  assert(pathResult.status === 'Accepted', `path_probe should pass: ${JSON.stringify(pathResult)}`);
  assert(!/FAIL/.test(pathResult.outputFiles.stdout || ''), `path_probe reported a failure: ${JSON.stringify(pathResult.outputFiles)}`);

  const procResult = await run(baseCmd(['/usr/bin/python3', 'proc_probe.py'], {
    inputFiles: { 'proc_probe.py': { content: readExample('proc_probe.py') } },
  }));
  assert(procResult.status === 'Accepted', `proc_probe should pass: ${JSON.stringify(procResult)}`);
  assert(!/FAIL/.test(procResult.outputFiles.stdout || ''), `proc_probe reported a failure: ${JSON.stringify(procResult.outputFiles)}`);

  const fdProbe = await compileC('fd_stress.c', 'fd_stress');
  compiled.push(fdProbe);
  const fdResult = await runCached('fd_stress', fdProbe);
  assert(fdResult.status === 'Accepted', `fd_stress should pass: ${JSON.stringify(fdResult)}`);
  assert(/PASS nofile/.test(fdResult.outputFiles.stdout || ''), `fd_stress stdout unexpected: ${JSON.stringify(fdResult.outputFiles)}`);

  const procStress = await compileC('proc_stress.c', 'proc_stress');
  compiled.push(procStress);
  const procStressResult = await runCached('proc_stress', procStress, {
    processes: 16,
    wallMs: 4000,
  });
  assert(procStressResult.status === 'Accepted', `proc_stress should pass: ${JSON.stringify(procStressResult)}`);
  assert(/PASS pids/.test(procStressResult.outputFiles.stdout || ''), `proc_stress stdout unexpected: ${JSON.stringify(procStressResult.outputFiles)}`);

  const syscallProbe = await compileC('syscall_probe.c', 'syscall_probe');
  compiled.push(syscallProbe);
  const syscallResult = await runCached('syscall_probe', syscallProbe);
  assert(syscallResult.status === 'Accepted', `syscall_probe should pass: ${JSON.stringify(syscallResult)}`);
  assert(!/FAIL/.test(syscallResult.outputFiles.stdout || ''), `syscall_probe reported a failure: ${JSON.stringify(syscallResult.outputFiles)}`);

  const outputFlood = await compileC('output_flood.c', 'output_flood');
  compiled.push(outputFlood);
  const outputResult = await runCached('output_flood', outputFlood, {
    stdio: stdFiles('', 4096, 4096),
  });
  assert(outputResult.status === 'Output Limit Exceeded', `output_flood should hit OLE: ${JSON.stringify(outputResult)}`);
  assert((outputResult.outputFiles.stdout || '').length === 4096, `output_flood stdout should be truncated to 4096 bytes`);

  const unsafeCopyIn = await run(baseCmd(['/bin/true'], {
    inputFiles: { 'nested/../../escape': { content: 'x' } },
  }));
  assert(unsafeCopyIn.status === 'Internal Error', `inputFiles traversal should be rejected: ${JSON.stringify(unsafeCopyIn)}`);

  const unsafeCopyOut = await run(baseCmd(['/bin/true'], {
    outputFiles: ['/etc/passwd'],
  }));
  assert(unsafeCopyOut.status === 'Internal Error', `absolute outputFiles should be rejected: ${JSON.stringify(unsafeCopyOut)}`);

  const unsafeFileId = await run(baseCmd(['/bin/true'], {
    inputFiles: { payload: { cachedFile: '../outside-cache' } },
  }));
  assert(unsafeFileId.status === 'Internal Error', `cached file traversal should be rejected: ${JSON.stringify(unsafeFileId)}`);
} finally {
  await Promise.all(compiled.map(deleteCached));
}

console.log('adversarial smoke passed');
