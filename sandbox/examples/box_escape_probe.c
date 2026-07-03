/*
 * pivot_root containment probe.
 *
 * The sandbox switches roots with pivot_root (not chroot) and unmounts the old
 * root, so classic ".." escapes, /proc/<pid>/root and symlink re-opens must not
 * reach host-only files. "/box" is a bind mount whose parent is the minimal new
 * root; host dirs like /root /home /var simply do not exist there. Every
 * attempt below must be contained (ENOENT) or denied (EACCES) — none may yield
 * a readable host-only file.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static int failures = 0;

static void expect_contained(const char *path) {
    errno = 0;
    int fd = open(path, O_RDONLY);
    if (fd >= 0) {
        printf("FAIL %s opened (fd=%d)\n", path, fd);
        close(fd);
        failures++;
        return;
    }
    printf("PASS %s contained errno=%d %s\n", path, errno, strerror(errno));
}

int main(void) {
    /* ".." from /box (a bind mount) must not climb out of the new root. */
    expect_contained("/box/../root/.bashrc");
    expect_contained("/box/../../root/.bashrc");
    expect_contained("/box/../../../root/.bashrc");
    expect_contained("/box/../../../etc/shadow"); /* shadow stays unreadable */
    /* host-only trees are absent under the minimal root. */
    expect_contained("/root/.ssh/id_rsa");
    expect_contained("/home");
    expect_contained("/var/log/syslog");
    /* /proc/<pid>/root and /proc/self/root point at the sandbox root. */
    expect_contained("/proc/1/root/root/.bashrc");
    expect_contained("/proc/self/root/../root/.bashrc");
    return failures ? 1 : 0;
}
