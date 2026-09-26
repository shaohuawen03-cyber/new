#!/usr/bin/env bash
# upload.sh - Linux equivalent of upload.ps1
#
# ONE command: copy files from a local folder into the repo (destination by
# extension, from upload_map in sync.config.json), then commit + push them.
#
# Usage:  bash upload.sh [--src DIR] [--message MSG] [--ext .csv,.xlsx]
#                         [--dest FOLDER] [--config PATH]
# Exit :  0 ok, 1 nothing copied / push refused, 4 no credentials

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

SRC=""; MESSAGE=""; EXT=""; DEST=""; CONFIG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --src)     SRC="$2"; shift 2 ;;
    --message) MESSAGE="$2"; shift 2 ;;
    --ext)     EXT="$2"; shift 2 ;;
    --dest)    DEST="$2"; shift 2 ;;
    --config)  CONFIG="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1 (use --src/--message/--ext/--dest)" 2 ;;
  esac
done

REPO="$(repo_root)" || die "not inside a git repository"
cd "$REPO" || die "cannot enter $REPO"
PARENT="$(dirname "$REPO")"

CFG="$(resolve_config "$CONFIG")"

# ---------------------------------------------------------------- upload_map
if [ -n "$CFG" ]; then
  MAP_JSON="$(cfg_get "$CFG" upload_map '{}')"
else
  MAP_JSON='{}'
  warn "sync.config.json not found - using the built-in extension map"
fi

# ---------------------------------------------------------------- find source
if [ -z "$SRC" ]; then
  DOC_EXT='.docx .doc .pptx .ppt .pdf .xlsx .csv'
  # first sibling directory (not the repo) that holds a document-like file
  for d in "$PARENT"/*/; do
    [ -d "$d" ] || continue
    [ "$(cd "$d" && pwd)" = "$(cd "$REPO" && pwd)" ] && continue
    if find "$d" -maxdepth 1 -type f \( -iname '*.docx' -o -iname '*.doc' \
         -o -iname '*.pptx' -o -iname '*.ppt' -o -iname '*.pdf' \
         -o -iname '*.xlsx' -o -iname '*.csv' \) | grep -q .; then
      SRC="${d%/}"; break
    fi
  done
fi

if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
  err "cannot locate the attachment folder automatically."
  err "pass it explicitly:   bash upload.sh --src /path/to/your/folder"
  exit 1
fi

# ---------------------------------------------------------------- select files
declare -a FILES=()
if [ -n "$EXT" ]; then
  IFS=',' read -r -a EXT_ARR <<< "$EXT"
  for e in "${EXT_ARR[@]}"; do
    e="${e,,}"; case "$e" in .*) ;; *) e=".$e" ;; esac
    while IFS= read -r f; do FILES+=("$f"); done < <(find "$SRC" -maxdepth 1 -type f -iname "*$e")
  done
else
  while IFS= read -r f; do FILES+=("$f"); done < <(find "$SRC" -maxdepth 1 -type f)
fi

if [ "${#FILES[@]}" -eq 0 ]; then
  err "no matching files in: $SRC"
  exit 1
fi

head1 "upload: $SRC"
info "${#FILES[@]} file(s) found"

# ---------------------------------------------------------------- copy them
COPIED=0; SKIPPED=0
for f in "${FILES[@]}"; do
  base="$(basename "$f")"
  ext="${base##*.}"; ext=".${ext,,}"
  if [ -n "$DEST" ]; then
    TARGET="$DEST"
  else
    TARGET="$(printf '%s' "$MAP_JSON" | python3 -c '
import json, sys
try:
    m = json.load(sys.stdin)
except Exception:
    m = {}
print(m.get(sys.argv[1].lower(), ""))
' "$ext" 2>/dev/null || true)"
  fi
  if [ -z "$TARGET" ]; then
    printf '   skip  %s  (extension %s not mapped - add it to upload_map)\n' "$base" "$ext"
    SKIPPED=$((SKIPPED+1)); continue
  fi
  mkdir -p "$REPO/$TARGET"
  cp -f "$f" "$REPO/$TARGET/$base"
  printf '   add   %s  ->  %s/\n' "$base" "$TARGET"
  COPIED=$((COPIED+1))
done

if [ "$COPIED" -eq 0 ]; then
  err "nothing was copied - check the file extensions."
  exit 1
fi
[ "$SKIPPED" -gt 0 ] && warn "$SKIPPED file(s) skipped (unmapped extension)"

# ---------------------------------------------------------------- and push
[ -z "$MESSAGE" ] && MESSAGE="upload: local documents and data"
info "pushing..."
bash "$HERE/push.sh" "$MESSAGE" ${CONFIG:+--config "$CONFIG"}
exit $?
