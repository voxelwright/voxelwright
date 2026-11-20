#!/bin/sh
# Grows the far model as the city's run finishes squares (#450): bakes every square whose archive is new or changed
# (bake.py skips the rest), then packs again only the tiles those squares touch (pack.mjs). Safe to run as often as
# wanted, by hand or after each square; `--watch 300` runs it every five minutes until stopped.
#
#   sh engine/sf/far/grow.sh [--watch seconds]
set -e
here=$(cd "$(dirname "$0")" && pwd)
PY=${PY:-$HOME/.village/engine/landing/ina/venv/bin/python}
once() {
  # (The venv's Python says at start that it has no blake2 hashes: those lines are not the bake's.)
  "$PY" -B -W ignore "$here/bake.py" 2>&1 | grep -v 'hash type blake2\|^ERROR:root:code for hash\|hashlib.py\|__get_builtin_constructor\|__get_openssl_constructor\|globals()\[__func_name\]\|~~~\|^Traceback (most recent call last):$' || true
  node "$here/pack.mjs"
  node "$here/coverage.mjs"
}
if [ "$1" = "--watch" ]; then
  while :; do once; sleep "${2:-300}"; done
else
  once
fi
