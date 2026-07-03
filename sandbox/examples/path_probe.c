/*
 * Filesystem boundary probe.
 *
 * This is intentionally a bounded, defensive test: it verifies that sensitive
 * paths stay unreadable, system directories stay read-only, and /box + /tmp are
 * the only expected writable places.
 */
#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static int failures = 0;

static void expect_open_denied(const char *path) {
    errno = 0;
    int fd = open(path, O_RDONLY);
    if (fd >= 0) {
        char buf[64];
        ssize_t n = read(fd, buf, sizeof(buf));
        close(fd);
        printf("FAIL readable %s bytes=%zd\n", path, n);
        failures++;
        return;
    }
    printf("PASS denied read %s errno=%d %s\n", path, errno, strerror(errno));
}

static void expect_write_denied(const char *path) {
    errno = 0;
    int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd >= 0) {
        const char marker[] = "nywoj-probe\n";
        (void)write(fd, marker, sizeof(marker) - 1);
        close(fd);
        unlink(path);
        printf("FAIL writable %s\n", path);
        failures++;
        return;
    }
    printf("PASS denied write %s errno=%d %s\n", path, errno, strerror(errno));
}

static void expect_write_ok(const char *path) {
    errno = 0;
    int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) {
        printf("FAIL cannot write %s errno=%d %s\n", path, errno, strerror(errno));
        failures++;
        return;
    }
    const char marker[] = "nywoj-probe\n";
    if (write(fd, marker, sizeof(marker) - 1) != (ssize_t)sizeof(marker) - 1) {
        printf("FAIL short write %s errno=%d %s\n", path, errno, strerror(errno));
        failures++;
    } else {
        printf("PASS writable scratch %s\n", path);
    }
    close(fd);
    unlink(path);
}

int main(void) {
    expect_open_denied("/etc/shadow");
    expect_open_denied("/root/.ssh/id_rsa");
    expect_open_denied("/.oldroot/etc/shadow");
    expect_open_denied("/proc/1/root/etc/shadow");

    expect_write_denied("/usr/bin/nywoj_probe");
    expect_write_denied("/etc/nywoj_probe");
    expect_write_denied("/proc/sys/kernel/hostname");

    expect_write_ok("/box/nywoj_probe.tmp");
    expect_write_ok("/tmp/nywoj_probe.tmp");

    unlink("/box/link_to_shadow");
    if (symlink("/etc/shadow", "/box/link_to_shadow") == 0) {
        expect_open_denied("/box/link_to_shadow");
        unlink("/box/link_to_shadow");
    } else {
        printf("PASS symlink creation unavailable errno=%d %s\n", errno, strerror(errno));
    }

    return failures ? 1 : 0;
}
