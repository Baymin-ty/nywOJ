/*
 * procfs / sysfs hardening probe.
 *
 * Unprivileged sandbox code must not be able to poke global kernel knobs, and
 * must not be able to LOWER its own oom_score_adj (which would make it immune
 * to the OOM killer and let it dodge the memory limit / hang the judge). Every
 * write below must be denied — either the open fails, or the write fails.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static int failures = 0;

static void expect_write_denied(const char *path, const char *data) {
    errno = 0;
    int fd = open(path, O_WRONLY);
    if (fd < 0) {
        printf("PASS %s open denied errno=%d %s\n", path, errno, strerror(errno));
        return;
    }
    errno = 0;
    ssize_t w = write(fd, data, strlen(data));
    if (w >= 0) {
        printf("FAIL %s accepted %zd-byte write\n", path, w);
        failures++;
    } else {
        printf("PASS %s write denied errno=%d %s\n", path, errno, strerror(errno));
    }
    close(fd);
}

int main(void) {
    expect_write_denied("/proc/sysrq-trigger", "c");
    expect_write_denied("/proc/sys/kernel/core_pattern", "|/bin/false");
    expect_write_denied("/proc/sys/vm/drop_caches", "3");
    expect_write_denied("/proc/sys/kernel/printk", "0 0 0 0");
    /* Lowering oom_score_adj below the current value needs CAP_SYS_RESOURCE. */
    expect_write_denied("/proc/self/oom_score_adj", "-1000");
    return failures ? 1 : 0;
}
