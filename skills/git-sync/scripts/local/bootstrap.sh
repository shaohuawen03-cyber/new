#!/usr/bin/env bash
# bootstrap.sh - Linux twin of bootstrap.ps1 -Auto
#
# ONE command that connects this clone to the local machine:
#   1. refuse main/master
#   2. make sure the config exists and branch/remote are right
#   3. point check_cmd at the LINUX twin (the config ships a PowerShell one)
#   4. first fetch + checkout + pull --ff-only
#   5. prove the credential works silently (ls-remote) - report, do not block
#   6. register the watcher (systemd --user timer, else cron)
#   7. run one poll round immediately so the loop is live from the start
#
# Usage:  bash bootstrap.sh [--config PATH] [--no-register] [--url URL] [--branch B]
# Exit :  0 ok, 1 refused, 3 git problem, 4 no credential yet (still registered)

set -uo pipefail
# lib.sh normally sits next to this script (scripts/local/). When this file
# has been copied elsewhere (bootstrap.sh installs a copy at code/local_check.sh)
# it must be found under skills/git-sync/scripts/local/ instead.
_find_lib() {
  local d cand up p
  d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  for cand in "$d/lib.sh" \
              "$d/scripts/local/lib.sh" \
              "$d/skills/git-sync/scripts/local/lib.sh"; do
    [ -f "$cand" ] && { printf '%s' "$cand"; return 0; }
  done
  up="$d"
  while [ -n "$up" ]; do
    [ -f "$up/skills/git-sync/scripts/local/lib.sh" ] && {
      printf '%s' "$up/skills/git-sync/scripts/local/lib.sh"; return 0; }
    p="$(dirname "$up")"; [ "$p" = "$up" ] && break; up="$p"
  done
  return 1
}
LIB="$(_find_lib)" || { echo "[ERROR] cannot locate lib.sh" >&2; exit 1; }
# shellcheck source=lib.sh
. "$LIB"
# HERE = the directory that holds lib.sh, so sibling scripts are found even when
# this file itself was copied to another directory.
HERE="$(cd "$(dirname "$LIB")" && pwd)"

CONFIG=""; NO_REGISTER=0; URL=""; BRANCH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --config)     CONFIG="$2"; shift 2 ;;
    --no-register) NO_REGISTER=1; shift ;;
    --url)        URL="$2"; shift 2 ;;
    --branch)     BRANCH="$2"; shift 2 ;;
    -h|--help)    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" 2 ;;
  esac
done

REPO="$(repo_root)" || die "not inside a git repository"
cd "$REPO" || die "cannot enter $REPO"

head1 "bootstrap (Linux): $REPO"
if ! git_at_least 2 13; then
  warn "git $GM is old: 'stash push' needs 2.13+, 'remote get-url' needs 2.7+."
  warn "the scripts fall back to the older syntax, so this is only informational."
fi

# ---------------------------------------------------------------- 1. branch
if [ -z "$BRANCH" ]; then
  CFG_TMP="$(resolve_config "$CONFIG")"
  BRANCH="$(cfg_get "$CFG_TMP" branch)"
fi
[ -z "$BRANCH" ] && BRANCH="$(current_branch)"
guard_branch "$BRANCH"
ok "working branch: $BRANCH"

# ------------------------------------------------------------- 2. the config
CFG="$REPO/skills/git-sync/sync.config.json"
if [ ! -f "$CFG" ]; then
  warn "sync.config.json missing - creating it from the defaults"
  mkdir -p "$REPO/skills/git-sync"
  cat > "$CFG" <<'JSON'
{
  "branch": "BRANCH_PLACEHOLDER",
  "remote": "origin",
  "download_dir": "",
  "download_sets": { "final": ["deliverable"], "all": ["deliverable", "code", "results"] },
  "upload_map": { ".docx": "sources", ".doc": "sources", ".pptx": "sources",
                  ".ppt": "sources", ".pdf": "sources", ".md": "sources",
                  ".txt": "sources", ".py": "code", ".ipynb": "code",
                  ".xlsx": "results", ".xls": "results", ".csv": "results" },
  "gate": "bash code/check_all.sh",
  "receipt": "results/sync/last_sync.md",
  "receipt_history": "results/sync/history",
  "hardware_dir": "results/hardware",
  "handshake": "results/status/handshake.json",
  "check_cmd": "bash code/local_check.sh",
  "check_timeout_min": 30,
  "lock_stale_min": 45,
  "hands_free": true,
  "auto_pull": true,
  "auto_push": true,
  "auto_push_prefix": "local: auto",
  "success_criteria": "results/status/success_criteria.json"
}
JSON
  cfg_set "$CFG" branch "\"$BRANCH\""
fi
ok "config: $CFG"

# ------------------------------------- 3. check_cmd must be runnable HERE
CHECK_CMD="$(cfg_get "$CFG" check_cmd '')"
if [ -z "$CHECK_CMD" ]; then
  cfg_set "$CFG" check_cmd '"bash code/local_check.sh"'
  ok "check_cmd was empty -> bash code/local_check.sh"
elif printf '%s' "$CHECK_CMD" | grep -qi 'powershell\|\.ps1'; then
  if have powershell || have pwsh; then
    info "check_cmd uses PowerShell and PowerShell IS installed - keeping it"
  else
    cfg_set "$CFG" check_cmd '"bash code/local_check.sh"'
    ok "check_cmd was a PowerShell command but no PowerShell here -> bash code/local_check.sh"
    info "a repo-local copy is installed at code/local_check.sh further down (step 6)"
  fi
else
  ok "check_cmd: $CHECK_CMD"
fi

# ------------------------------------------------------------ 4. first pull
if bash "$HERE/sync.sh" ${CONFIG:+--config "$CONFIG"}; then
  ok "branch is current"
else
  err "the first sync failed - fix the network/branch, then re-run bootstrap.sh"
  exit 3
fi

# --------------------------------------------- 5. prove the credential (quiet)
printf '\n'
info "checking the credential (silently - nothing can pop a window)..."
export GIT_TERMINAL_PROMPT=0
REMOTE="$(cfg_get "$CFG" remote origin)"; [ -z "$REMOTE" ] && REMOTE="origin"
CRED_RC=0
if git -c credential.interactive=false ls-remote "$REMOTE" >/dev/null 2>&1; then
  ok "the credential authenticates - silent push will work"
else
  CRED_RC=4
  warn "git could not authenticate silently yet."
  warn "fix once, then re-run bootstrap.sh:"
  warn "   gh auth login                       # interactive, stores the token"
  warn "   gh auth switch -u <login>           # switch the machine default"
  warn "   bash tools/gacc use <login>         # or pin ONLY this clone"
fi

# --------------------------------------------------------- 6. the Linux twin
if [ ! -f "$REPO/code/local_check.sh" ]; then
  mkdir -p "$REPO/code"
  cp "$HERE/local_check.sh" "$REPO/code/local_check.sh"
  ok "installed code/local_check.sh (what the watcher runs on this machine)"
fi

# ---------------------------------------------------------- 7. register + go
if [ "$NO_REGISTER" = "1" ]; then
  warn "--no-register: the watcher was NOT registered (this is still not 'connected')"
else
  printf '\n'
  if bash "$HERE/watch.sh" --register; then
    :
  else
    warn "could not register a timer - run the loop by hand:"
    warn "   nohup bash $HERE/watch.sh --loop >/dev/null 2>&1 &"
  fi
fi

# One immediate round, so the first verdict does not wait a full interval.
printf '\n'
info "running one poll round now..."
bash "$HERE/watch.sh" --once ${CONFIG:+--config "$CONFIG"} || true

printf '\n'
head1 "bootstrap finished"
if [ "$CRED_RC" = "4" ]; then
  warn "the credential is not set up yet - the watcher is registered but pushes will fail."
  warn "fix the credential, then run:  bash $HERE/watch.sh --once"
  exit 4
fi
ok "this clone is connected to the local machine."
info "you now only need two commands:"
info "   bash $HERE/sync.sh        # take what the agent pushed"
info "   bash $HERE/upload.sh      # send your files"
info "deliverables land with:  bash $HERE/download.sh --set final"
exit 0
