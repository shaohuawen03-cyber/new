#!/usr/bin/env bash
# hardware.sh - Linux twin of hardware.ps1
#
# Writes results/hardware/latest.md + latest.json (+ history/<stamp>.md) using
# EXACTLY the same JSON schema as hardware.ps1, so the assistant side
# (agent-hardware.sh) reads it without any change.
#
# Usage:  bash hardware.sh [--deep] [--config PATH]
#   --deep also probes conda envs for a CUDA-capable torch (slower)
#
# Exit: 0 ok, 1 not in a repo / write error

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

DEEP=0; CONFIG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --deep)   DEEP=1; shift ;;
    --config) CONFIG="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" 2 ;;
  esac
done

REPO="$(repo_root)" || die "not inside a git repository"
cd "$REPO" || die "cannot enter $REPO"
CFG="$(resolve_config "$CONFIG")"
HW_DIR="$(cfg_get "$CFG" hardware_dir results/hardware)"
[ -z "$HW_DIR" ] && HW_DIR="results/hardware"
mkdir -p "$HW_DIR/history"

DEEP_FLAG="$DEEP" python3 - "$HW_DIR" <<'PY'
import json, os, platform, re, shutil, subprocess, sys, datetime

hw_dir, deep = sys.argv[1], os.environ.get("DEEP_FLAG") == "1"

def sh(cmd):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=20)
        return (r.stdout or "").strip()
    except Exception:
        return ""

def first_line(s):
    return s.splitlines()[0].strip() if s else ""

# ---- os
caption = ""
try:
    d = {}
    for line in open("/etc/os-release", encoding="utf-8", errors="replace"):
        if "=" in line:
            k, v = line.strip().split("=", 1)
            d[k] = v.strip('"')
    caption = (d.get("PRETTY_NAME") or d.get("NAME") or platform.platform())
except Exception:
    caption = platform.platform()

# ---- cpu
cpu_name, cores, threads, mhz = "", 0, 0, 0
try:
    for line in open("/proc/cpuinfo", encoding="utf-8", errors="replace"):
        if cpu_name == "" and line.lower().startswith("model name"):
            cpu_name = line.split(":", 1)[1].strip()
        if line.lower().startswith("cpu mhz") and mhz == 0:
            try: mhz = int(float(line.split(":", 1)[1].strip()))
            except Exception: pass
    threads = os.cpu_count() or 0
    cores = threads
    phys = sh("lscpu | grep '^Core(s) per socket' | awk '{print $NF}'")
    socks = sh("lscpu | grep '^Socket(s)' | awk '{print $NF}'")
    if phys and socks:
        try: cores = int(phys) * int(socks)
        except Exception: pass
except Exception:
    pass

# ---- ram
ram_total, ram_free = 0.0, 0.0
try:
    for line in open("/proc/meminfo", encoding="utf-8", errors="replace"):
        if line.startswith("MemTotal:"):
            ram_total = round(int(line.split()[1]) / 1024 / 1024, 1)
        elif line.startswith("MemAvailable:"):
            ram_free = round(int(line.split()[1]) / 1024 / 1024, 1)
except Exception:
    pass

# ---- gpus
gpus = []
smi = sh("nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader")
if smi:
    for line in smi.splitlines():
        p = [x.strip() for x in line.split(",")]
        if len(p) >= 3:
            try: vram = round(float(re.sub(r"[^0-9.]", "", p[2])) / 1024, 1)
            except Exception: vram = 0
            gpus.append({"name": p[0], "driver": p[1], "vram_gb": vram})
else:
    lspci = sh("lspci 2>/dev/null | grep -iE 'vga|3d|display'")
    for line in lspci.splitlines():
        name = line.split(":", 2)[-1].strip()
        if name:
            gpus.append({"name": name, "driver": "", "vram_gb": 0})
if not gpus:
    gpus = [{"name": "(no GPU detected)", "driver": "", "vram_gb": 0}]

# ---- disks
disks = []
try:
    df = sh("df -P -k -x tmpfs -x devtmpfs 2>/dev/null | tail -n +2")
    for line in df.splitlines():
        p = line.split()
        if len(p) >= 6:
            try:
                disks.append({"drive": p[5], "total_gb": round(int(p[1]) / 1024 / 1024),
                              "free_gb": round(int(p[3]) / 1024 / 1024)})
            except Exception:
                pass
except Exception:
    pass

# ---- python / envs
py = sh("python3 --version 2>&1")
global_python = "%s  (%s)" % (py, shutil.which("python3") or "(not found)")

conda = sh("conda --version")
mamba = sh("mamba --version")
micromamba = sh("micromamba --version") or "(not found)"
cuda_home = os.environ.get("CUDA_HOME", "")

envs = []
cur = sh("conda info --envs 2>/dev/null | tail -n +2")
if cur:
    for line in cur.splitlines():
        p = line.split()
        if not p: continue
        name = p[0]
        if name == "*":
            continue
        path = p[-1] if len(p) > 1 else name
        pyv = sh("%s/bin/python --version 2>&1" % path) if os.path.isdir(path) else ""
        envs.append({"name": name, "path": path, "active": False, "python": pyv})
if deep:
    for e in envs:
        p = e["path"]
        if not os.path.isdir(p): continue
        probe = sh("%s/bin/python -c 'import torch;print(torch.__version__, torch.cuda.is_available())' 2>/dev/null" % p)
        if probe:
            e["torch"] = probe

report = {
    "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "host": sh("hostname") or platform.node(),
    "user": os.environ.get("USER") or sh("whoami"),
    "powershell": "(not applicable - Linux host)",
    "os": {
        "caption": caption,
        "version": platform.release(),
        "build": platform.version(),
        "last_boot": sh("uptime -s") or "",
    },
    "cpu": {"name": cpu_name, "cores": cores, "threads": threads, "mhz": mhz},
    "ram": {"total_gb": ram_total, "free_gb": ram_free},
    "gpus": gpus,
    "disks": disks,
    "python": {
        "global_python": global_python,
        "current_env": os.environ.get("CONDA_DEFAULT_ENV", "(none)"),
        "cuda_home": cuda_home,
        "conda": conda or "(not found)",
        "mamba": mamba or "(not found)",
        "micromamba": micromamba,
        "envs": envs,
    },
    "tools": {
        "git": sh("git --version") or "(not found)",
        "nvidia_smi": bool(shutil.which("nvidia-smi")),
    },
}

js = os.path.join(hw_dir, "latest.json")
with open(js, "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
    f.write("\n")

# ---- markdown twin (what the agent actually reads)
L = []
L.append("# 本机硬件与环境报告")
L.append("")
L.append("- 生成时间：%s" % report["generated"])
L.append("- 主机：%s" % report["host"])
L.append("- 用户：%s" % report["user"])
L.append("")
L.append("## 操作系统")
L.append("")
L.append("- %s" % report["os"]["caption"])
L.append("- kernel %s" % report["os"]["version"])
if report["os"]["last_boot"]:
    L.append("- 上次启动：%s" % report["os"]["last_boot"])
L.append("")
L.append("## CPU / 内存")
L.append("")
L.append("- CPU：%s" % report["cpu"]["name"])
L.append("- 核心/线程：%s / %s" % (report["cpu"]["cores"], report["cpu"]["threads"]))
L.append("- 内存：%s GB 总计，%s GB 可用" % (report["ram"]["total_gb"], report["ram"]["free_gb"]))
L.append("")
L.append("## GPU")
L.append("")
for g in report["gpus"]:
    extra = "（驱动 %s）" % g["driver"] if g["driver"] else ""
    L.append("- %s%s%s" % (g["name"], ("，显存 %s GB" % g["vram_gb"]) if g["vram_gb"] else "", extra))
L.append("")
L.append("## 磁盘")
L.append("")
for d in report["disks"]:
    L.append("- %s：%s GB 总计，%s GB 可用" % (d["drive"], d["total_gb"], d["free_gb"]))
L.append("")
L.append("## Python 与环境")
L.append("")
L.append("- 全局 python：%s" % report["python"]["global_python"])
L.append("- conda：%s" % report["python"]["conda"])
L.append("- 当前环境：%s" % report["python"]["current_env"])
if report["python"]["envs"]:
    L.append("")
    L.append("| 环境 | python |")
    L.append("|---|---|")
    for e in report["python"]["envs"]:
        L.append("| %s | %s |" % (e["name"], e.get("python") or e["path"]))
L.append("")
L.append("## 工具")
L.append("")
L.append("- git：%s" % report["tools"]["git"])
L.append("- nvidia-smi：%s" % ("可用" if report["tools"]["nvidia_smi"] else "不可用"))
L.append("")

md = os.path.join(hw_dir, "latest.md")
with open(md, "w", encoding="utf-8") as f:
    f.write("\n".join(L))

stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
hist = os.path.join(hw_dir, "history")
os.makedirs(hist, exist_ok=True)
with open(os.path.join(hist, stamp + ".md"), "w", encoding="utf-8") as f:
    f.write("\n".join(L))
# keep the newest 30
olds = sorted(os.listdir(hist))
for o in olds[:-30]:
    try: os.remove(os.path.join(hist, o))
    except Exception: pass

print("OK: hardware report written")
print("   %s" % md)
print("   %s" % js)
print("   history/%s.md" % stamp)
PY
RC=$?
[ $RC -ne 0 ] && err "hardware report failed"
exit $RC
