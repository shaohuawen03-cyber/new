#!/usr/bin/env bash
# doctor.sh - Linux twin of doctor.ps1
#
# Read-only health report by default. --Fix performs the same repairs
# doctor.ps1 -Fix does: rebuild the fetch refspec, stash local changes,
# switch back to the configured branch and pull. It NEVER discards work and
# never force-pushes.
#
# Usage:  bash doctor.sh [--fix] [--config PATH]
# Exit :  0 healthy, 1 something needs attention, 2 usage error

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

FIX=0; CONFIG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fix)    FIX=1; shift ;;
    --config) CONFIG="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" 2 ;;
  esac
done

REPO="$(repo_root)" || die "not inside a git repository"
cd "$REPO" || die "cannot enter $REPO"

CFG="$(resolve_config "$CONFIG")"
BRANCH="$(cfg_get "$CFG" branch)"; [ -z "$BRANCH" ] && BRANCH="$(current_branch)"
REMOTE="$(cfg_get "$CFG" remote origin)"; [ -z "$REMOTE" ] && REMOTE="origin"
ISSUES=0

head1 "doctor: $REPO"
printf '   skill version : %s\n' "$(cat "$REPO/skills/git-sync/VERSION" 2>/dev/null || echo '(unknown)')"
printf '   config        : %s\n' "${CFG:-(none found)}"
printf '   branch        : %s\n' "$BRANCH"
printf '   remote        : %s\n' "$REMOTE"
printf '   host          : %s\n' "$(hostname_short)"
printf '   git           : %s\n' "$(git --version 2>/dev/null | head -1)"
if ! git_at_least 2 13; then
  warn_if_old_git
fi
printf '   mode          : %s\n' "$([ "$FIX" = "1" ] && echo 'FIX' || echo 'report only')"

# ---------------------------------------------------------------- 1. branch
CUR="$(current_branch)"
if [ "$CUR" != "$BRANCH" ]; then
  warn "HEAD is on '$CUR', the config says '$BRANCH'"
  ISSUES=$((ISSUES+1))
  if [ "$FIX" = "1" ]; then
    git_stash_push "doctor.sh $(stamp)" >/dev/null 2>&1 || true
    if git checkout "$BRANCH" 2>/dev/null; then ok "  fixed: switched to $BRANCH"
    else err "  could not switch to $BRANCH"; fi
  fi
else
  ok "on the configured branch ($BRANCH)"
fi

# ------------------------------------------------------------- 2. refspec
WANT="+refs/heads/*:refs/remotes/$REMOTE/*"
HAVE_REF="$(git config --get-all "remote.$REMOTE.fetch" 2>/dev/null | head -1)"
if [ "$HAVE_REF" != "$WANT" ]; then
  warn "fetch refspec is '${HAVE_REF:-(unset)}' - a fresh clone may not see the branch"
  ISSUES=$((ISSUES+1))
  [ "$FIX" = "1" ] && { git config "remote.$REMOTE.fetch" "$WANT" && ok "  fixed: refspec -> $WANT"; }
else
  ok "fetch refspec is correct"
fi

# --------------------------------------------------------------- 3. remote
# 用 git config --get 而不是 git remote get-url：后者 Git 2.7+ 才有，
# HPC 上的老 git 会因此把"配好了的 remote"误报成未配置。
RURL="$(remote_url "$REMOTE")"
if [ -n "$RURL" ]; then
  ok "remote '$REMOTE' -> $RURL"
else
  err "remote '$REMOTE' is not configured"
  ISSUES=$((ISSUES+1))
fi

# ------------------------------------------------------------- 4. fetchable
if git_silent fetch "$REMOTE" --quiet 2>/dev/null; then
  ok "fetch works"
else
  err "fetch failed - network, or no credential (see push.sh exit 4)"
  ISSUES=$((ISSUES+1))
fi

# ------------------------------------------------------ 5. diverged history
if git rev-parse --verify --quiet "$REMOTE/$BRANCH" >/dev/null; then
  AHEAD=$(git rev-list --count "$REMOTE/$BRANCH"..HEAD 2>/dev/null || echo 0)
  BEHIND=$(git rev-list --count HEAD.."$REMOTE/$BRANCH" 2>/dev/null || echo 0)
  if [ "$AHEAD" != "0" ] && [ "$BEHIND" != "0" ]; then
    warn "the local branch has DIVERGED ($AHEAD ahead, $BEHIND behind) - never --force this"
    ISSUES=$((ISSUES+1))
    [ "$FIX" = "1" ] && warn "  automatic fix is unsafe here - inspect with: git log --graph --oneline $REMOTE/$BRANCH...HEAD"
  elif [ "$BEHIND" != "0" ]; then
    warn "the local branch is $BEHIND commit(s) behind - run: bash sync.sh"
    ISSUES=$((ISSUES+1))
    if [ "$FIX" = "1" ]; then
      git_stash_push "doctor.sh $(stamp)" >/dev/null 2>&1 || true
      git_silent pull --ff-only "$REMOTE" "$BRANCH" --quiet && ok "  fixed: pulled (fast-forward)"
      git stash pop --quiet 2>/dev/null && ok "  fixed: restored your local changes" || true
    fi
  elif [ "$AHEAD" != "0" ]; then
    ok "the local branch is $AHEAD commit(s) ahead (unpushed work)"
  else
    ok "the local branch is level with $REMOTE/$BRANCH"
  fi
else
  warn "$REMOTE/$BRANCH does not exist yet (nobody has pushed this branch)"
  ISSUES=$((ISSUES+1))
fi

# ---------------------------------------------------------- 6. dirty state
DIRTY="$(git status --porcelain 2>/dev/null)"
if [ -n "$DIRTY" ]; then
  N=$(printf '%s\n' "$DIRTY" | wc -l)
  warn "$N uncommitted change(s) in the worktree"
  printf '%s\n' "$DIRTY" | head -10 | sed 's/^/      /'
  [ "$N" -gt 10 ] && printf '      ... and %s more\n' "$((N-10))"
else
  ok "worktree is clean"
fi

# ------------------------------------------------------------- 7. stashes
STASHES=$(git stash list 2>/dev/null | wc -l)
if [ "$STASHES" != "0" ]; then
  warn "$STASHES stash(es) present - your work may be parked in one:"
  git stash list 2>/dev/null | sed 's/^/      /'
  printf '      restore with: git stash pop\n'
else
  ok "no stashes"
fi

# ------------------------------------------------------- 8. big tracked files
BIG="$(git ls-files -z 2>/dev/null | xargs -0 -r du -k 2>/dev/null | awk '$1 > 51200 {print $2" ("int($1/1024)" MB)"}' | head -10)"
if [ -n "$BIG" ]; then
  warn "tracked files over 50 MB - consider Git LFS or moving them out of git:"
  printf '%s\n' "$BIG" | sed 's/^/      /'
else
  ok "no tracked file over 50 MB"
fi

# --------------------------------------------------------- 9. secrets check
LEAK="$(git ls-files 2>/dev/null | grep -iE '\.(pem|key)$|credential|secret|\.env$|token' | head -10)"
if [ -n "$LEAK" ]; then
  warn "files that look like secrets are TRACKED by git - remove them:"
  printf '%s\n' "$LEAK" | sed 's/^/      /'
  printf '      git rm --cached <file>   then commit\n'
else
  ok "no obvious secret files tracked"
fi

# ------------------------------------------------------------- 10. watcher
printf '\n'
bash "$HERE/watch.sh" --status 2>/dev/null | sed 's/^/   /' || true

# --------------------------------------------------------------- 11. gate
printf '\n'
if [ -f code/check_all.sh ]; then
  if bash code/check_all.sh >/dev/null 2>&1; then ok "the repo gate passes"
  else err "the repo gate FAILS - run: bash code/check_all.sh"; ISSUES=$((ISSUES+1)); fi
else
  warn "code/check_all.sh not found"
fi

printf '\n'
if [ "$ISSUES" -eq 0 ]; then
  ok "everything looks healthy."
else
  warn "$ISSUES item(s) need attention.$([ "$FIX" = "1" ] || echo ' Re-run with --fix to repair the safe ones.')"
fi
[ "$ISSUES" -eq 0 ] && exit 0 || exit 1
