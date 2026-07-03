"""Process and namespace visibility probe for the teaching sandbox.

The checks are read-only and bounded. They assert that the process sees a
sandbox hostname, a small PID namespace, loopback-only networking, seccomp, and
no effective Linux capabilities in the default non-userns mode.
"""

from pathlib import Path
import os
import socket
import sys


failures = 0


def check(ok, message, detail=""):
    global failures
    if ok:
        print(f"PASS {message}{(': ' + detail) if detail else ''}")
    else:
        print(f"FAIL {message}{(': ' + detail) if detail else ''}")
        failures += 1


def status_value(name):
    try:
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith(name + ":"):
                return line.split(":", 1)[1].strip()
    except OSError as exc:
        return f"unreadable:{exc}"
    return ""


hostname = socket.gethostname()
check(hostname == "sandbox", "sandbox hostname", hostname)

pids = sorted(int(p.name) for p in Path("/proc").iterdir() if p.name.isdigit())
check(bool(pids), "proc has numeric pids", repr(pids))
check(max(pids or [0]) <= 64, "pid namespace is small", repr(pids[:20]))

ifaces = []
for line in Path("/proc/net/dev").read_text().splitlines()[2:]:
    name = line.split(":", 1)[0].strip()
    if name:
        ifaces.append(name)
passive_ifaces = {"lo", "tunl0", "ip6tnl0", "sit0"}
external_ifaces = [name for name in ifaces if name not in passive_ifaces]
check(not external_ifaces, "network namespace has no external interfaces", repr(ifaces))

check(status_value("NoNewPrivs") == "1", "no_new_privs is set", status_value("NoNewPrivs"))
check(status_value("Seccomp") == "2", "seccomp filter mode is active", status_value("Seccomp"))
check(status_value("CapEff") == "0000000000000000", "effective capabilities dropped", status_value("CapEff"))

for path in ["/.oldroot", "/root", "/home", "/var"]:
    check(not Path(path).exists(), f"{path} is hidden")

print(f"uid={os.getuid()} gid={os.getgid()} cwd={Path.cwd()}")
sys.exit(1 if failures else 0)
