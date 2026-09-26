#!/usr/bin/env bash
# download.sh - Linux equivalent of download.ps1
#
# Copy chosen folders FROM the repo TO a local folder, or only the files that
# changed since a date (-Since, uses `git log --since`, so sync first).
#
# Usage:  bash download.sh [--set final] [--folders a,b] [--dest DIR]
#                         [--since DATE] [--mirror] [--list] [--config PATH]
# Exit :  0 ok, 1 bad set / copy error

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

SET="final"; FOLDERS=""; DEST=""; SINCE=""; CONFIG=""; MIRROR=0; LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --set)    SET="$2"; shift 2 ;;
    --folders) FOLDERS="$2"; shift 2 ;;
    --dest)   DEST="$2"; shift 2 ;;
    --since)  SINCE="$2"; shift 2 ;;
    --mirror) MIRROR=1; shift ;;
    --list)   LIST=1; shift ;;
    --config) CONFIG="$2"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1 (use --set/--folders/--dest/--since/--mirror/--list)" 2 ;;
  esac
done

REPO="$(repo_root)" || die "not inside a git repository"
cd "$REPO" || die "cannot enter $REPO"

CFG="$(resolve_config "$CONFIG")"
if [ -z "$CFG" ]; then
  err "sync.config.json not found next to this script or in skills/git-sync/."
  exit 1
fi
info "config: $CFG"

if [ "$LIST" = "1" ]; then
  info "available sets:"
  python3 - "$CFG" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8-sig'))
for k, v in (d.get('download_sets') or {}).items():
    print("   %-10s %s" % (k, ', '.join(v)))
PY
  exit 0
fi

# ---------------------------------------------------------------- folder list
declare -a FOLDERS_ARR=()
if [ -n "$FOLDERS" ]; then
  IFS=',' read -r -a FOLDERS_ARR <<< "$FOLDERS"
  info "folders: ${FOLDERS_ARR[*]}  (ad-hoc, --folders)"
else
  mapfile -t FOLDERS_ARR < <(python3 - "$CFG" "$SET" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8-sig'))
sets = d.get('download_sets') or {}
name = sys.argv[2]
if name not in sets:
    sys.stderr.write("unknown set '%s'. available: %s\n" % (name, ', '.join(sets)))
    sys.exit(1)
for f in sets[name]:
    print(f)
PY
) || { err "unknown set '$SET' - see: bash download.sh --list"; exit 1; }
fi

# ---------------------------------------------------------------- destination
if [ -z "$DEST" ]; then
  DEST="$(cfg_get "$CFG" download_dir)"
  [ -z "$DEST" ] && DEST="$(dirname "$REPO")/$(basename "$REPO")_out"
fi
mkdir -p "$DEST"

head1 "download"
info "set  : $SET  (${#FOLDERS_ARR[@]} folder(s))"
info "dest : $DEST"

# ---------------------------------------------------------------- incremental
if [ -n "$SINCE" ]; then
  info "since: $SINCE  (incremental - only files git logged as changed)"
  warn "run bash sync.sh first, or the list reflects the old branch"
  N=0
  for rel in "${FOLDERS_ARR[@]}"; do
    [ -e "$REPO/$rel" ] || { printf '   none  %s  (not in the repo)\n' "$rel"; continue; }
    mapfile -t CHANGED < <(git -c core.quotepath=false log "--since=$SINCE" \
                              --name-only --pretty=format: -- "$rel" 2>/dev/null | sort -u)
    [ "${#CHANGED[@]}" -eq 0 ] && { printf '   none  %s  (nothing changed since %s)\n' "$rel" "$SINCE"; continue; }
    for f in "${CHANGED[@]}"; do
      [ -n "$f" ] || continue
      [ -f "$REPO/$f" ] || continue
      mkdir -p "$DEST/$(dirname "$f")"
      cp -f "$REPO/$f" "$DEST/$f"
      printf '   copy  %s\n' "$f"
      N=$((N+1))
    done
  done
  echo
  [ "$N" -eq 0 ] && ok "nothing changed since $SINCE - no files copied." \
                  || ok "done: $N file(s) copied."
  info "latest commit: $(git log -1 --oneline 2>/dev/null)"
  exit 0
fi

# ---------------------------------------------------------------- full mirror
FAIL=0
for rel in "${FOLDERS_ARR[@]}"; do
  src="$REPO/$rel"
  if [ ! -e "$src" ]; then
    printf '   skip  %s  (not in the repo)\n' "$rel"; continue
  fi
  dst="$DEST/$rel"
  mkdir -p "$dst"
  printf '   copy  %s  ->  %s\n' "$rel" "$DEST"
  if have rsync; then
    if [ "$MIRROR" = "1" ]; then
      rsync -a --delete "$src"/ "$dst"/ || FAIL=$((FAIL+1))
    else
      rsync -a "$src"/ "$dst"/ || FAIL=$((FAIL+1))
    fi
  else
    # cp -a is not a mirror: it never deletes, which is the safe default here
    cp -a "$src"/. "$dst"/ 2>/dev/null || FAIL=$((FAIL+1))
  fi
done

echo
if [ "$FAIL" -eq 0 ]; then
  ok "done. latest commit:"
  git log -1 --oneline 2>/dev/null
else
  err "finished with $FAIL error(s)"
  exit 1
fi
exit 0
