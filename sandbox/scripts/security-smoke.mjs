#!/usr/bin/env node

const base = (process.env.SANDBOX_URL || 'http://127.0.0.1:5050').replace(/\/+$/, '');

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

const stdFiles = (input = '', stdoutMax = 64 * 1024, stderrMax = 64 * 1024) => [
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
      cpuMs: cpuMs ?? 1000,
      wallMs: wallMs ?? 3000,
      memoryMB: memoryMB ?? 128,
      stackMB: stackMB ?? 128,
      processes: processes ?? 20,
    },
    outputFiles: ['stdout', 'stderr'],
    ...rest,
  };
};

const shadow = await run(baseCmd(['/usr/bin/python3', '-c', "open('/etc/shadow').read()"]));
assert(shadow.status !== 'Accepted', `reading /etc/shadow unexpectedly succeeded: ${JSON.stringify(shadow)}`);
assert(/Permission|denied|No such file/i.test((shadow.outputFiles && shadow.outputFiles.stderr) || ''), `unexpected /etc/shadow stderr: ${JSON.stringify(shadow.outputFiles)}`);

const writeRoot = await run(baseCmd(['/usr/bin/python3', '-c', "open('/usr/bin/nywoj_probe','w').write('x')"]));
assert(writeRoot.status !== 'Accepted', `writing read-only root unexpectedly succeeded: ${JSON.stringify(writeRoot)}`);
assert(/Permission|denied|Read-only/i.test((writeRoot.outputFiles && writeRoot.outputFiles.stderr) || ''), `unexpected root write stderr: ${JSON.stringify(writeRoot.outputFiles)}`);

const socket = await run(baseCmd(['/usr/bin/python3', '-c', 'import socket; socket.socket()']));
assert(socket.status === 'Nonzero Exit Status', `socket status=${socket.status}`);
assert(/Operation not permitted|PermissionError/i.test((socket.outputFiles && socket.outputFiles.stderr) || ''), `unexpected socket stderr: ${JSON.stringify(socket.outputFiles)}`);

const forkBomb = await run(baseCmd(['/usr/bin/python3', '-c', 'import os\nwhile True: os.fork()'], {
  cpuMs: 500,
  wallMs: 2000,
  memoryMB: 64,
  processes: 12,
}));
assert(forkBomb.status !== 'Accepted', `fork bomb unexpectedly accepted: ${JSON.stringify(forkBomb)}`);
assert((forkBomb.wallTimeMs || 0) < 5000, `fork bomb was not contained quickly: ${JSON.stringify(forkBomb)}`);

const tle = await run(baseCmd(['/bin/sh', '-c', 'while true; do :; done'], {
  cpuMs: 100,
  wallMs: 500,
  memoryMB: 64,
}));
assert(tle.status === 'Time Limit Exceeded', `TLE status=${tle.status}`);

const mle = await run(baseCmd(['/usr/bin/python3', '-c', 'a=[]\nwhile True: a.append(bytearray(1024*1024))'], {
  cpuMs: 2000,
  wallMs: 4000,
  memoryMB: 32,
}));
assert(mle.status === 'Memory Limit Exceeded', `MLE status=${mle.status}`);

const ole = await run(baseCmd(['/bin/sh', '-c', 'printf 1234567890'], {
  stdio: stdFiles('', 4, 1024),
}));
assert(ole.status === 'Output Limit Exceeded', `OLE status=${ole.status}`);
assert(ole.outputFiles.stdout === '1234', `OLE stdout=${JSON.stringify(ole.outputFiles.stdout)}`);

const unsafeCopyIn = await run(baseCmd(['/bin/true'], {
  inputFiles: { '../escape': { content: 'x' } },
}));
assert(unsafeCopyIn.status === 'Internal Error', `unsafe input file path should be rejected: ${JSON.stringify(unsafeCopyIn)}`);

const unsafeStdinName = await run(baseCmd(['/bin/cat'], {
  stdio: [{ name: '/etc/shadow' }, { name: 'stdout', max: 1024 }, { name: 'stderr', max: 1024 }],
}));
assert(unsafeStdinName.status === 'Internal Error', `absolute stdin name should be rejected: ${JSON.stringify(unsafeStdinName)}`);

const probeSource = String.raw`
#include <errno.h>
#include <fcntl.h>
#include <linux/bpf.h>
#include <linux/openat2.h>
#include <sched.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/ptrace.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <unistd.h>

static int expect_eperm(long rc) {
  int e = errno;
  printf("rc=%ld errno=%d %s\n", rc, e, strerror(e));
  return e == EPERM ? 0 : 2;
}

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  errno = 0;
  if (!strcmp(argv[1], "socket")) {
    return expect_eperm(syscall(SYS_socket, AF_INET, SOCK_STREAM, 0));
  }
  if (!strcmp(argv[1], "ptrace")) {
    return expect_eperm(syscall(SYS_ptrace, PTRACE_TRACEME, 0, 0, 0));
  }
  if (!strcmp(argv[1], "unshare")) {
    return expect_eperm(syscall(SYS_unshare, CLONE_NEWUSER));
  }
  if (!strcmp(argv[1], "mount")) {
    return expect_eperm(syscall(SYS_mount, "tmpfs", "/tmp/nywoj_mount_probe", "tmpfs", 0, ""));
  }
#ifdef SYS_bpf
  if (!strcmp(argv[1], "bpf")) {
    return expect_eperm(syscall(SYS_bpf, BPF_MAP_CREATE, 0, 0));
  }
#endif
#ifdef SYS_io_uring_setup
  if (!strcmp(argv[1], "io_uring_setup")) {
    return expect_eperm(syscall(SYS_io_uring_setup, 1, 0));
  }
#endif
#ifdef SYS_pidfd_getfd
  if (!strcmp(argv[1], "pidfd_getfd")) {
    return expect_eperm(syscall(SYS_pidfd_getfd, -1, 0, 0));
  }
#endif
#ifdef SYS_open_by_handle_at
  if (!strcmp(argv[1], "open_by_handle_at")) {
    return expect_eperm(syscall(SYS_open_by_handle_at, -1, 0, 0));
  }
#endif
#ifdef SYS_process_vm_readv
  if (!strcmp(argv[1], "process_vm_readv")) {
    char c = 0;
    struct iovec iov = { &c, 1 };
    return expect_eperm(syscall(SYS_process_vm_readv, getpid(), &iov, 1, &iov, 1, 0));
  }
#endif
  printf("skip %s\n", argv[1]);
  return 0;
}
`;

const probeCompile = await run(baseCmd(['/usr/bin/g++-9', '-O2', '-std=c++14', 'probe.cpp', '-o', 'probe'], {
  cpuMs: 10000,
  wallMs: 20000,
  memoryMB: 512,
  stackMB: 512,
  processes: 50,
  inputFiles: { 'probe.cpp': { content: probeSource } },
  cachedOutputs: ['probe'],
  cachePrefix: 'nywOJ_security_smoke',
}));
assert(probeCompile.status === 'Accepted' && probeCompile.cachedFiles && probeCompile.cachedFiles.probe, `probe compile failed: ${JSON.stringify(probeCompile)}`);

const probeFileId = probeCompile.cachedFiles.probe;
try {
  for (const op of ['socket', 'ptrace', 'unshare', 'mount', 'bpf', 'io_uring_setup', 'pidfd_getfd', 'open_by_handle_at', 'process_vm_readv']) {
    const result = await run(baseCmd(['probe', op], {
      inputFiles: { probe: { cachedFile: probeFileId } },
    }));
    assert(result.status === 'Accepted', `${op} was not blocked with EPERM: ${JSON.stringify(result)}`);
    assert(/errno=1\b/.test((result.outputFiles && result.outputFiles.stdout) || '') || /skip/.test((result.outputFiles && result.outputFiles.stdout) || ''), `${op} stdout did not show EPERM: ${JSON.stringify(result.outputFiles)}`);
  }
} finally {
  await deleteCached(probeFileId);
}

console.log('security smoke passed');
