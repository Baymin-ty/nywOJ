/* 调用 seccomp 黑名单里的 mount()：
 *   seccomp=errno → 返回 EPERM，程序感知报错（RE）；
 *   seccomp=kill  → 进程被内核直接杀死（SG）。 */
#include <sys/mount.h>
#include <stdio.h>
int main(void) {
    int r = mount("none", "/mnt", "tmpfs", 0, 0);
    perror("mount");
    return r ? 5 : 0;
}
