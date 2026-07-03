/*
 * Parallel CPU-burn farm.
 *
 * Forks N children that spin forever; the main process only pause()s and burns
 * no CPU of its own. This targets a common accounting blind spot: a supervisor
 * that samples only the main process's /proc/<pid>/stat sees ~0 CPU time even
 * though the whole group is pinning N cores. The sandbox must still stop the run
 * (wall-clock limit + cgroup group kill), never let it run unbounded.
 *
 * It cannot self-report PASS/FAIL (it is meant to be killed); the harness
 * asserts the verdict and inspects the reported cpu-time vs wall-time.
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(int argc, char **argv) {
    int n = argc > 1 ? atoi(argv[1]) : 8;
    if (n < 1) n = 1;
    setvbuf(stdout, NULL, _IONBF, 0);
    printf("cpu_farm start workers=%d\n", n);
    for (int i = 0; i < n; i++) {
        pid_t p = fork();
        if (p == 0) {
            volatile unsigned long x = 0;
            for (;;) x += 1; /* burn one core, forever */
        }
        /* fork() may fail once pids.max is reached — that is a valid outcome. */
    }
    for (;;) pause(); /* main consumes no CPU; only the workers do */
    return 0;
}
