"""Run one imagery process and the offline panel/graph consumer under the same launchd job."""

import os
import signal
import subprocess
import sys
import time

from city_paint import CITY, HERE, ROOT


def service():
    running = {}
    next_run = {"worker": 0, "panel": 0, "graph": 0, "publication": 0}
    commands = {
        "worker": ["city_paint.py", "worker"],
        "panel": ["city_panel.py", "stage"],
        "graph": ["transport.py", str(CITY), str(ROOT / "graph")],
        "publication": ["paint_publication.py"],
    }
    intervals = {"worker": 120, "panel": 600, "graph": 600, "publication": 1800}

    def stop(signum, frame):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while True:
            for name, args in commands.items():
                child = running.get(name)
                if child:
                    code = child.poll()
                    if code is None:
                        continue
                    del running[name]
                    next_run[name] = time.time() + intervals[name]
                    print(name, "exited", code, flush=True)
                if time.time() < next_run[name]:
                    continue
                with (ROOT / (name + ".log")).open("ab") as log:
                    running[name] = subprocess.Popen(
                        [sys.executable, "-u", str(HERE / args[0]), *args[1:]],
                        stdout=log,
                        stderr=log,
                        start_new_session=True,
                    )
            time.sleep(15)
    finally:
        for child in running.values():
            if child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        for child in running.values():
            child.wait(timeout=20)


if __name__ == "__main__":
    service()
