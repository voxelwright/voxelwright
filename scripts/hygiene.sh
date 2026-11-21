#!/bin/bash
# Machine hygiene for the factory Mac (#465): removes finished git worktrees
# and raises a disk alarm. Run hourly by launchd; see --install.
#
#   scripts/hygiene.sh            remove finished worktrees, prune, check disk
#   scripts/hygiene.sh --dry-run  print what would be removed, change nothing
#   scripts/hygiene.sh --install  copy this script to ~/.village/bin and load
#                                 the hourly launchd agent
#
# A worktree under $WORKTREES is removed only when all of these hold:
#   - no modified files, and no untracked files apart from node_modules, dist,
#     target, .venv and __pycache__;
#   - its HEAD is merged into origin/main, or its branch is gone on the remote,
#     or nothing in it changed for 3 days and its HEAD is on a pushed branch;
#   - nothing in it changed in the last 2 hours (a fresh worktree from main
#     counts as merged before its agent starts);
#   - it is not under feature-450-*, not locked, and no running process has a
#     file or working directory inside it (lsof).
# A HEAD that no branch contains gets refs/backup/wt-<name> first.
set -uo pipefail

REPO="${VILLAGE_REPO:-$HOME/Developer/Village}"
WORKTREES="${VILLAGE_WORKTREES:-$HOME/.t3/worktrees/Village}"
LOG="$HOME/.village/hygiene.log"
LABEL="village.hygiene"
STALE_DAYS=3
GRACE_S=7200
MIN_FREE_GIB=60
JUNK='(^|/)(node_modules|dist|target|\.venv|__pycache__)(/|$)'

mkdir -p "$(dirname "$LOG")"
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG"; }

install_agent() {
  local bin="$HOME/.village/bin/hygiene.sh"
  local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$(dirname "$bin")"
  cp "$0" "$bin" && chmod 755 "$bin"
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$bin</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StandardOutPath</key><string>$HOME/.village/hygiene.out</string>
  <key>StandardErrorPath</key><string>$HOME/.village/hygiene.out</string>
</dict>
</plist>
EOF
  plutil -lint "$plist" >/dev/null || exit 1
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  launchctl bootstrap "gui/$(id -u)" "$plist" && echo "installed $plist -> $bin"
}

DRY=0
case "${1:-}" in
  --dry-run) DRY=1 ;;
  --install) install_agent; exit ;;
  "") ;;
  *) echo "usage: $0 [--dry-run|--install]" >&2; exit 2 ;;
esac

check_disk() {
  # df -k: 1024-byte blocks; columns 2 size, 4 available.
  read -r size avail < <(df -k /System/Volumes/Data | awk 'NR==2 {print $2, $4}')
  local pct=$((avail * 100 / size)) gib=$((avail / 1024 / 1024))
  if ((gib < MIN_FREE_GIB)); then
    log "disk alarm: ${gib} GiB free (${pct}%) on /System/Volumes/Data"
    ((DRY)) || osascript -e "display notification \"${gib} GiB free (${pct}%)\" with title \"Village: disk low\"" 2>/dev/null
  else
    echo "disk ok: ${gib} GiB free (${pct}%)"
  fi
}

git -C "$REPO" fetch --quiet --prune origin || log "fetch failed; using last known remote refs"
git -C "$REPO" rev-parse --verify --quiet origin/main >/dev/null || { log "no origin/main in $REPO"; exit 1; }

# Every path any running process has open or uses as its working directory.
OPEN=$(mktemp)
trap 'rm -f "$OPEN"' EXIT
lsof -n -P -w -Fn 2>/dev/null | sed -n "s|^n\($WORKTREES/[^/]*\).*|\1|p" | sort -u >"$OPEN"

touched_since() { # $1 worktree, $2 seconds; true if a file outside the junk dirs changed that recently
  [[ -n $(find "$1" \( -name node_modules -o -name dist -o -name target -o -name .venv -o -name __pycache__ -o -name .git \) -prune \
    -o -newermt "@$(( $(date +%s) - $2 ))" -print -quit 2>/dev/null) ]]
}

removed=0 kept=0
while read -r wt branch locked; do
  name=$(basename "$wt")
  [[ $name == feature-450-* ]] && { kept=$((kept + 1)); continue; }
  [[ $locked == locked ]] && { echo "keep $name: locked"; kept=$((kept + 1)); continue; }
  grep -qxF "$wt" "$OPEN" && { echo "keep $name: open in a running process"; kept=$((kept + 1)); continue; }
  [[ -d $wt ]] || continue # missing dirs are handled by prune

  status=$(git -C "$wt" status --porcelain 2>&1) || { echo "keep $name: git status failed"; kept=$((kept + 1)); continue; }
  dirty=$(grep -v '^?? ' <<<"$status"; sed -n 's/^?? //p' <<<"$status" | grep -vE "$JUNK")
  [[ -n $dirty ]] && { echo "keep $name: uncommitted or untracked files"; kept=$((kept + 1)); continue; }

  head=$(git -C "$wt" rev-parse HEAD)
  reason=""
  if git -C "$REPO" merge-base --is-ancestor "$head" origin/main; then
    reason="merged into origin/main"
  elif [[ -n $branch && $(git -C "$REPO" for-each-ref --format='%(upstream:track)' "refs/heads/$branch") == "[gone]" ]]; then
    reason="branch $branch deleted on the remote"
  elif [[ -n $branch ]] && git -C "$REPO" rev-parse --verify --quiet "refs/remotes/origin/$branch" >/dev/null \
       && git -C "$REPO" merge-base --is-ancestor "$head" "refs/remotes/origin/$branch" && ! touched_since "$wt" $((STALE_DAYS * 86400)); then
    reason="untouched ${STALE_DAYS}d, pushed as origin/$branch"
  fi
  [[ -z $reason ]] && { echo "keep $name: ${branch:-detached} not finished"; kept=$((kept + 1)); continue; }
  # A worktree just made from main counts as merged; give its agent time to start.
  touched_since "$wt" $GRACE_S && { echo "keep $name: changed in the last $((GRACE_S / 3600))h"; kept=$((kept + 1)); continue; }

  backup=""
  if [[ -z $(git -C "$REPO" for-each-ref --contains "$head" --count=1 refs/heads refs/remotes) ]]; then
    backup=" backup refs/backup/wt-$name"
  fi
  if ((DRY)); then
    echo "would remove $name ($reason)$backup"
  else
    [[ -n $backup ]] && git -C "$REPO" update-ref "refs/backup/wt-$name" "$head"
    if git -C "$REPO" worktree remove --force "$wt"; then
      log "removed $wt ($reason, ${head:0:10})$backup"
    else
      log "failed to remove $wt"
    fi
  fi
  removed=$((removed + 1))
done < <(git -C "$REPO" worktree list --porcelain | awk -v root="$WORKTREES/" '
  /^worktree / { wt = substr($0, 10); br = ""; lk = "" }
  /^branch /   { br = substr($0, 8); sub("^refs/heads/", "", br) }
  /^locked/    { lk = "locked" }
  /^$/         { if (index(wt, root) == 1) print wt "\t" br "\t" lk }
  END          { if (index(wt, root) == 1) print wt "\t" br "\t" lk }' | sort -u | tr '\t' ' ')

if ((DRY)); then
  echo "dry run: would remove $removed, keep $kept"
  git -C "$REPO" worktree prune --dry-run --verbose
else
  git -C "$REPO" worktree prune
  log "removed $removed worktrees, kept $kept"
fi
check_disk
