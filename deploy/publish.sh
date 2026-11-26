#!/usr/bin/env bash
# Run from deploy/ after assembling both targets. Actions supplies the commit and summary file.
set -euo pipefail
publish() (
  set -e
  local worker=$1 origin=$2 folder=$3
  local args=(--message "$GITHUB_SHA") pages=(/ /current.json)
  if [[ "$worker" == voxelwright ]]; then
    args+=(--mode world)
  else
    pages+=(/blog/ /blog/feed.xml)
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
  get() { curl -sS --retry 4 --retry-all-errors --max-time 30 -o /dev/null -D headers.txt -w '%{http_code}' -H 'Accept-Encoding: br, gzip' "$origin$1"; }
  local page status manifest
  manifest="/$(node -p "require('../engine/sf/pilot/current.json').manifest")"
  for page in "${pages[@]}" "$manifest"; do
    status=$(get "$page")
    echo "$origin$page $status"
    test "$status" = 200
  done
  grep -qi '^content-encoding: br' headers.txt
  grep -qi "^content-length: $(stat -c%s "$folder$manifest.br")"$'\r'"\?$" headers.txt
  echo "- $worker deployed and passed the live check at $GITHUB_SHA." >> "$GITHUB_STEP_SUMMARY"
)
echo "Deploy order is voxelwright, then zahynailo. A failure stops the sequence." >> "$GITHUB_STEP_SUMMARY"
publish voxelwright https://voxelwright.world dist-world
publish zahynailo https://zahynailo.dev dist
