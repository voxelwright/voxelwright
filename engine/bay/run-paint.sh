#!/bin/sh
set -eu
bay="$HOME/.village/engine/bay"
job="$bay/450-city-paint"
label=village.sf450.facadepaint
case "${1:-status}" in
start)
    rev=$(git rev-parse HEAD)
    src="$job/runner/$rev"
    mkdir -p "$src" "$HOME/Library/LaunchAgents"
    git archive "$rev" engine/bay | tar -x -C "$src"
    "$bay/venv/bin/python" - "$job" "$label" "$src" <<'PY'
import os, plistlib, sys
from pathlib import Path
root, label, src=sys.argv[1:]
job=Path.home()/"Library/LaunchAgents"/(label+".plist")
cfg=dict(Label=label, ProgramArguments=["/usr/bin/caffeinate","-dimsu",str(Path(root).parent/"venv/bin/python"),"-u",src+"/engine/bay/city_paint.py","worker"],
         StandardOutPath=root+"/worker.log", StandardErrorPath=root+"/worker.err", RunAtLoad=True,KeepAlive=True,ThrottleInterval=120)
tmp=job.with_suffix(".part")
tmp.write_bytes(plistlib.dumps(cfg))
os.replace(tmp,job)
PY
    launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$label.plist"
    ;;
status)
    launchctl list "$label" | head -6
    "$bay/venv/bin/python" "$(dirname "$0")/city_paint.py" status
    ;;
*) exit 2 ;;
esac
