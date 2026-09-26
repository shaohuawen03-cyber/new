#!/usr/bin/env bash
# watch.sh - Linux twin of watch.ps1 : the LOCAL WATCHER.
#
# This is what "connected to the machine" actually means. The agent asks for a
# check (agent-check.sh --request) by setting arena_state=awaiting_check in
# results/status/handshake.json and pushing. This watcher notices it, syncs,
# runs check_cmd, writes results/status/check_rN_<stamp>.txt, records the
# verdict in the handshake and pushes it back. The agent then reads it.
#
# It is deliberately a REAL local process (systemd user timer, or cron, or a
# live loop) - not a sandbox stand-in. The skill forbids faking the local side.
#
# Usage:
#   bash watch.sh --once                  one poll round, then exit (good for testing)
#   bash watch.sh --loop [--interval 120] run in the foreground forever
#   bash watch.sh --register              install a systemd --user timer (or cron)
#   bash watch.sh --unregister            remove it
#   bash watch.sh --status                show the registration + last handshake
#   bash watch.sh --focus                 run one round now, ignoring the timer
#
# Exit: 0 ok, 1 guard/config error, 5 lock held (another poll is running).

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

ACTION="loop"; INTERVAL=120
while [ $# -gt 0 ]; do
  case "$1" in
    --once)     ACTION="once"; shift ;;
    --loop)     ACTION="loop"; shift ;;
    --register) ACTION="register"; shift ;;
    --unregister) ACTION="unregister"; shift ;;
    --status)   ACTION="status"; shift ;;
    --focus)    ACTION="focus"; shift ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --config)   CONFIG_OVERRIDE="$2"; shift 2 ;;
    -h|--help)  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" 2 ;;
  esac
done
CONFIG_OVERRIDE="${CONFIG_OVERRIDE:-}"

REPO="$(repo_root)" || die "not inside a git repository"
cd "$REPO" || die "cannot enter $REPO"

CFG="$(resolve_config "$CONFIG_OVERRIDE")"
BRANCH="$(cfg_get "$CFG" branch)"; [ -z "$BRANCH" ] && BRANCH="$(current_branch)"
REMOTE="$(cfg_get "$CFG" remote origin)"; [ -z "$REMOTE" ] && REMOTE="origin"
HANDSHAKE_REL="$(cfg_get "$CFG" handshake results/status/handshake.json)"
[ -z "$HANDSHAKE_REL" ] && HANDSHAKE_REL="results/status/handshake.json"
HANDSHAKE_REL="${HANDSHAKE_REL//\\//}"
CHECK_TIMEOUT_MIN="$(cfg_get "$CFG" check_timeout_min 30)"
LOCK_STALE_MIN="$(cfg_get "$CFG" lock_stale_min 45)"
HANDS_FREE="$(cfg_get "$CFG" hands_free true)"
AUTO_PULL="$(cfg_get "$CFG" auto_pull true)"
AUTO_PUSH="$(cfg_get "$CFG" auto_push true)"
AUTO_PUSH_PREFIX="$(cfg_get "$CFG" auto_push_prefix 'local: auto')"
SUCCESS_CRIT="$(cfg_get "$CFG" success_criteria results/status/success_criteria.json)"

guard_branch "$BRANCH"
ORIGIN="$REMOTE/$BRANCH"
TASK="git-sync-watch-$(basename "$REPO")"
LOCK="$REPO/.git-sync-watch.lock"
PIDFILE="$REPO/.git-sync-watch.pid"
LOGDIR="$REPO/.git-sync-watch-logs"

# The check command: the config ships a PowerShell one for Windows. On a
# machine with no PowerShell we transparently use the Linux twin.
CHECK_CMD="$(cfg_get "$CFG" check_cmd '')"
if [ -z "$CHECK_CMD" ]; then
  CHECK_CMD="bash code/local_check.sh"
elif printf '%s' "$CHECK_CMD" | grep -qi 'powershell\|\.ps1' && ! have powershell && ! have pwsh; then
  warn "check_cmd is a PowerShell command but no PowerShell is installed -"
  warn "using the Linux twin: bash code/local_check.sh"
  CHECK_CMD="bash code/local_check.sh"
fi

mkdir -p "$(dirname "$HANDSHAKE_REL")" "$LOGDIR"

# ------------------------------------------------------------------ output
say()  { printf '[watch %s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

# ------------------------------------------------------------------- lock
# The lock is per-POLL-ROUND, not per-process: poll_once acquires it and
# releases it before returning, so a long-lived --loop can serve round after
# round. (An earlier version only released it from the EXIT trap, which in
# loop mode never fires - the watcher then served exactly one round and
# reported "another poll holds the lock" forever after.)
# A stale lock (older than lock_stale_min) is broken automatically, so a
# crashed poll can never wedge the loop forever.
lock_acquire() {
  if [ -f "$LOCK" ]; then
    local age=$(( ( $(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || date +%s) ) / 60 ))
    if [ "$age" -lt "$LOCK_STALE_MIN" ]; then
      say "another poll holds the lock (age ${age}m < ${LOCK_STALE_MIN}m) - exit 5"
      return 1
    fi
    say "breaking a stale lock (age ${age}m)"
    rm -f "$LOCK"
  fi
  printf '%s\n' "$$" > "$LOCK"
  return 0
}
lock_release() { rm -f "$LOCK"; }
trap 'lock_release' EXIT

# --------------------------------------------------------------- handshake
hs_read_origin() { git show "$ORIGIN:$HANDSHAKE_REL" 2>/dev/null || true; }
hs_field() { printf '%s' "$1" | python3 -c 'import json,sys
try: print(json.loads(sys.stdin.buffer.read().decode("utf-8-sig")).get(sys.argv[1],""))
except Exception: print("")' "$2" 2>/dev/null; }

hs_write_verdict() {  # $1 round  $2 verdict  $3 host
  python3 - "$HANDSHAKE_REL" "$1" "$2" "$3" <<'PY'
import json, sys, datetime
path, rnd, verdict, host = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
try:
    d = json.load(open(path, encoding='utf-8-sig'))
except Exception:
    d = {}
d.update({
    'local_state': verdict,
    'local_updated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    'host': host,
})
with open(path, 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY
}

# ------------------------------------------------------------ one poll round
poll_once() {
  lock_acquire || return 5

  git_silent config "remote.$REMOTE.fetch" "+refs/heads/*:refs/remotes/$REMOTE/*" 2>/dev/null || true
  if ! git_silent fetch "$REMOTE" --quiet; then
    say "fetch failed (network?) - will retry next round"
    lock_release
    return 0
  fi

  # Read the request from the REMOTE tip: that is where the agent publishes it.
  HS="$(hs_read_origin)"
  if [ -z "$HS" ]; then
    say "no handshake on $ORIGIN yet - nothing to do"
    lock_release
    return 0
  fi
  ASTATE="$(hs_field "$HS" arena_state)"
  LSTATE="$(hs_field "$HS" local_state)"
  ROUND="$(hs_field "$HS" round)"

  if [ "$ASTATE" != "awaiting_check" ] || [ "$LSTATE" != "pending" ]; then
    say "handshake round ${ROUND}: arena=$ASTATE local=$LSTATE - idle"
    lock_release
    return 0
  fi

  say "== round $ROUND: the agent asked for a check - starting"

  # Bring the worktree to the remote tip so we check exactly what the agent
  # pushed (worktree is preserved; phantom deletions are restored).
  if ! git merge-base --is-ancestor "$ORIGIN" HEAD 2>/dev/null; then
    say "aligning HEAD with $ORIGIN"
    git reset --mixed "$ORIGIN" 2>/dev/null || { say "cannot align - skip"; lock_release; return 0; }
    git ls-files -d 2>/dev/null | xargs -r git checkout -- 2>/dev/null || true
  fi

  # auto_pull: keep the branch current before checking
  if [ "$AUTO_PULL" = "true" ]; then
    git_silent pull --ff-only "$REMOTE" "$BRANCH" --quiet 2>/dev/null \
      && say "auto_pull: branch is current" \
      || say "auto_pull: pull --ff-only failed (diverged?) - continuing with what we have"
  fi

  # ---- run the check, with a hard timeout (check_timeout_min) -------------
  STAMP="$(date '+%Y%m%d-%H%M%S')"
  LOG="$(dirname "$HANDSHAKE_REL")/check_r${ROUND}_${STAMP}.txt"
  mkdir -p "$(dirname "$LOG")"
  {
    printf 'check round %s on %s\n' "$ROUND" "$(hostname_short)"
    printf 'cmd: %s\n' "$CHECK_CMD"
    printf 'started: %s\n' "$(stamp)"
    printf '\n'
  } > "$LOG"

  say "running: $CHECK_CMD  (timeout ${CHECK_TIMEOUT_MIN}m)"
  T0=$(date +%s)
  if have timeout; then
    timeout "$((CHECK_TIMEOUT_MIN * 60))" bash -c "$CHECK_CMD" >> "$LOG" 2>&1
    RC=$?
  else
    bash -c "$CHECK_CMD" >> "$LOG" 2>&1
    RC=$?
  fi
  ELAPSED=$(( $(date +%s) - T0 ))

  VERDICT="passed"
  if [ $RC -eq 124 ]; then
    VERDICT="failed"
    { printf '\nTIMEOUT after %s minute(s)\n' "$CHECK_TIMEOUT_MIN"; } >> "$LOG"
  elif [ $RC -ne 0 ]; then
    VERDICT="failed"
  fi
  {
    printf '\n'
    printf 'elapsed: %ss\n' "$ELAPSED"
    printf 'verdict: %s (exit %s)\n' "$VERDICT" "$RC"
    printf 'finished: %s\n' "$(stamp)"
  } >> "$LOG"
  say "verdict: $VERDICT (exit $RC, ${ELAPSED}s) - log: $LOG"

  # ---- record the verdict in the handshake --------------------------------
  # Seed from the REMOTE copy first: our worktree copy can be stale, and
  # writing on top of it would clobber fields the agent set.
  HS_NOW="$(hs_read_origin)"
  [ -z "$HS_NOW" ] && HS_NOW="$HS"
  printf '%s\n' "$HS_NOW" > "$HANDSHAKE_REL"
  hs_write_verdict "$ROUND" "$VERDICT" "$(hostname_short)"

  # ---- push the verdict back ---------------------------------------------
  if [ "$AUTO_PUSH" = "true" ]; then
    # Never let the auto-push sweep in something it should not.
    git add -A -- "$HANDSHAKE_REL" "$(dirname "$HANDSHAKE_REL")" 2>/dev/null || git add -A
    if git diff --cached --quiet 2>/dev/null; then
      say "auto_push: nothing to push"
    else
      MSG="$AUTO_PUSH_PREFIX: check round $ROUND $VERDICT on $(hostname_short)"
      if git -c user.name="$(hostname_short)" \
             -c user.email="local@$(hostname_short)" \
             commit -q -m "$MSG" 2>/dev/null \
         && git_silent push "$REMOTE" "$BRANCH" --quiet 2>/dev/null; then
        say "auto_push: pushed the verdict"
      else
        say "auto_push: commit/push failed - the agent will still read the local log"
      fi
    fi
  fi

  say "== round $ROUND done ($VERDICT)"
  lock_release          # per-round release; the EXIT trap is only a safety net
  return 0
}

# ------------------------------------------------------------- registration
systemd_available() {
  have systemctl && systemctl --user status >/dev/null 2>&1
}

register() {
  UNIT_DIR="$HOME/.config/systemd/user"
  if systemd_available; then
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT_DIR/$TASK.service" <<EOS
[Unit]
Description=git-sync local watcher for $(basename "$REPO")
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$REPO
ExecStart=$(command -v bash) $HERE/watch.sh --once
EOS
    cat > "$UNIT_DIR/$TASK.timer" <<EOT
[Unit]
Description=poll the git-sync handshake every ${INTERVAL}s

[Timer]
OnBootSec=1min
OnUnitActiveSec=${INTERVAL}s
AccuracySec=10s

[Install]
WantedBy=timers.target
EOT
    systemctl --user daemon-reload
    systemctl --user enable --now "$TASK.timer" 2>/dev/null \
      && { ok "registered systemd user timer: $TASK.timer (every ${INTERVAL}s)"; return 0; } \
      || { warn "could not enable the systemd timer - falling back to cron"; }
  fi
  if have crontab; then
    ( crontab -l 2>/dev/null | grep -v "watch.sh --once.*$(basename "$REPO")" ; \
      echo "*/$((INTERVAL/60<1?1:INTERVAL/60)) * * * * cd $REPO && $(command -v bash) $HERE/watch.sh --once >> $LOGDIR/cron.log 2>&1" ) | crontab -
    ok "registered a cron entry (every $((INTERVAL/60<1?1:INTERVAL/60)) minute(s))"
    return 0
  fi
  # Third fallback: a detached long-lived loop process. Not as robust as a
  # timer (it dies with the session unless nohup/disown is used), but it is a
  # REAL local process, which is what "connected" requires.
  mkdir -p "$LOGDIR"
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup bash "$HERE/watch.sh" --loop --interval "$INTERVAL" \
        >> "$LOGDIR/loop.log" 2>&1 < /dev/null &
  else
    nohup bash "$HERE/watch.sh" --loop --interval "$INTERVAL" \
        >> "$LOGDIR/loop.log" 2>&1 < /dev/null &
  fi
  disown 2>/dev/null || true
  sleep 2
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
    ok "started a detached watcher loop (pid $(cat "$PIDFILE"), every ${INTERVAL}s)"
    ok "logs: $LOGDIR/loop.log   stop with: kill $(cat "$PIDFILE")"
    return 0
  fi
  err "could not start the watcher loop - see $LOGDIR/loop.log"
  return 1
}

unregister() {
  local did=0
  if systemd_available && systemctl --user list-unit-files 2>/dev/null | grep -q "$TASK"; then
    systemctl --user disable --now "$TASK.timer" 2>/dev/null
    rm -f "$HOME/.config/systemd/user/$TASK.service" "$HOME/.config/systemd/user/$TASK.timer"
    systemctl --user daemon-reload 2>/dev/null
    ok "removed systemd user timer $TASK.timer"; did=1
  fi
  if have crontab && crontab -l 2>/dev/null | grep -q "watch.sh --once"; then
    crontab -l 2>/dev/null | grep -v "watch.sh --once" | crontab -
    ok "removed the cron entry"; did=1
  fi
  [ "$did" = "0" ] && warn "nothing was registered"
  return 0
}

status() {
  head1 "watcher status for $REPO"
  info "task name : $TASK"
  info "check cmd : $CHECK_CMD"
  info "interval  : ${INTERVAL}s"
  if systemd_available && systemctl --user list-unit-files 2>/dev/null | grep -q "$TASK"; then
    ok "registered: systemd user timer"
    systemctl --user list-timers --all 2>/dev/null | grep "$TASK" | sed 's/^/   /' || true
  elif have crontab && crontab -l 2>/dev/null | grep -q "watch.sh --once"; then
    ok "registered: cron"
    crontab -l 2>/dev/null | grep "watch.sh --once" | sed 's/^/   /'
  elif [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
    ok "registered: detached loop process (pid $(cat "$PIDFILE"))"
  else
    warn "NOT registered - run: bash watch.sh --register"
  fi
  if [ -f "$HANDSHAKE_REL" ]; then
    info "handshake ($HANDSHAKE_REL):"
    sed 's/^/   /' "$HANDSHAKE_REL"
  else
    warn "no handshake file yet"
  fi
  if [ -f "$LOCK" ]; then
    warn "a lock file exists: $LOCK (age $(( ( $(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || date +%s) ) / 60 ))m)"
  fi
}

# -------------------------------------------------------------------- main
case "$ACTION" in
  register)   register ;;
  unregister) unregister ;;
  status)     status ;;
  focus|once)
    poll_once
    RC=$?
    say "poll round finished (exit $RC)"
    exit $RC
    ;;
  loop)
    printf '%s\n' "$$" > "$PIDFILE"
    say "watcher loop started (pid $$, interval ${INTERVAL}s) - Ctrl-C to stop"
    trap 'say "watcher loop stopped"; rm -f "$PIDFILE"; exit 0' INT TERM
    while true; do
      poll_once || true
      sleep "$INTERVAL"
    done
    ;;
esac
