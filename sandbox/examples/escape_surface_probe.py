"""Non-destructive canaries for common container/sandbox escape surfaces.

The checks intentionally stop at "can this control surface be reached?" They do
not write kernel tunables, talk to container runtimes, join namespaces, or run
payloads. A production OJ can run this as a regression test for whether the
preconditions of real escape chains are absent.
"""

from pathlib import Path
import errno
import os
import stat
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


def expect_absent(path):
    p = Path(path)
    try:
        os.lstat(p)
    except FileNotFoundError:
        print(f"PASS absent {path}")
        return
    except OSError as exc:
        print(f"PASS cannot stat {path} errno={exc.errno} {exc.strerror}")
        return
    check(False, f"{path} should not be visible")


def expect_open_denied(path, flags=os.O_RDONLY):
    try:
        fd = os.open(path, flags | getattr(os, "O_NONBLOCK", 0))
    except OSError as exc:
        if exc.errno in {
            errno.EACCES,
            errno.EPERM,
            errno.ENOENT,
            errno.ENOTDIR,
            errno.EROFS,
            errno.ENXIO,
            errno.ENODEV,
            errno.EISDIR,
        }:
            print(f"PASS open denied {path} errno={exc.errno} {exc.strerror}")
            return
        check(False, f"unexpected open error for {path}", f"errno={exc.errno} {exc.strerror}")
        return
    else:
        os.close(fd)
        check(False, f"{path} unexpectedly opened")


def expect_write_open_denied(path):
    # Opening for write is enough to detect an exposed writable control surface.
    # Do not write bytes to kernel/cgroup/runtime files.
    expect_open_denied(path, os.O_WRONLY)


def expect_not_runtime_socket(path):
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        print(f"PASS runtime socket absent {path}")
        return
    except OSError as exc:
        print(f"PASS runtime socket inaccessible {path} errno={exc.errno} {exc.strerror}")
        return
    mode = st.st_mode
    check(not stat.S_ISSOCK(mode), f"runtime socket not exposed at {path}", oct(mode))


check(status_value("NoNewPrivs") == "1", "no_new_privs blocks setuid/cap escalation", status_value("NoNewPrivs"))
check(status_value("Seccomp") == "2", "seccomp filter is active", status_value("Seccomp"))
check(status_value("CapEff") == "0000000000000000", "effective capabilities are empty", status_value("CapEff"))

for path in [
    "/.oldroot",
    "/host",
    "/mnt/host",
    "/run/host",
    "/var/lib/docker",
    "/var/lib/containerd",
    "/root/.ssh",
]:
    expect_absent(path)

for path in [
    "/var/run/docker.sock",
    "/run/docker.sock",
    "/var/run/containerd/containerd.sock",
    "/run/containerd/containerd.sock",
    "/run/crio/crio.sock",
    "/var/run/crio/crio.sock",
    "/run/podman/podman.sock",
]:
    expect_not_runtime_socket(path)

for path in [
    "/dev/kmsg",
    "/dev/mem",
    "/dev/kmem",
    "/dev/port",
    "/dev/fuse",
    "/dev/net/tun",
    "/dev/sda",
    "/dev/vda",
    "/dev/nvme0n1",
    "/dev/mapper/control",
]:
    expect_open_denied(path)

for path in [
    "/proc/sys/kernel/core_pattern",
    "/proc/sys/kernel/modprobe",
    "/proc/sys/kernel/hostname",
    "/proc/sysrq-trigger",
    "/sys/fs/cgroup/cgroup.procs",
    "/sys/fs/cgroup/cgroup.subtree_control",
    "/sys/kernel/uevent_helper",
    "/sys/module",
    "/sys/fs/bpf/nywoj_probe",
    "/sys/kernel/security/nywoj_probe",
]:
    expect_write_open_denied(path)

for path in [
    "/proc/1/root/.oldroot",
    "/proc/1/root/var/run/docker.sock",
    "/proc/1/root/run/docker.sock",
    "/proc/1/root/root/.ssh",
]:
    expect_absent(path)

sys.exit(1 if failures else 0)
