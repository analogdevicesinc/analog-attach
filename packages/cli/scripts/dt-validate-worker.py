#!/usr/bin/env python3
"""dt-validate kept running, for the GUI: `validate` asks it instead of starting dt-validate
(commands/validate/worker.ts), so Python, dtschema and the schema are loaded once, not per run.

    python -E dt-validate-worker.py <socket> <owner pid> <idle seconds> <check seconds>

It answers on a Unix socket, one request a connection: a JSON line
{"cwd", "schema", "dtb", "json_output"}, as `dt-validate -s <schema> <dtb> --json-output
<json_output>` run in <cwd> takes them. It writes the file as dt-validate does (its diagnostics,
dt-validate's own `check_dtb`) and answers {"ok": true}, or {"ok": false, "error"}. It exits when
the owner (the GUI's process) is gone, after <idle seconds> without a request, or when a check
takes more than <check seconds> (a stuck check would hold up every request after it: the next run
starts another worker), and leaves when another worker answers on the socket already. Only its
user reaches the socket: it sits in a directory of theirs (worker.ts) and is made 0600.
"""

import contextlib
import json
import os
import socket
import socketserver
import sys
import threading
import time

from dtschema import dtb_validate

SOCKET, OWNER, IDLE, CHECK = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
# The schemas loaded, the last used last: (path, size, mtime) -> dt-validate's schema_group.
GROUPS = {}
KEPT = 4
last_request = time.monotonic()
# The inode of the socket file this worker bound, so it never removes another worker's.
bound = None


def schema_group(schema):
    stat = os.stat(schema)
    key = (schema, stat.st_size, stat.st_mtime_ns)
    group = GROUPS.pop(key, None) or dtb_validate.schema_group(schema, True)
    GROUPS[key] = group
    while len(GROUPS) > KEPT:
        GROUPS.pop(next(iter(GROUPS)))
    return group


def check(request):
    # dt-validate names the file relative to where it runs.
    os.chdir(request["cwd"])
    with open(os.devnull, "w") as null, contextlib.redirect_stdout(null), contextlib.redirect_stderr(null):
        diagnostics = schema_group(request["schema"]).check_dtb(request["dtb"])
    with open(request["json_output"], "w", encoding="utf-8") as f:
        json.dump(diagnostics, f, indent=2)
        f.write("\n")


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        global last_request
        last_request = time.monotonic()
        # A check past CHECK ends the worker, whatever it is doing.
        limit = threading.Timer(CHECK, leave, (1,))
        limit.daemon = True
        limit.start()
        try:
            check(json.loads(self.rfile.readline()))
            answer = {"ok": True}
        except (Exception, SystemExit) as error:
            answer = {"ok": False, "error": f"{type(error).__name__}: {error}"}
        finally:
            limit.cancel()
        self.wfile.write((json.dumps(answer) + "\n").encode())
        last_request = time.monotonic()


def leave(status):
    """Exit now, even from a thread or with a check under way, removing the socket if it is ours."""
    with contextlib.suppress(OSError):
        if bound is not None and os.stat(SOCKET).st_ino == bound:
            os.unlink(SOCKET)
    os._exit(status)


def bind():
    """The server on SOCKET, or None when another worker answers there."""
    global bound
    try:
        server = socketserver.UnixStreamServer(SOCKET, Handler)
    except OSError:
        probe = socket.socket(socket.AF_UNIX)
        try:
            probe.connect(SOCKET)
            return None
        except OSError:
            # A worker that died left its socket file.
            os.unlink(SOCKET)
        finally:
            probe.close()
        server = socketserver.UnixStreamServer(SOCKET, Handler)
    os.chmod(SOCKET, 0o600)
    bound = os.stat(SOCKET).st_ino
    return server


def watch():
    while True:
        time.sleep(2)
        try:
            os.kill(OWNER, 0)
        except ProcessLookupError:
            break
        except PermissionError:
            pass
        if time.monotonic() - last_request > IDLE:
            break
    # Not server.shutdown(): it waits for a check under way, which may never end.
    leave(0)


def main():
    server = bind()
    if server is None:
        return
    threading.Thread(target=watch, daemon=True).start()
    try:
        server.serve_forever()
    finally:
        leave(1)


if __name__ == "__main__":
    main()
