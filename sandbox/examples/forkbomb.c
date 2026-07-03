/* 进程炸弹：被 cgroup pids.max 挡住（fork 超过上限会失败）。 */
#include <unistd.h>
int main(void) {
    for (;;) {
        fork();
    }
}
