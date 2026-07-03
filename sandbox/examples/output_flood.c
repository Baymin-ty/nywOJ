/*
 * Bounded output-limit probe. It writes 1 MiB to stdout; run it with a small
 * stdout capture limit and the compat layer should report Output Limit
 * Exceeded while truncating captured stdout.
 */
#include <stdio.h>
#include <string.h>

int main(void) {
    char chunk[4096];
    memset(chunk, 'A', sizeof(chunk));
    for (int i = 0; i < 256; i++) {
        if (fwrite(chunk, 1, sizeof(chunk), stdout) != sizeof(chunk)) {
            return 1;
        }
    }
    return 0;
}
