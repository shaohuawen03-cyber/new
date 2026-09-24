# 最近一轮同步回执（agent -> 分支）

- 时间：2026-09-24 01:42 UTC
- 分支：`arena/01a08f54-new`
- 本轮纳入的**本机侧**提交（本机 -> 助手 ✅）：
  - 2a66b79 chore(v0.0.5): remove duplicate root-level extension copy (same id/commands conflict, missing v0.0.2-0.0.4 features, ssh2-in-renderer bug); keep canonical ssh-remote-lite/
  - cf3fa7c update: 优化SSH远程连接与终端逻辑
  - d258ed3 feat(v0.0.4): one-click passwordless login (upload local pubkey via plugin SSH channel); exec support + tests
  - 498b53a feat(v0.0.3): one-click set SSH as default terminal so agent shell commands run on the remote; docs for agent workflow
  - ee0c8e5 feat(v0.0.2): SSH terminal via native system ssh process (guaranteed in Antigravity), auto-open on ssh:// workspace, ship prebuilt vsix
  - 8bee38c chore: ship prebuilt vsix for direct install in Antigravity
  - 6c64e89 Merge remote-tracking branch 'origin/arena/01a08f54-new' into arena/01a08f54-new Co-authored-by: arena-agent <297053741+arena-agent@users.noreply.github.com>
  - 92f1856 feat: auto-open SSH terminal in ssh:// workspaces + register SSH terminal profile (fixes local-terminal confusion in Antigravity)
  - 48e2145 feat: add automated SSH tests (in-process server), refactor core for testability, widen engine compat for Antigravity
  - 16d457a feat: add ssh-remote-lite extension scaffold (ssh:// filesystem + SSH terminal for legacy servers)
- 本轮助手提交：feat: install git-sync skill v2.9.2 (local<->agent sync) into this session branch
- 本轮改动文件：
  ?? 01a0a821.md
  ?? auth.ps1
  ?? bootstrap.ps1
  ?? code/
  ?? doctor.ps1
  ?? download.ps1
  ?? hardware.ps1
  ?? install.ps1
  ?? pack.ps1
  ?? pr.ps1
  ?? push.ps1
  ?? skills/
  ?? sync.ps1
  ?? upload.ps1
  ?? watch.ps1

> 完整历史：`git log --oneline -10`；本机 `.\sync.ps1` 之后即可看到本文件。
