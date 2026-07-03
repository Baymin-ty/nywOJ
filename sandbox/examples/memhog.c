/* 不断申请并写入内存：触发 cgroup memory.max → OOM kill → 判定 MLE。 */
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
int main(void) {
    long total = 0;
    for (;;) {
        const size_t chunk = 10 * 1024 * 1024; /* 10 MiB */
        char *p = malloc(chunk);
        if (!p) {
            printf("malloc 失败，已分配约 %ld MiB\n", total / (1024 * 1024));
            return 1;
        }
        memset(p, 1, chunk); /* 必须写入才会真正占用物理内存 */
        total += chunk;
    }
}
