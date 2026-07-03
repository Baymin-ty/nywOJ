#!/usr/bin/env python3
"""极简 WebSocket 客户端（仅 stdlib），用于端到端验证 /ws/<job_id> 事件流。"""
import socket, base64, os, json, struct, sys, time

host, port, job = "127.0.0.1", 1145, sys.argv[1]
key = base64.b64encode(os.urandom(16)).decode()
req = (
    f"GET /ws/{job} HTTP/1.1\r\nHost: {host}:{port}\r\n"
    f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
    f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
)
s = socket.create_connection((host, port), timeout=20)
s.sendall(req.encode())
buf = b""
while b"\r\n\r\n" not in buf:
    buf += s.recv(4096)
inbuf = bytearray(buf.split(b"\r\n\r\n", 1)[1])

def get(n):
    while len(inbuf) < n:
        c = s.recv(4096)
        if not c:
            break
        inbuf.extend(c)
    out = bytes(inbuf[:n]); del inbuf[:n]; return out

deadline = time.time() + 20
count = 0
while time.time() < deadline:
    h = get(2)
    if len(h) < 2:
        break
    op, ln = h[0] & 0x0F, h[1] & 0x7F
    if ln == 126:
        ln = struct.unpack(">H", get(2))[0]
    elif ln == 127:
        ln = struct.unpack(">Q", get(8))[0]
    payload = get(ln)
    if op == 0x8:
        print("<<CLOSE>>"); break
    if op == 0x1:
        count += 1
        try:
            ev = json.loads(payload.decode())
            k = ev.get("kind")
            if k == "step":
                print(f"  step[{ev['phase']}] {ev['title']}")
            elif k == "result":
                print(f"  RESULT = {ev['status']}  wall={ev['wall_time_ms']}ms  rss={ev['max_rss_kib']}KiB  msg={ev['message']}")
                break
            elif k in ("stdout", "stderr"):
                print(f"  {k}: {ev['data'].rstrip()}")
            elif k == "resource_sample":
                pass
            else:
                print(f"  {k}: {str(ev)[:80]}")
        except Exception as e:
            print("  raw", payload[:80], e)
print(f"[received {count} events]")
