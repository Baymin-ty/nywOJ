#!/usr/bin/env node

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('../../server/node_modules/ws');

const base = (process.env.SANDBOX_WS_URL || 'ws://127.0.0.1:5050/api/stream').replace(/\/+$/, '');
const code = [
  'import sys',
  "print('ready', flush=True)",
  'line=sys.stdin.readline()',
  "print('echo:'+line.strip(), flush=True)",
  '',
].join('\n');

const req = {
  commands: [{
    command: ['/usr/bin/python3', '-u', '-c', code],
    env: ['PATH=/usr/bin:/bin', 'HOME=/tmp', 'TERM=xterm-256color'],
    stdio: [null, { name: 'stdout', max: 1024 * 1024 }, { name: 'stderr', max: 1024 * 1024 }],
    limits: {
      cpuMs: 2000,
      wallMs: 5000,
      memoryMB: 128,
      stackMB: 128,
      processes: 20,
    },
  }],
};

const ws = new WebSocket(base);
let output = '';
let sent = false;
let finished = false;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const timer = setTimeout(() => fail(`stream timeout output=${JSON.stringify(output)}`), 8000);

ws.on('open', () => {
  ws.send(Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify(req))]));
});

ws.on('message', (buf) => {
  if (buf[0] === 2) {
    output += buf.subarray(2).toString('utf8');
    if (!sent && output.includes('ready')) {
      sent = true;
      ws.send(Buffer.concat([Buffer.from([3, 0]), Buffer.from('abc\n')]));
    }
    return;
  }
  if (buf[0] !== 1) return;
  finished = true;
  clearTimeout(timer);
  const resp = JSON.parse(buf.subarray(1).toString('utf8'));
  const result = resp.result;
  if (!result) fail('missing stream result');
  if (result.status !== 'Accepted') fail(`stream status=${result.status}`);
  if (!output.includes('ready') || !output.includes('echo:abc')) {
    fail(`unexpected stream output=${JSON.stringify(output)}`);
  }
  console.log('stream smoke passed');
  ws.close();
});

ws.on('error', (e) => {
  clearTimeout(timer);
  fail(e.message);
});

ws.on('close', () => {
  if (!finished) {
    clearTimeout(timer);
    fail('stream closed before final result');
  }
});
