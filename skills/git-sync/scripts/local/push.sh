#!/usr/bin/env bash
# push.sh - Linux equivalent of push.ps1
#
# pull --ff-only -> add -A -> commit -> push. Refuses main/master.
# Silent by default: git prompts are disabled, so no credential window can
# ever appear; if git cannot authenticate it exits 4 with the exact fix.
#
# Usage:  bash push.sh [message] [--branch b] [--remote r] [--config p] [--gate] [--prompt]
# Exit :  0 ok, 1 refused/commit error, 3 fetch/pull/checkout error,
#         4 no usable credentials

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

MESSAGE=""; BRANCH=""; REMOTE=""; CONFIG=""; GATE=0; PROMPT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --branch)  BRANCH="$2"; shift 2 ;;
    --remote)  REMOTE="$2"; shift 2 ;;
    --config)  CONFIG="$2"; shift 2 ;;
    --gate)    GATE=1; shift ;;
    --prompt)  PROMPT=1; shift ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option: $1" 2 ;;
    *) [ -z "$MESSAGE" ] && MESSAGE="$1" || die "unexpected argument: $1" 2; shift ;;
  esac
done
[ -z "$MESSAGE" ] && MESSAGE="local: update from $(hostname_short)"

REPO="$(repo_root)" || die "not inside a git repository"
cd "$REPO" || die "cannot enter $REPO"

CFG="$(resolve_config "$CONFIG")"
[ -z "$BRANCH" ] && BRANCH="$(cfg_get "$CFG" branch)"
[ -z "$REMOTE" ] && REMOTE="$(cfg_get "$CFG" remote origin)"
[ -z "$BRANCH" ] && BRANCH="$(current_branch)"
[ -z "$REMOTE" ] && REMOTE="origin"
guard_branch "$BRANCH"

GATE_CMD="$(cfg_get "$CFG" gate)"

head1 "push: $REPO"
info "branch : $BRANCH   remote: $REMOTE"
if [ "$PROMPT" = "1" ] || [ "${GIT_SYNC_PROMPT:-}" = "1" ]; then
  info "mode   : interactive (git may ask for credentials)"
else
  info "mode   : silent (prompts disabled - no window can appear)"
fi

# --- optional gate before anything is committed -------------------------
if [ "$GATE" = "1" ] && [ -n "$GATE_CMD" ]; then
  info "gate   : $GATE_CMD"
  if ! bash -c "$GATE_CMD"; then
    err "gate failed - nothing was committed."
    exit 1
  fi
  ok "gate passed"
fi

git_silent config "remote.$REMOTE.fetch" "+refs/heads/*:refs/remotes/$REMOTE/*" 2>/dev/null || true
if ! git_silent fetch "$REMOTE" --quiet; then
  err "git fetch failed (network?) - run: bash doctor.sh"
  exit 3
fi

CUR="$(current_branch)"
if [ "$CUR" != "$BRANCH" ]; then
  info "switching $CUR -> $BRANCH"
  git_silent checkout "$BRANCH" 2>/dev/null || { err "checkout $BRANCH failed"; exit 3; }
fi

# Align with the remote first: the agent may have pushed since our last sync,
# and pushing on a stale HEAD gets rejected as non-fast-forward.
if git rev-parse --verify --quiet "$REMOTE/$BRANCH" >/dev/null; then
  if ! git merge-base --is-ancestor "$REMOTE/$BRANCH" HEAD 2>/dev/null; then
    warn "local branch is behind $REMOTE/$BRANCH - pulling first"
  fi
  if ! git_silent pull --ff-only "$REMOTE" "$BRANCH" --quiet; then
    err "pull --ff-only failed - the local branch has diverged from $REMOTE/$BRANCH."
    err "run: bash doctor.sh -Fix"
    exit 3
  fi
  ok "aligned with $REMOTE/$BRANCH"
fi

# Auto-push exclusion list: never let a secret ride along.
AUTO_EXCLUDE="$(cfg_get "$CFG" auto_push_exclude '[]')"
BLOCKED=""
if [ "$AUTO_EXCLUDE" != "[]" ] && [ -n "$AUTO_EXCLUDE" ]; then
  BLOCKED="$(printf '%s' "$AUTO_EXCLUDE" | python3 -c '
import json, subprocess, sys, fnmatch
pats = json.load(sys.stdin)
try:
    out = subprocess.run(["git","status","--porcelain","--untracked-files=all"],
                         capture_output=True, text=True).stdout
except Exception:
    sys.exit(0)
files = [l[3:] for l in out.splitlines() if l.strip()]
bad = []
for f in files:
    for p in pats:
        if fnmatch.fnmatch(f, p) or fnmatch.fnmatch(f.split("/")[-1], p):
            bad.append((f, p)); break
for f, p in bad:
    print("   %s   (matches %s)" % (f, p))
' 2>/dev/null || true)"
fi
if [ -n "$BLOCKED" ]; then
  err "these files match auto_push_exclude and will NOT be pushed:"
  printf '%s\n' "$BLOCKED" >&2
  err "remove them from the worktree (or from the exclusion list) and retry."
  exit 1
fi

if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
  ok "nothing to commit - already up to date."
  exit 0
fi

git add -A
if ! git_silent commit -q -m "$MESSAGE"; then
  err "commit failed."
  exit 1
fi
ok "committed: $MESSAGE"

# Push. Silent mode: GIT_TERMINAL_PROMPT=0 makes git fail instead of asking,
# which is what lets us tell "no credentials" (4) apart from "no permission".
PUSH_ERR="$(git_silent push "$REMOTE" "$BRANCH" 2>&1)"
PUSH_RC=$?
if [ $PUSH_RC -ne 0 ]; then
  printf '%s\n' "$PUSH_ERR" | sed 's/^/   /' >&2
  case "$PUSH_ERR" in
    *"Permission to"*"denied to"*|*"403"*)
      err "403 - the credential works but this ACCOUNT has no push rights on the repo."
      err "this is a permissions problem, not a broken credential."
      err "list who can push:  bash ../gacc-less auth list   (or gh api repos/OWNER/REPO)"
      err "pin this clone to an account that can:  bash tools/gacc use <login>"
      exit 4 ;;
    *"could not read Username"*|*"Terminal prompts disabled"*|*"authentication failed"*|*"could not read Password"*)
      err "no usable credential - git could not authenticate (prompts are disabled)."
      err "fix once, then retry:"
      err "   gh auth login                       # interactive, stores the token"
      err "   gh auth switch -u <login>           # or switch the machine default"
      err "   bash tools/gacc use <login>         # or pin ONLY this clone"
      exit 4 ;;
    *"non-fast-forward"*|*"fetch first"*|*"rejected"*)
      err "push rejected (non-fast-forward) - the remote moved."
      err "run: bash sync.sh    then retry."
      exit 3 ;;
    *)
      err "push failed."
      exit 3 ;;
  esac
fi
ok "pushed to $REMOTE/$BRANCH"
exit 0
