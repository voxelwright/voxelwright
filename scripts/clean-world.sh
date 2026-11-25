#!/bin/sh
# macOS cold build. Supply the port of a loopback mirror of releases/download.
# The returned directory also holds the empty home, build outputs and trace.
set -eu
port=${1:?usage: scripts/clean-world.sh BUNDLE_PORT [command args ...]}
case "$port" in ''|*[!0-9]*) exit 2;; esac
shift
room=$(mktemp -d /private/tmp/voxelwright.XXXXXX)
chmod 700 "$room"
mkdir "$room/home" "$room/tmp" "$room/bin"
printf 'Clean room: %s\n' "$room"
branch=$(git branch --show-current)
env -i HOME="$room/home" PATH=/usr/bin:/bin GIT_CONFIG_NOSYSTEM=1 git clone -q --no-local --depth 1 --single-branch -b "$branch" "file://$(pwd)" "$room/repo"
sysroot=$(rustc --print sysroot)
node=$(node -p 'process.execPath')
ln -s "$node" "$room/bin/node"
cat > "$room/build.sb" <<'PROFILE'
(version 1)
(allow default)
(deny file-read* file-write* (with message (param "TAG")))
(allow file-read-metadata (with report) (with message (param "TAG")))
(allow file-read* (with report) (with message (param "TAG")) (literal "/") (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin")
  (subpath "/Library/Developer") (subpath "/Applications/Xcode.app") (subpath "/private/etc")
  (subpath "/dev") (subpath (param "RUST")) (literal (param "NODE")))
(allow file-read* file-write* (with report) (with message (param "TAG")) (subpath (param "ROOM")) (literal "/dev/null") (literal "/dev/tty"))
(allow file-read* file-write* (subpath (param "CLONE")))
(deny network*)
(allow network-outbound (remote ip (param "BUNDLE")))
(allow network-bind network-inbound (local ip "localhost:5760"))
PROFILE
cd "$room/repo"
if [ "$#" -eq 0 ]; then set -- ./world; fi
tag="world-proof-${room##*.}"
/usr/bin/log stream --style ndjson --predicate "process == 'kernel' AND eventMessage CONTAINS '$tag'" > "$room/outside.ndjson" &
logger=$!
trap 'kill "$logger" 2>/dev/null || true' EXIT
env -i HOME="$room/home" TMPDIR="$room/tmp" PATH="$room/bin:$sysroot/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  CARGO_NET_OFFLINE=true GIT_CONFIG_NOSYSTEM=1 VOXELWRIGHT_DATA_URL="http://127.0.0.1:$port" \
  /usr/bin/sandbox-exec -D "TAG=$tag" -D "CLONE=$room/repo" -D "ROOM=$room" -D "NODE=$node" -D "RUST=$sysroot" -D "BUNDLE=localhost:$port" -f "$room/build.sb" "$@"
