/*
 * Bounded RLIMIT_NOFILE probe. It opens /dev/null until the kernel refuses more
 * descriptors, then closes everything. A healthy default sandbox should hit
 * EMFILE well before 128 descriptors.
 */
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(void) {
    int fds[512];
    int count = 0;
    errno = 0;
    while (count < (int)(sizeof(fds) / sizeof(fds[0]))) {
        int fd = open("/dev/null", O_RDONLY);
        if (fd < 0) {
            break;
        }
        fds[count++] = fd;
    }

    int saved_errno = errno;
    for (int i = 0; i < count; i++) {
        close(fds[i]);
    }

    printf("opened=%d errno=%d %s\n", count, saved_errno, strerror(saved_errno));
    if (count >= 128) {
        printf("FAIL nofile limit looks too high or inactive\n");
        return 1;
    }
    if (saved_errno != EMFILE) {
        printf("FAIL expected EMFILE after descriptor exhaustion\n");
        return 1;
    }
    printf("PASS nofile limit enforced\n");
    return 0;
}
