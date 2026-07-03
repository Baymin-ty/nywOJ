/*
 * CPU-budget multiplication probe.
 *
 * Forks N workers that each burn a bounded amount of CPU, then the main process
 * waits for them and exits cleanly. Because the workers run in parallel the
 * WALL time stays small, but the whole cgroup burns N times the CPU budget.
 *
 * A correct judge sandbox must account CPU time for the whole cgroup (e.g. via
 * cgroup cpu.stat), so this run — which spends far more than cpuLimit of CPU —
 * is reported as Time Limit Exceeded. If CPU time is measured only from the
 * main process (which burns ~0), or bounded only by per-process RLIMIT_CPU,
 * this run is wrongly Accepted while consuming N× the intended CPU.
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>

int main(int argc, char **argv) {
    int n = argc > 1 ? atoi(argv[1]) : 5;
    long iters = argc > 2 ? atol(argv[2]) : 2000000000L;
    if (n < 1) n = 1;
    setvbuf(stdout, NULL, _IONBF, 0);
    printf("cpu_multiplier start workers=%d iters=%ld\n", n, iters);
    for (int i = 0; i < n; i++) {
        pid_t p = fork();
        if (p == 0) {
            volatile unsigned long x = 0;
            for (long k = 0; k < iters; k++) x += (unsigned long)k;
            _exit(0);
        }
    }
    int st;
    while (wait(&st) > 0) {
    }
    printf("cpu_multiplier done: workers finished within the wall limit\n");
    return 0;
}
