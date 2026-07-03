/*
 * Distributed memory bomb across processes.
 *
 * Each child allocates and touches a chunk that is individually well under the
 * limit, but collectively far over the cgroup memory.max. This checks that
 * memory is accounted for the whole cgroup (every descendant), not per-process:
 * a per-process RLIMIT_AS check would miss it, cgroup v2 memory.max must not.
 * The group is expected to be OOM-killed (MLE).
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Volatile sink so the compiler cannot delete the allocation + touch as dead
 * code (a plain malloc+memset whose result is never read is optimised away
 * under -O2, and then nothing is charged to the cgroup). */
static volatile unsigned long sink;

int main(int argc, char **argv) {
    int n = argc > 1 ? atoi(argv[1]) : 6;
    long mb = argc > 2 ? atol(argv[2]) : 24;
    if (n < 1) n = 1;
    setvbuf(stdout, NULL, _IONBF, 0);
    printf("mem_multiproc start n=%d chunk=%ldMB total=%ldMB\n", n, mb, n * mb);
    for (int i = 0; i < n; i++) {
        pid_t p = fork();
        if (p == 0) {
            size_t sz = (size_t)mb * 1024 * 1024;
            volatile char *buf = malloc(sz);
            if (!buf) _exit(42);
            for (size_t k = 0; k < sz; k += 4096) buf[k] = (char)(i + 1);
            unsigned long acc = 0;
            for (size_t k = 0; k < sz; k += 4096) acc += buf[k];
            sink += acc;          /* observable read keeps the pages resident */
            for (;;) pause();      /* hold the memory */
        }
    }
    for (;;) pause();
    return 0;
}
