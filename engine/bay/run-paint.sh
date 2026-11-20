#!/bin/sh
# Install a committed, locally reproducible survey and panel runner.
set -eu
bay="$HOME/.village/engine/bay"
job="$bay/450-city-paint"
label=village.sf450.facadepaint
case "${1:-status}" in
start|publication)
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
    if [ "$1" = publication ]; then
        # Each publication starts a new interpreter. Switch its entry only; keep any current worker or panel alive.
        "$bay/venv/bin/python" - "$job" "$label" "$src" <<'PYTHON'
import json, os, plistlib, sys
from pathlib import Path
root, label, source = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
plist = Path.home() / "Library/LaunchAgents" / (label + ".plist")
entry = Path(plistlib.loads(plist.read_bytes())["ProgramArguments"][-1])
if entry.name != "paint_service.py" or not entry.is_relative_to(root / "runner"):
    raise ValueError("unknown active supervisor")
target = source / "engine/bay/paint_publication.py"
live = entry.with_name(target.name)
if not target.is_file():
    raise ValueError("missing publication snapshot")
if live != target:
    tmp = live.with_suffix(".switch")
    tmp.unlink(missing_ok=True)
    tmp.symlink_to(target)
    tmp.replace(live)
record = root / "publication-runner.json"
tmp = record.with_suffix(".tmp")
tmp.write_text(json.dumps(dict(supervisor=str(entry), publication=str(target)))+"\n")
tmp.replace(record)
PYTHON
        exit 0
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
    # bootout returns while the old instance is still leaving its bootstrap domain.
    remaining=20
    until launchctl bootstrap "$domain" "$HOME/Library/LaunchAgents/$label.plist" 2>"$job/bootstrap.err"; do
        remaining=$((remaining-1))
        if [ "$remaining" -le 0 ]; then cat "$job/bootstrap.err" >&2; exit 1; fi
        sleep 1
    done
    ;;
status)
    launchctl list "$label" | head -6
    "$bay/venv/bin/python" "$(dirname "$0")/city_paint.py" status
    ;;
*) echo "usage: $0 start|publication|status" >&2; exit 2 ;;
esac
