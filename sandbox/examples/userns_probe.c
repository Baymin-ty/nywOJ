/*
 * Nested user-namespace probe.
 *
 * The seccomp blacklist blocks unshare()/setns(), but clone()/clone3() are
 * allowed (fork and threads need them). A submission that calls
 * clone(CLONE_NEWUSER) would create a nested user namespace in which it holds a
 * full capability set — widening the kernel attack surface even though seccomp
 * still blocks mount/pivot_root. A hardened judge sandbox refuses this.
 *
 * PASS = the kernel refused to create the nested user namespace.
 * FAIL = a nested user namespace was created from inside the sandbox.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <sched.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static char child_stack[1 << 16];

static int child_fn(void *arg) {
    (void)arg;
    _exit(0);
}

int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    errno = 0;
    pid_t p = clone(child_fn, child_stack + sizeof(child_stack),
                    CLONE_NEWUSER | SIGCHLD, NULL);
    if (p < 0) {
        printf("PASS clone(CLONE_NEWUSER) denied errno=%d %s\n", errno, strerror(errno));
        return 0;
    }
    int st = 0;
    waitpid(p, &st, 0);
    printf("FAIL clone(CLONE_NEWUSER) created a nested user namespace (child pid=%d)\n", p);
    return 1;
}
