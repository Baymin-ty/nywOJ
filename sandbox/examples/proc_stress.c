/*
 * Bounded pids.max probe. It forks short-lived sleepers until the sandbox
 * refuses new processes, then kills and reaps the children it created.
 */
#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

int main(void) {
    pid_t kids[256];
    int count = 0;
    errno = 0;
    while (count < (int)(sizeof(kids) / sizeof(kids[0]))) {
        pid_t pid = fork();
        if (pid < 0) {
            break;
        }
        if (pid == 0) {
            sleep(30);
            _exit(0);
        }
        kids[count++] = pid;
    }

    int saved_errno = errno;
    for (int i = 0; i < count; i++) {
        kill(kids[i], SIGKILL);
    }
    for (int i = 0; i < count; i++) {
        waitpid(kids[i], NULL, 0);
    }

    printf("spawned=%d errno=%d %s\n", count, saved_errno, strerror(saved_errno));
    if (count >= 128) {
        printf("FAIL process limit looks too high or inactive\n");
        return 1;
    }
    if (saved_errno != EAGAIN) {
        printf("FAIL expected EAGAIN after pids.max exhaustion\n");
        return 1;
    }
    printf("PASS pids limit enforced\n");
    return 0;
}
