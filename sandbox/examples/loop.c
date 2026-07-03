/* 死循环：墙钟/CPU 超时 → 判定 TO（被 supervisor SIGKILL）。 */
int main(void) {
    for (;;) {
    }
}
