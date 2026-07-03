"""Bounded tmpfs fill probe.

The sandbox should give /tmp a small private tmpfs. This writes up to 64 MiB in
1 MiB chunks and succeeds only if the kernel refuses the fill before the cap.
"""

from pathlib import Path
import errno
import os
import sys

path = Path("/tmp/nywoj_tmp_fill.bin")
try:
    with path.open("wb") as f:
        for i in range(64):
            f.write(b"x" * 1024 * 1024)
            f.flush()
            os.fsync(f.fileno())
except OSError as exc:
    try:
        path.unlink()
    except OSError:
        pass
    if exc.errno in {errno.ENOSPC, errno.EDQUOT, errno.EFBIG}:
        print(f"PASS tmp fill denied after bounded writes errno={exc.errno} {exc.strerror}")
        sys.exit(0)
    print(f"FAIL unexpected tmp fill error errno={exc.errno} {exc.strerror}")
    sys.exit(1)

try:
    path.unlink()
except OSError:
    pass
print("FAIL wrote 64 MiB to /tmp without hitting a limit")
sys.exit(1)
