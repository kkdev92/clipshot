"""Builds tar.gz fixtures for the code paths the real sharp tarballs never hit.

Each is a genuine archive produced by Python's tarfile, so the parser is being
checked against another implementation's output rather than against my own
idea of the format.
"""

import io
import os
import sys
import tarfile

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)


def write(name, build, fmt=tarfile.PAX_FORMAT):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=fmt) as tar:
        build(tar)
    path = os.path.join(OUT, name)
    with open(path, "wb") as fh:
        fh.write(buf.getvalue())
    print(f"  wrote {name} ({len(buf.getvalue())} bytes)")


def add(tar, path, data=b"x", mode=0o644, typ=tarfile.REGTYPE, link=""):
    info = tarfile.TarInfo(path)
    info.size = len(data) if typ == tarfile.REGTYPE else 0
    info.mode = mode
    info.type = typ
    info.linkname = link
    tar.addfile(info, io.BytesIO(data) if typ == tarfile.REGTYPE else None)


# 1. Long path -> forces a pax extended header ('x') with a path= record.
deep = "package/lib/" + "/".join(f"segment{i:02d}" for i in range(14)) + "/deep.txt"
write("pax-longpath.tgz", lambda t: add(t, deep, b"deep-content"))

# 2. Directory entries plus nested files, GNU format (no pax records at all).
def dirs(t):
    add(t, "package/", typ=tarfile.DIRTYPE, mode=0o755)
    add(t, "package/lib/", typ=tarfile.DIRTYPE, mode=0o755)
    add(t, "package/lib/a.node", b"native", mode=0o755)
    add(t, "package/package.json", b'{"name":"x"}')
write("gnu-dirs.tgz", dirs, fmt=tarfile.GNU_FORMAT)

# 3. Path traversal: an entry that escapes once `package/` is stripped.
write("traversal.tgz", lambda t: add(t, "package/../../escaped.txt", b"pwned"))

# 4. A symlink, which the parser must refuse rather than skip.
write("symlink.tgz", lambda t: add(t, "package/link", typ=tarfile.SYMTYPE, link="/etc/passwd"))

# 5. Executable bit, to confirm the mode survives.
write("modes.tgz", lambda t: (add(t, "package/exec.sh", b"#!/bin/sh\n", mode=0o755),
                              add(t, "package/plain.txt", b"hi", mode=0o600)))
