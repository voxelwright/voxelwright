#!/bin/sh
# Install a committed, locally reproducible survey and panel runner.
set -eu
bay="$HOME/.village/engine/bay"
job="$bay/450-city-paint"
label=village.sf450.facadepaint
case "${1:-status}" in
start)
    rev=$(git rev-parse HEAD)
    src="$job/runner/$rev"
    mkdir -p "$job/runner" "$HOME/Library/LaunchAgents"
    if [ ! -f "$src/engine/page/core.wasm" ]; then
        staging=$(mktemp -d "$job/runner/staging.XXXXXXXX")
        trap 'rm -rf "$staging"' EXIT
        git archive "$rev" engine | tar -x -C "$staging"
        /bin/cp -cR engine/node_modules "$staging/engine/node_modules"
        /bin/cp -c engine/page/core.wasm "$staging/engine/page/core.wasm"
        mv "$staging" "$src"
    fi
    "$bay/venv/bin/python" - "$job" "$label" "$src" "$(command -v node)" <<'PY'
import os, plistlib, sys
from pathlib import Path
root, label, src, node = sys.argv[1:]
job=Path.home()/"Library/LaunchAgents"/(label+".plist")
cfg=dict(Label=label,ProgramArguments=["/usr/bin/caffeinate","-dimsu",str(Path(root).parent/"venv/bin/python"),"-u",src+"/engine/bay/paint_service.py"],
         EnvironmentVariables={"PATH":str(Path(node).parent)+":/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"},
         StandardOutPath=root+"/service.log",StandardErrorPath=root+"/service.err",RunAtLoad=True,KeepAlive=True,ThrottleInterval=120)
tmp=job.with_suffix(".part")
tmp.write_bytes(plistlib.dumps(cfg))
os.replace(tmp,job)
PY
    domain="gui/$(id -u)"
    if launchctl print "$domain/$label" >/dev/null 2>&1; then
        launchctl bootout "$domain/$label"
    fi
    launchctl bootstrap "$domain" "$HOME/Library/LaunchAgents/$label.plist"
    ;;
status)
    launchctl list "$label" | head -6
    "$bay/venv/bin/python" "$(dirname "$0")/city_paint.py" status
    ;;
*) echo "usage: $0 start|status" >&2; exit 2 ;;
esac
