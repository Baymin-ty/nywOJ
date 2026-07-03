/* 试图读取宿主的 /etc/shadow：pivot_root 后这是沙箱内的只读最小根，
 * 要么文件不存在、要么是被 bind 的安全副本，拿不到宿主真实密码哈希。 */
#include <stdio.h>
int main(void) {
    FILE *f = fopen("/etc/shadow", "r");
    if (!f) {
        perror("fopen /etc/shadow");
        return 3;
    }
    char buf[256];
    if (fgets(buf, sizeof buf, f)) {
        printf("%s", buf);
    }
    fclose(f);
    return 0;
}
