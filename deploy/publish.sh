#!/usr/bin/env bash
# Run from deploy/ after assembling both targets. Actions supplies the commit and summary file.
set -euo pipefail
publish() (
  set -e
  local worker=$1 origin=$2 folder=$3
  local args=(--message "$GITHUB_SHA") pages=() manifest="" pin=""
  if [[ "$worker" == voxelwright ]]; then
    args+=(--mode world)
    pin="$(node -p "require('../engine/sf/pilot/current.json').release")"
    manifest="/$(node -p "require('../engine/sf/pilot/current.json').manifest")"
    pages=(/ /current.json "$manifest")
  else
    pages=(/ /blog/ /blog/feed.xml)
  fi
  local deployed=false
  finish() {
    local code=$?
    if (( code != 0 )); then
      if [[ "$deployed" == true ]]; then
        if npx wrangler rollback --name "$worker" -y -m "live check failed for $GITHUB_SHA"; then
          echo "- $worker failed its live check and rolled back." >> "$GITHUB_STEP_SUMMARY"
        else
          echo "- $worker failed its live check and rollback failed." >> "$GITHUB_STEP_SUMMARY"
        fi
      else
        echo "- $worker deploy failed before confirmation." >> "$GITHUB_STEP_SUMMARY"
      fi
      # A CLI failure can follow a successful upload. Report what actually has traffic.
      npx wrangler deployments status --name "$worker" >> "$GITHUB_STEP_SUMMARY" ||
        echo "Could not read $worker traffic status." >> "$GITHUB_STEP_SUMMARY"
    fi
  }
  trap finish EXIT
  npx cf deploy "${args[@]}"
  deployed=true
  npx wrangler deployments status --name "$worker" | tee status.txt
  grep -Fq "(100%)" status.txt
  grep -Fq "$GITHUB_SHA" status.txt
  # Retry HTTP 404 or a stale /current.json pin briefly: Cloudflare Workers edge propagation can
  # take several seconds after cf deploy reports 100% when a new release swaps thousands of assets.
  get() {
    local path=$1 want_pin=${2:-} attempt status
    for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      if [[ -n "$want_pin" ]]; then
        status=$(curl -sS --max-time 30 -o body.tmp -D headers.txt -w '%{http_code}' -H 'Cache-Control: no-cache' "$origin$path" || true)
      else
        status=$(curl -sS --max-time 30 -o /dev/null -D headers.txt -w '%{http_code}' -H 'Accept-Encoding: br, gzip' "$origin$path" || true)
      fi
      status=${status:-000}
      if [[ "$status" == 200 ]]; then
        if [[ -z "$want_pin" ]] || grep -Fq "$want_pin" body.tmp; then
          echo "$status"
          return 0
        fi
        status="200-stale-pin"
      fi
      if (( attempt < 15 )); then
        echo "$origin$path $status (attempt $attempt/15; waiting for edge propagation)" >&2
        sleep 3
      fi
    done
    cat headers.txt >&2 || true
    echo "$status"
  }
  local page status
  for page in "${pages[@]}"; do
    if [[ "$worker" == voxelwright && "$page" == /current.json ]]; then
      status=$(get "$page" "$pin")
    else
      status=$(get "$page")
    fi
    echo "$origin$page $status"
    test "$status" = 200
  done
  if [[ "$worker" == voxelwright ]]; then
    grep -qi '^content-encoding: br' headers.txt
    grep -qi "^content-length: $(stat -c%s "$folder$manifest.br")"$'\r'"\?$" headers.txt
  fi
  echo "- $worker deployed and passed the live check at $GITHUB_SHA." >> "$GITHUB_STEP_SUMMARY"
)
echo "Deploy order is voxelwright, then zahynailo. A failure stops the sequence." >> "$GITHUB_STEP_SUMMARY"
publish voxelwright https://voxelwright.world dist-world
publish zahynailo https://zahynailo.dev dist
