#!/bin/sh
# A launchd-owned, caffeinated acquisition. The source snapshot pins the resume recipe.
set -eu
bay="$HOME/.village/engine/bay"
runner="$bay/450-runner"
output="$bay/sf-450-city"
label="village.sf450.citydata"
case "${1:-status}" in
start)
    mkdir -p "$runner" "$output"
    if [ ! -f "$runner/revision" ]; then
        rev=$(git rev-parse HEAD)
        git archive "$rev" engine/bay | tar -x -C "$runner"
        echo "$rev" > "$runner/revision"
    fi
    launchctl submit -l "$label" -o "$bay/450-city.log" -e "$bay/450-city.err" -- \
        /usr/bin/caffeinate -dimsu "$bay/venv/bin/python" -u "$runner/engine/bay/full_run.py" --output "$output"
    ;;
status)
    launchctl list "$label" || true
    if [ -f "$output/state.json" ]; then
        jq '.done | keys | {inputs:map(select(startswith("inputs-")))|length, squares:map(select(test("^[0-9]")))|length, tileGroups:map(select(startswith("tiles-")))|length}' "$output/state.json"
    fi
    df -h "$bay"
    ;;
*) echo "usage: $0 start|status" >&2; exit 2 ;;
esac
