/*
 * Privilege boundary probe.
 *
 * A default sandboxed process runs as an unprivileged uid with no effective
 * capabilities and no_new_privs enabled. These operations should therefore be
 * refused by the kernel.
 */
#define _GNU_SOURCE
#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <grp.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>
#include <unistd.h>

static int failures = 0;

static void expect_eperm(const char *name, int rc) {
    int e = errno;
    if (rc == -1 && e == EPERM) {
        printf("PASS %s denied with EPERM\n", name);
        return;
    }
    printf("FAIL %s rc=%d errno=%d %s\n", name, rc, e, strerror(e));
    failures++;
}

int main(void) {
    gid_t groups[1] = {0};

    errno = 0;
    expect_eperm("setuid(0)", setuid(0));

    errno = 0;
    expect_eperm("setgid(0)", setgid(0));

    errno = 0;
    expect_eperm("setgroups([0])", setgroups(1, groups));

    errno = 0;
    expect_eperm("sethostname", sethostname("owned", 5));

    unlink("/box/nywoj_probe_node");
    errno = 0;
    expect_eperm("mknod", mknod("/box/nywoj_probe_node", S_IFCHR | 0600, makedev(1, 3)));
    unlink("/box/nywoj_probe_node");

    return failures ? 1 : 0;
}
