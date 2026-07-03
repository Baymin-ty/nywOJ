# 试图联网：net namespace 里只有 loopback，连外网必然失败。
import socket
s = socket.socket()
s.settimeout(2)
try:
    s.connect(("1.1.1.1", 80))
    print("竟然连上了？！（说明没隔离网络）")
except OSError as e:
    print("联网失败（符合预期，网络已隔离）:", e)
