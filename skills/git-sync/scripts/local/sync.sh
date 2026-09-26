#!/usr/bin/env bash
# sync.sh - Linux equivalent of sync.ps1
#
# fetch -> checkout the configured branch -> pull --ff-only.
# Local uncommitted changes are stashed first and restored afterwards, so a
# stray edit can never block the sync (same behaviour as sync.ps1).
#
# Usage:  bash sync.sh [--config <path>]
# Exit :  0 ok, 3 git problem (see doctor.sh)

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

CONFIG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --config) CONFIG="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" 2 ;;
  esac
done

REPO="$(repo_root)" || die "not inside a git repository"
cd "$REPO" || die "cannot enter $REPO"

CFG="$(resolve_config "$CONFIG")"
BRANCH="$(cfg_get "$CFG" branch)"
REMOTE="$(cfg_get "$CFG" remote origin)"
[ -z "$BRANCH" ] && BRANCH="$(current_branch)"
[ -z "$REMOTE" ] && REMOTE="origin"
guard_branch "$BRANCH"

head1 "sync: $REPO"
info "branch : $BRANCH   remote: $REMOTE"
[ -n "$CFG" ] && info "config : $CFG"

# Make sure the remote actually tracks every branch, otherwise a fresh clone
# can fail to see the working branch at all.
git_silent config "remote.$REMOTE.fetch" "+refs/heads/*:refs/remotes/$REMOTE/*" 2>/dev/null || true

if ! git_silent fetch "$REMOTE" --quiet; then
  err "git fetch failed - network? run: bash doctor.sh"
  exit 3
fi
ok "fetched $REMOTE"

if ! git rev-parse --verify --quiet "$REMOTE/$BRANCH" >/dev/null; then
  err "branch $BRANCH does not exist on $REMOTE yet (nobody pushed it?)"
  exit 3
fi

CUR="$(current_branch)"
if [ "$CUR" != "$BRANCH" ]; then
  info "switching $CUR -> $BRANCH"
  git_silent checkout "$BRANCH" 2>/dev/null || { err "checkout $BRANCH failed"; exit 3; }
fi

# Stash anything dirty, pull, then put it back. --include-untracked so new
# files travel too; pop failure is reported but not fatal (the pull succeeded).
DIRTY=0
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  DIRTY=1
  info "local changes present - stashing them for the pull"
  # git_stash_push 会先试 "stash push"（Git 2.13+），失败再退 "stash save"，
  # 并把真实原因显示出来（老 git 上 "stash push" 子命令不存在）。
  if ! STASH_ERR="$(git_stash_push "sync.sh $(stamp)" 2>&1)"; then
    warn "stash failed - continuing, the pull may be rejected"
    [ -n "$STASH_ERR" ] && printf '     reason: %s\n' "$(printf '%s' "$STASH_ERR" | head -2 | tr '\n' ' ')" >&2
  fi
fi

if git_silent pull --ff-only "$REMOTE" "$BRANCH" --quiet; then
  ok "pulled $REMOTE/$BRANCH (fast-forward)"
else
  err "pull --ff-only failed - the local branch has diverged from $REMOTE/$BRANCH."
  err "run: bash doctor.sh -Fix   (it stashes, re-points the branch and pulls)"
  [ "$DIRTY" = "1" ] && warn "if a stash was created it is still there: git stash list"
  exit 3
fi

# 只有真建了 stash 才需要 pop。老 git 上 stash 可能压根没建成，此时改动一直
# 留在工作区（什么都没丢），不能再报一次 pop 失败吓人。
if [ "$DIRTY" = "1" ]; then
  if [ -z "$(git stash list 2>/dev/null)" ]; then
    ok "nothing was stashed - your changes stayed in the worktree"
  elif git stash pop --quiet 2>/dev/null; then
    ok "restored your local changes on top of the pull"
  else
    warn "could not re-apply the stash automatically (conflict?)."
    warn "your work is safe: git stash list  ->  git stash pop"
  fi
fi

info "HEAD: $(git log -1 --oneline 2>/dev/null)"
exit 0
