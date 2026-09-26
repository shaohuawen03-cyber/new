#!/usr/bin/env bash
# local_check.sh - Linux twin of local_check.ps1
#
# This repo's checks, executed ON THE REAL MACHINE when the agent requests one.
# watch.sh runs this whenever the agent requests a check (config key check_cmd),
# captures all output to results/status/check_rN_<stamp>.txt and pushes the
# verdict back.
#
# Exit 0 = passed, anything else = failed. Edit freely - this file belongs to
# the repo. Add repo-specific checks at the bottom (section 4).
#
# What it proves, and why each item matters:
#   1  the standard gate still passes
#   2a silent push REALLY works here (ls-remote + push --dry-run, prompts off)
#   2b the watcher is really registered (systemd timer or cron) - not a claim
#   2c every watcher exit path prints a closing line (no silent hangs)
#   2d hands-free auto_pull/auto_push are present in watch.sh
#   3  success_criteria.json (files / substrings / sizes / regex / forbidden)

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

REPO="$(repo_root)" || die "not inside a git repository"
cd "$REPO" || die "cannot enter $REPO"

CFG="$(resolve_config "")"
BRANCH="$(cfg_get "$CFG" branch)"; [ -z "$BRANCH" ] && BRANCH="$(current_branch)"
REMOTE="$(cfg_get "$CFG" remote origin)"; [ -z "$REMOTE" ] && REMOTE="origin"
if [ -z "$BRANCH" ]; then
  printf '   FAIL cannot determine the working branch (config has no "branch" and HEAD is detached)\n'
  printf '== local checks FAILED\n'
  exit 1
fi

FAIL=0
note_ok()   { printf '   OK   %s\n' "$*"; }
note_fail() { printf '   FAIL %s\n' "$*"; FAIL=1; }
note_warn() { printf '   WARN %s\n' "$*"; }
note_info() { printf '   --   %s\n' "$*"; }

printf 'check on %s - %s\n' "$(hostname_short)" "$(stamp)"
printf 'repo  : %s\n' "$REPO"
printf 'branch: %s   remote: %s\n' "$BRANCH" "$REMOTE"
printf '\n'

# ---------------------------------------------------------------- 1. gate
printf '== 1. standard gate\n'
if [ -f code/check_all.sh ]; then
  GATE_OUT="$(bash code/check_all.sh 2>&1)"; GATE_RC=$?
  [ -n "$GATE_OUT" ] && printf '%s\n' "$GATE_OUT" | sed 's/^/   /'
  if [ "$GATE_RC" -eq 0 ]; then
    note_ok "gate passed"
  else
    note_fail "gate failed (exit $GATE_RC)"
  fi
else
  note_warn "code/check_all.sh not found - the gate was skipped here (it still runs before every agent push)"
fi

# ------------------------------------------------------- 2a. silent push
printf '\n== 2a. silent push (proven on this machine, prompts disabled)\n'
# GIT_TERMINAL_PROMPT=0 + credential.interactive=false => git must either
# succeed silently or fail; it can never open a window and block.
export GIT_TERMINAL_PROMPT=0
LS_ERR="$(git -c credential.interactive=false ls-remote "$REMOTE" 2>&1)"; LS_RC=$?
if [ $LS_RC -eq 0 ]; then
  note_ok "ls-remote: the credential authenticates without any prompt"
else
  printf '%s\n' "$LS_ERR" | sed 's/^/      /'
  note_fail "ls-remote failed - git could not authenticate silently"
fi

DRY_ERR="$(git -c credential.interactive=false push --dry-run "$REMOTE" "$BRANCH" 2>&1)"; DRY_RC=$?
if [ $DRY_RC -eq 0 ]; then
  note_ok "push --dry-run accepted (fast-forward) - a real push needs no click"
elif printf '%s' "$DRY_ERR" | grep -qi 'non-fast-forward\|fetch first\|rejected'; then
  note_ok "push --dry-run was only REJECTED (not a fast-forward) - the server already accepted the token"
  note_info "run: bash sync.sh   so the next real push is a fast-forward"
else
  printf '%s\n' "$DRY_ERR" | sed 's/^/      /'
  note_fail "push --dry-run failed - silent push is NOT proven"
fi

# ------------------------------------------------- 2a2. per-clone account
printf '\n== 2a2. which account does this clone push with?\n'
PIN_USER="$(git config --local credential.https://github.com.username 2>/dev/null || true)"
if [ -z "$PIN_USER" ]; then
  # gacc may pin via url.<base>.insteadOf instead
  PIN_USER="$(git config --local --get-regexp '^url\..*\.insteadof$' 2>/dev/null \
              | sed -n 's#.*https://\([^@]*\)@github.*#\1#p' | head -1)"
fi
if [ -n "$PIN_USER" ]; then
  note_ok "this clone is PINNED to account '$PIN_USER' (other clones are unaffected)"
else
  note_info "no per-clone pin - the machine default account is used"
  note_info "a push answering 403 \"Permission to ... denied to OTHER-USER\" is a PERMISSIONS problem,"
  note_info "not a broken credential. Pin this clone:  bash tools/gacc use <login>"
fi

# ---------------------------------------------------- 2b. watcher registered
printf '\n== 2b. is the watcher really registered? (this is what "connected to the machine" means)\n'
TASK="git-sync-watch-$(basename "$REPO")"
WATCHER_OK=0
if have systemctl && systemctl --user list-timers --all 2>/dev/null | grep -q "$TASK"; then
  note_ok "systemd user timer '$TASK' is active"
  systemctl --user list-timers --all 2>/dev/null | grep "$TASK" | sed 's/^/      /'
  WATCHER_OK=1
elif have crontab && crontab -l 2>/dev/null | grep -q "watch.sh"; then
  note_ok "cron entry for watch.sh is installed"
  crontab -l 2>/dev/null | grep "watch.sh" | sed 's/^/      /'
  WATCHER_OK=1
elif [ -f "$REPO/.git-sync-watch.pid" ] && kill -0 "$(cat "$REPO/.git-sync-watch.pid" 2>/dev/null)" 2>/dev/null; then
  note_ok "watch.sh is running as a live loop process (pid $(cat "$REPO/.git-sync-watch.pid"))"
  WATCHER_OK=1
fi
if [ "$WATCHER_OK" = "0" ]; then
  note_fail "no watcher is registered for this repo"
  note_info "register one:  bash skills/git-sync/scripts/local/watch.sh --register"
  note_info "(or run it in the foreground once:  bash .../watch.sh --once)"
fi

# ------------------------------------------- 2c. watcher closing lines
printf '\n== 2c. every watcher exit path prints a closing line\n'
WATCH_SH="$HERE/watch.sh"
if [ -f "$WATCH_SH" ]; then
  # every `exit` inside a function must be preceded (in the same block) by a
  # summary print; a silent exit looks exactly like a hung machine.
  MISSING=0
  while IFS= read -r ln; do
    n="${ln%%:*}"
    ctx="$(sed -n "$((n>6?n-6:1)),${n}p" "$WATCH_SH")"
    printf '%s' "$ctx" | grep -q 'say\|note_ok\|note_fail\|note_warn\|note_info\|printf' || {
      printf '      exit at line %s has no closing summary before it\n' "$n"; MISSING=$((MISSING+1)); }
  done < <(grep -n '^[[:space:]]*exit ' "$WATCH_SH")
  if [ "$MISSING" -eq 0 ]; then
    note_ok "every exit path sets its closing summary"
  else
    note_fail "$MISSING exit path(s) without a closing summary"
  fi
else
  note_warn "watch.sh not found - skipped"
fi

# --------------------------------------------- 2d. hands-free helpers
printf '\n== 2d. hands-free auto_pull / auto_push present in watch.sh\n'
if [ -f "$WATCH_SH" ]; then
  if grep -q 'auto_pull' "$WATCH_SH" && grep -q 'auto_push' "$WATCH_SH"; then
    note_ok "hands-free helpers present"
  else
    note_fail "watch.sh is missing auto_pull / auto_push"
  fi
else
  note_fail "watch.sh missing"
fi

# ------------------------------------------------ 3. success criteria
printf '\n== 3. success criteria\n'
CRIT_REL="$(cfg_get "$CFG" success_criteria results/status/success_criteria.json)"
[ -z "$CRIT_REL" ] && CRIT_REL="results/status/success_criteria.json"
if [ -f "$CRIT_REL" ]; then
  printf '   criteria: %s\n' "$CRIT_REL"
  python3 - "$CRIT_REL" <<'PY'
import json, os, re, sys
path = sys.argv[1]
fail = 0
try:
    c = json.load(open(path, encoding='utf-8-sig'))
except Exception as e:
    print("   FAIL criteria parse: %s" % e); sys.exit(1)
if c.get('description'):
    print("   " + c["description"])

def size(f):
    try: return os.path.getsize(f)
    except Exception: return -1

for f in c.get('require_files') or []:
    if not f: continue
    if os.path.exists(f):
        print("   OK   exists: %s (%d B)" % (f, size(f)))
    else:
        print("   FAIL MISSING file: %s" % f); fail = 1
for f in c.get('forbid_files') or []:
    if not f: continue
    if os.path.exists(f):
        print("   FAIL FORBIDDEN still present: %s" % f); fail = 1
    else:
        print("   OK   absent: %s" % f)
for f, sub in (c.get('require_contains') or {}).items():
    if not os.path.exists(f):
        print("   FAIL MISSING for contains: %s" % f); fail = 1; continue
    txt = open(f, encoding='utf-8-sig', errors='replace').read()
    if sub in txt: print("   OK   contains %s <- %s" % (f, sub))
    else: print("   FAIL DOES NOT contain in %s: %s" % (f, sub)); fail = 1
for f, rx in (c.get('require_regex') or {}).items():
    if not os.path.exists(f):
        print("   FAIL MISSING for regex: %s" % f); fail = 1; continue
    txt = open(f, encoding='utf-8-sig', errors='replace').read()
    if re.search(rx, txt): print("   OK   regex %s" % f)
    else: print("   FAIL regex in %s: %s" % (f, rx)); fail = 1
for f, need in (c.get('min_bytes') or {}).items():
    if not os.path.exists(f):
        print("   FAIL MISSING for min_bytes: %s" % f); fail = 1; continue
    s = size(f)
    if s >= int(need): print("   OK   size %s: %d >= %s" % (f, s, need))
    else: print("   FAIL TOO SMALL %s: %d < %s" % (f, s, need)); fail = 1
for f, need in (c.get('max_bytes') or {}).items():
    if not os.path.exists(f):
        print("   FAIL MISSING for max_bytes: %s" % f); fail = 1; continue
    s = size(f)
    if s <= int(need): print("   OK   size %s: %d <= %s" % (f, s, need))
    else: print("   FAIL TOO BIG %s: %d > %s" % (f, s, need)); fail = 1
sys.exit(fail)
PY
  CRIT_RC=$?
  [ "$CRIT_RC" -ne 0 ] && FAIL=1
else
  printf '   (none at %s - skipped)\n' "$CRIT_REL"
fi

# ------------------------------------------------- 4. repo-specific checks
# Add your own here. Example:
#   [ -s deliverable/final.pptx ] || { note_fail "deliverable/final.pptx missing or empty"; }

printf '\n'
if [ "$FAIL" -eq 0 ]; then
  printf '== local checks passed\n'
else
  printf '== local checks FAILED\n'
fi
exit "$FAIL"
