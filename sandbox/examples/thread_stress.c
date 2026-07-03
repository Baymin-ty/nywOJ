/*
 * Bounded thread-count probe. cgroup pids.max counts tasks, so thread creation
 * should fail quickly when procLimit is small.
 */
#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static volatile int stop = 0;

static void *worker(void *arg) {
    (void)arg;
    struct timespec ts = {.tv_sec = 0, .tv_nsec = 10000000};
    while (!stop) {
        nanosleep(&ts, NULL);
    }
    return NULL;
}

int main(void) {
    pthread_t threads[256];
    int count = 0;
    int err = 0;

    while (count < (int)(sizeof(threads) / sizeof(threads[0]))) {
        err = pthread_create(&threads[count], NULL, worker, NULL);
        if (err != 0) {
            break;
        }
        count++;
    }

    stop = 1;
    for (int i = 0; i < count; i++) {
        pthread_join(threads[i], NULL);
    }

    printf("threads=%d err=%d %s\n", count, err, strerror(err));
    if (count >= 128) {
        printf("FAIL thread limit looks too high or inactive\n");
        return 1;
    }
    if (err != EAGAIN) {
        printf("FAIL expected EAGAIN after task exhaustion\n");
        return 1;
    }
    printf("PASS thread/task limit enforced\n");
    return 0;
}
