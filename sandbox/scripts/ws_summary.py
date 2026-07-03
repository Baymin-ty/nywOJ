#!/usr/bin/env python3
"""连 /ws/<job_id>，汇总打印关键事件（RESULT / JUDGE / FS快照 / syscall计数 / stdout）。"""
import socket, base64, os, json, struct, sys, time
host, port, job = "127.0.0.1", 1145, sys.argv[1]
key = base64.b64encode(os.urandom(16)).decode()
s = socket.create_connection((host, port), timeout=25)
s.sendall((f"GET /ws/{job} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
buf = b""
while b"\r\n\r\n" not in buf: buf += s.recv(4096)
inbuf = bytearray(buf.split(b"\r\n\r\n", 1)[1])
def get(n):
    while len(inbuf) < n:
        c = s.recv(4096)
        if not c: break
        inbuf.extend(c)
    o = bytes(inbuf[:n]); del inbuf[:n]; return o
sysc = 0; stdout = ""; t = time.time() + 25
while time.time() < t:
    h = get(2)
    if len(h) < 2: break
    op, ln = h[0] & 0xf, h[1] & 0x7f
    if ln == 126: ln = struct.unpack(">H", get(2))[0]
    elif ln == 127: ln = struct.unpack(">Q", get(8))[0]
    p = get(ln)
    if op == 0x8: break
    if op != 0x1: continue
    ev = json.loads(p.decode()); k = ev.get("kind")
    if k == "syscall": sysc += 1
    elif k == "stdout": stdout += ev["data"]
    elif k == "fs_snapshot":
        print(f"  FS: host={ev['hostname']} euid={ev['euid']} root={ev['root_entries']} net={ev['net_ifaces']} mounts={len(ev['mounts'])} gone={ev['gone']}")
    elif k == "judge":
        print(f"  JUDGE = {ev['verdict']}  ({ev['message'].splitlines()[0]})")
    elif k == "result":
        print(f"  RESULT = {ev['status']}  msg={ev['message']}")
        # 等一下可能还有 judge 事件
        t = time.time() + 1
if sysc: print(f"  syscalls = {sysc}")
if stdout.strip(): print(f"  stdout = {stdout.strip()[:120]!r}")
