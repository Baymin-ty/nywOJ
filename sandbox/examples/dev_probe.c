/*
 * Dangerous device / kernel-memory node probe.
 *
 * The sandbox exposes only a minimal /dev (null, zero, full, random, urandom,
 * tty). Raw hardware / kernel-memory devices must be unreachable — either
 * absent (ENOENT) or refused (EACCES/EPERM). Opening any of them for real
 * access is a FAIL: it would mean a submission can touch host disks, physical
 * memory, the kernel ring buffer, or /proc/kcore.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static int failures = 0;

static void expect_denied(const char *path) {
    errno = 0;
    int fd = open(path, O_RDONLY);
    if (fd >= 0) {
        printf("FAIL %s opened (fd=%d)\n", path, fd);
        close(fd);
        failures++;
        return;
    }
    printf("PASS %s denied errno=%d %s\n", path, errno, strerror(errno));
}

int main(void) {
    static const char *nodes[] = {
        "/dev/mem",       "/dev/kmem",   "/dev/port",
        "/dev/kmsg",      "/dev/sda",    "/dev/sda1",
        "/dev/vda",       "/dev/nvme0n1","/dev/kvm",
        "/dev/fuse",      "/dev/loop-control", "/dev/loop0",
        "/dev/mapper/control", "/dev/console", "/proc/kcore",
        NULL,
    };
    for (int i = 0; nodes[i]; i++) expect_denied(nodes[i]);
    return failures ? 1 : 0;
}
