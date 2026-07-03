/*
 * File-descriptor inheritance probe.
 *
 * At execve the sandboxed program must inherit ONLY stdin/stdout/stderr (plus
 * any explicitly requested pipeMapping fds). A stray inherited fd — the event
 * pipe, the sync pipe, a cgroup handle, the jobs directory, the config pipe —
 * would be an escape vector: the program could write to it or re-open its
 * target. Anything beyond 0/1/2 (and the transient fd we open to scan) is a
 * FAIL.
 */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    DIR *d = opendir("/proc/self/fd");
    if (!d) {
        printf("FAIL cannot open /proc/self/fd: %s\n", strerror(errno));
        return 1;
    }
    int scan_fd = dirfd(d);
    int failures = 0;
    struct dirent *e;
    while ((e = readdir(d))) {
        if (e->d_name[0] < '0' || e->d_name[0] > '9') continue;
        int fd = atoi(e->d_name);
        char path[64], link[PATH_MAX];
        snprintf(path, sizeof path, "/proc/self/fd/%d", fd);
        ssize_t n = readlink(path, link, sizeof link - 1);
        if (n < 0) n = 0;
        link[n] = '\0';
        int allowed = (fd == 0 || fd == 1 || fd == 2 || fd == scan_fd);
        printf("%s fd %d -> %s%s\n", allowed ? "PASS" : "FAIL", fd, link,
               fd == scan_fd ? " (scan dir)" : "");
        if (!allowed) failures++;
    }
    closedir(d);
    if (!failures) printf("PASS only stdio fds inherited\n");
    return failures ? 1 : 0;
}
