#!/bin/sh
# A launchd-owned, caffeinated acquisition. The source snapshot pins the resume recipe.
set -eu
bay="$HOME/.village/engine/bay"
runner="$bay/450-runner"
output="$bay/sf-450-city"
label="village.sf450.citydata"
case "${1:-status}" in
start|start-private)
    mkdir -p "$runner" "$output"
    if [ ! -f "$runner/revision" ]; then
        rev=$(git rev-parse HEAD)
        git archive "$rev" engine/bay engine/sf/release.py | tar -x -C "$runner"
        echo "$rev" > "$runner/revision"
    fi
    revision=$(git rev-parse HEAD)
    manager="$bay/450-city-managers/$revision"
    if [ ! -d "$manager" ]; then
        mkdir -p "$bay/450-city-managers"
        staging=$(mktemp -d "$bay/450-city-managers/staging.XXXXXXXX")
        git archive "$revision" engine/bay engine/sf | tar -x -C "$staging"
        mv "$staging" "$manager"
    fi
    launchctl submit -l "$label" -o "$bay/450-city.log" -e "$bay/450-city.err" -- \
        /usr/bin/caffeinate -dimsu /bin/sh -ec '
            fixture_option=
            if [ "$6" = start-private ]; then fixture_option=--public-works-fixtures; fi
            "$1" -u "$2/engine/bay/full_run.py" --compact $fixture_option --bake-source "$3/engine/bay" --output "$4"
            "$1" "$2/engine/sf/release.py" "$4" "$4/sf" --compact-store "$4/objects"
            # A submitted job is kept alive. Once the release is staged, leave instead of baking it again.
            launchctl remove "$5"
        ' sf-bake "$bay/venv/bin/python" "$manager" "$runner" "$output" "$label" "$1"
    ;;
status)
    launchctl list "$label" || true
    if [ -f "$output/state.json" ]; then
        jq '.done | keys | {inputs:map(select(startswith("inputs-")))|length, squares:map(select(test("^[0-9]")))|length, tileGroups:map(select(startswith("tiles-")))|length}' "$output/state.json"
    fi
    if [ -f "$output/disk-hold.json" ]; then cat "$output/disk-hold.json"; fi
    df -h "$bay"
    ;;
*) echo "usage: $0 start|start-private|status" >&2; exit 2 ;;
esac
