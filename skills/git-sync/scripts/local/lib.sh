#!/usr/bin/env bash
# lib.sh - shared helpers for the LINUX local side of the git-sync skill.
#
# The upstream skill ships PowerShell (.ps1) scripts for the user's machine.
# This file (and the *.sh next to it) is the Linux equivalent: same behaviour,
# same config resolution order, same exit codes - no PowerShell needed.
#
# Sourced by: sync.sh upload.sh download.sh push.sh doctor.sh hardware.sh
#             watch.sh local_check.sh bootstrap.sh
#
# Not meant to be executed directly.

# --------------------------------------------------------------- colours
if [ -t 1 ]; then
  C_R=$'\033[31m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_C=$'\033[36m'
  C_B=$'\033[1m';  C_0=$'\033[0m'
else
  C_R=''; C_G=''; C_Y=''; C_C=''; C_B=''; C_0=''
fi
err()  { printf '%s[ERROR]%s %s\n' "$C_R" "$C_0" "$*" >&2; }
warn() { printf '%s[WARN]%s %s\n'  "$C_Y" "$C_0" "$*" >&2; }
ok()   { printf '%s[OK]%s %s\n'    "$C_G" "$C_0" "$*"; }
info() { printf '%s==%s %s\n'      "$C_C" "$C_0" "$*"; }
head1(){ printf '%s%s%s\n'         "$C_B" "$*" "$C_0"; }

die() { err "$*"; exit "${2:-1}"; }

# --------------------------------------------------------------- repo root
# Walk up from this script until a .git appears, so the scripts also work when
# called straight out of skills/git-sync/scripts/local/
repo_root() {
  local d; d="$(cd "$(dirname "${BASH_SOURCE[1]:-$0}")" && pwd)"
  while [ -n "$d" ]; do
    [ -e "$d/.git" ] && { printf '%s' "$d"; return 0; }
    local up; up="$(dirname "$d")"
    [ "$up" = "$d" ] && break
    d="$up"
  done
  return 1
}

# --------------------------------------------------------------- config
# Resolution order - identical to upload.ps1 / download.ps1:
#   -Config <path>  >  sync.config.<PROFILE>.json  >  skills/git-sync/sync.config.json
#   > next to this script
# PROFILE comes from $GIT_SYNC_PROFILE.
resolve_config() {   # $1 = explicit --config path (may be empty); prints path or nothing
  local explicit="${1:-}"
  if [ -n "$explicit" ]; then
    [ -f "$explicit" ] || die "config not found: $explicit"
    printf '%s' "$explicit"; return 0
  fi
  local here repo
  here="$(cd "$(dirname "${BASH_SOURCE[1]:-$0}")" && pwd)"
  repo="$(repo_root)" || die "not inside a git repository"
  local -a cand=()
  if [ -n "${GIT_SYNC_PROFILE:-}" ]; then
    local prof="sync.config.${GIT_SYNC_PROFILE}.json"
    cand+=("$repo/skills/git-sync/$prof" "$repo/$prof" "$here/$prof")
  fi
  cand+=("$repo/skills/git-sync/sync.config.json" "$here/sync.config.json")
  local c
  for c in "${cand[@]}"; do
    [ -f "$c" ] && { printf '%s' "$c"; return 0; }
  done
  return 0   # empty = not found; callers decide whether that is fatal
}

# cfg_get <file> <key> [default]
cfg_get() {
  local f="$1" k="$2" def="${3:-}"
  [ -f "$f" ] || { printf '%s' "$def"; return 0; }
  python3 - "$f" "$k" "$def" <<'PY' 2>/dev/null || printf '%s' "$def"
import json, sys
path, key, default = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(path, encoding='utf-8-sig') as fh:
        d = json.load(fh)
except Exception:
    sys.exit(1)
v = d.get(key, default)
if v is None:
    v = default
if isinstance(v, bool):
    v = 'true' if v else 'false'
elif isinstance(v, (list, dict)):
    v = json.dumps(v, ensure_ascii=False)
print(v)
PY
}

# cfg_set <file> <key> <json-value>   (creates the file if missing)
cfg_set() {
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
path, key, raw = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    val = json.loads(raw)
except Exception:
    val = raw
try:
    with open(path, encoding='utf-8-sig') as fh:
        d = json.load(fh)
except Exception:
    d = {}
d[key] = val
with open(path, 'w', encoding='utf-8') as fh:
    json.dump(d, fh, ensure_ascii=False, indent=2)
    fh.write('\n')
PY
}

# --------------------------------------------------------------- git helpers
# Refuse to touch main/master - same rule as the .ps1 side.
guard_branch() {
  local b="$1"
  case "$b" in
    main|master) err "pushing straight to $b is not allowed - work on a working branch."; exit 1 ;;
  esac
}

current_branch() { git rev-parse --abbrev-ref HEAD 2>/dev/null || true; }

# Run git with prompts disabled so nothing can ever block on a credential
# window (the .ps1 side calls this "silent mode" and it is the default).
git_silent() {
  GIT_TERMINAL_PROMPT=0 git -c credential.interactive=false "$@"
}

# --------------------------------------------------------------- old-git 兼容
# HPC 机器上 git 往往很老（CentOS/RHEL 7 那代是 1.8.x），下面两个子命令是
# 后来才有的，直接调用会在老 git 上静默失败：
#   git remote get-url   -> Git 2.7+
#   git stash push       -> Git 2.13+（之前写作 git stash save）
# 用下面两个包装，先试新语法、失败再退旧语法，避免把环境差异误报成配置错误。

remote_url() {   # $1 = remote name -> prints the URL (empty if unset)
  git config --get "remote.$1.url" 2>/dev/null || true
}

# git_stash_push <message> -> 0 ok, 1 failed (reason on stderr)
git_stash_push() {
  local msg="${1:-auto-stash}" out rc
  out="$(git stash push --include-untracked -m "$msg" --quiet 2>&1)"; rc=$?
  [ $rc -eq 0 ] && return 0
  # 老 git 没有 "stash push" 这个子命令，退回 save
  out="$(git stash save --include-untracked "$msg" --quiet 2>&1)"; rc=$?
  [ $rc -eq 0 ] && return 0
  printf '%s' "$out" >&2
  return 1
}

# git_ver_num -> major*100+minor（2.39 -> 239；无法识别时为空）
# 必须合成一个可比较的整数：stash push 需要 2.13 也就是 213，
# 只比主版本号会把 2.39 误判成"老 git"。
git_ver_num() {
  git --version 2>/dev/null | sed -nE 's/.* ([0-9]+)\.([0-9]+).*/\1\2/p' | head -1
}

# git_at_least <maj> <min> -> 0 = 版本够新
git_at_least() {
  local want="$(( $1 * 100 + $2 ))" have
  have="$(git_ver_num)"
  [ -z "$have" ] && return 0          # 识别不了就不拦
  [ "$have" -ge "$want" ]
}

# 老 git 打招呼（HPC 上常见 git 1.8/2.x 旧版）
warn_if_old_git() {
  local have; have="$(git_ver_num)"
  [ -z "$have" ] && return 0
  git_at_least 2 13 && return 0
  warn "git $(git --version 2>/dev/null | head -1 | sed 's/git version //') is old:"
  warn "  'stash push' needs 2.13+, 'remote get-url' needs 2.7+ -"
  warn "  the scripts fall back to the older syntax automatically."
}

# --------------------------------------------------------------- misc
have() { command -v "$1" >/dev/null 2>&1; }

# python3 -> python fallback, mirroring the .ps1 probe order
py_exe() {
  if have python3; then printf 'python3'
  elif have python; then printf 'python'
  else printf ''
  fi
}

hostname_short() { hostname 2>/dev/null || printf 'unknown-host'; }
stamp() { date '+%Y-%m-%d %H:%M:%S'; }
