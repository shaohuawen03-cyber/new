# tune_remote_ssh.ps1 - make the OFFICIAL Remote-SSH stable on VS Code 1.85.2
# against an old HPC login node, WITHOUT upgrading anything.
#
#   .\code\tune_remote_ssh.ps1 -Apply      # write the settings + ssh keepalive
#   .\code\tune_remote_ssh.ps1 -Revert     # undo (restores the .srl-bak files)
#   .\code\tune_remote_ssh.ps1 -Apply -WhatIf
#
# What the user's log showed (2026-09-24 17:21):
#   useLocalServer=false  -> legacy path: one ssh -T -D <socks> host bash
#   client_loop: send disconnect: Connection reset   (71s after connect)
#   ECONNREFUSED on the SOCKS port -> endless reconnect loop
# i.e. the single SSH channel that carries a SOCKS tunnel gets RESET by
# something in the path (VPN/campus NAT/IDS), and everything rides on it.
#
# The settings below remove the SOCKS tunnel, put the server on a unix socket,
# keep the channel warm every 15s, and stop lock files from living on the NFS
# home (~/.vscode-server sits on /mnt/hpc/home/... in the log).
# ASCII-only.

param(
    [switch]$Apply,
    [switch]$Revert,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Continue'
function Say([string]$m) { Write-Output $m }
function Ok([string]$m)  { Write-Output "  [ok]   $m" }
function Warn([string]$m){ Write-Output "  [warn] $m" }

if (-not $Apply -and -not $Revert) {
    Say 'usage: .\code\tune_remote_ssh.ps1 -Apply   (or -Revert)'
    exit 2
}

$settingsPath = Join-Path $env:APPDATA 'Code\User\settings.json'
$sshConfig = Join-Path $env:USERPROFILE '.ssh\config'
$hostName = '10.10.5.210'

# ---------------------------------------------------------------- revert
if ($Revert) {
    foreach ($f in @($settingsPath, $sshConfig)) {
        $bak = $f + '.srl-tune-bak'
        if (Test-Path -LiteralPath $bak) {
            Copy-Item -LiteralPath $bak -Destination $f -Force
            Ok ("restored " + $f)
        } else {
            Warn ("no backup for " + $f)
        }
    }
    Say '== reverted. Reload the window.'
    exit 0
}

# ---------------------------------------------------------------- settings
$tuned = [ordered]@{
    # 1. the SOCKS tunnel is what dies: use plain -L forwarding instead
    'remote.SSH.enableDynamicForwarding'   = $false
    # 2. back to the supported connection path (someone had turned it off)
    'remote.SSH.useLocalServer'            = $true
    # 3. a unix socket instead of a TCP port on a shared login node
    'remote.SSH.remoteServerListenOnSocket' = $true
    # 4. HOME is on NFS (/mnt/hpc/home/...): flock there hangs, lock files
    #    belong in /tmp
    'remote.SSH.useFlock'                  = $false
    'remote.SSH.lockfilesInTmp'            = $true
    # 5. slow login node: give it time, and show the real error when it fails
    'remote.SSH.connectTimeout'            = 60
    'remote.SSH.maxReconnectionAttempts'   = 10
    'remote.SSH.showLoginTerminal'         = $true
    # 6. never let the client jump past 1.85.2 (>=1.86 needs glibc 2.28)
    'update.mode'                          = 'none'
    'update.enableWindowsBackgroundUpdates' = $false
    'extensions.autoUpdate'                = $false
    'extensions.autoCheckUpdates'          = $false
}

if (-not (Test-Path -LiteralPath $settingsPath)) {
    Warn ("settings.json not found: " + $settingsPath)
} else {
    $raw = [System.IO.File]::ReadAllText($settingsPath, (New-Object System.Text.UTF8Encoding($false)))
    $clean = [System.Text.RegularExpressions.Regex]::Replace($raw, '(?m)^\s*//.*$', '')
    $clean = [System.Text.RegularExpressions.Regex]::Replace($clean, ',(\s*[}\]])', '$1')
    $json = $null
    try { $json = $clean | ConvertFrom-Json } catch { }
    if (-not $json) {
        Warn 'cannot parse settings.json - not touching it'
    } else {
        foreach ($k in $tuned.Keys) {
            $v = $tuned[$k]
            if ($json.PSObject.Properties[$k]) { $json.$k = $v }
            else { Add-Member -InputObject $json -MemberType NoteProperty -Name $k -Value $v }
            Say ("   " + $k + " = " + $v)
        }
        if (-not $WhatIf) {
            Copy-Item -LiteralPath $settingsPath -Destination ($settingsPath + '.srl-tune-bak') -Force -ErrorAction SilentlyContinue
            [System.IO.File]::WriteAllText($settingsPath, ($json | ConvertTo-Json -Depth 20) + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
            Ok ("wrote " + $settingsPath + "  (backup: .srl-tune-bak)")
        }
    }
}

# ---------------------------------------------------------------- ssh config
if (Test-Path -LiteralPath $sshConfig) {
    $lines = @(Get-Content -LiteralPath $sshConfig)
    $out = New-Object System.Collections.ArrayList
    $inBlock = $false
    $seen = @{}
    $wanted = @{ 'ServerAliveInterval' = '15'; 'ServerAliveCountMax' = '10'; 'TCPKeepAlive' = 'yes'; 'IPQoS' = 'none' }
    foreach ($ln in $lines) {
        if ($ln -match '^\s*Host\s+(.+)$') {
            if ($inBlock) {
                foreach ($k in $wanted.Keys) {
                    if (-not $seen[$k]) { $null = $out.Add("  $k $($wanted[$k])") }
                }
            }
            $names = ($Matches[1] -split '\s+')
            $inBlock = ($names -contains $hostName)
            $seen = @{}
            $null = $out.Add($ln)
            continue
        }
        if ($inBlock -and $ln -match '^\s*(\w+)\s+(.*)$' -and $wanted.ContainsKey($Matches[1])) {
            $k = $Matches[1]
            $seen[$k] = $true
            $null = $out.Add("  $k $($wanted[$k])")
            continue
        }
        $null = $out.Add($ln)
    }
    if ($inBlock) {
        foreach ($k in $wanted.Keys) {
            if (-not $seen[$k]) { $null = $out.Add("  $k $($wanted[$k])") }
        }
    }
    Say ''
    Say "== ~/.ssh/config : keepalive every 15s for $hostName"
    if (-not $WhatIf) {
        Copy-Item -LiteralPath $sshConfig -Destination ($sshConfig + '.srl-tune-bak') -Force -ErrorAction SilentlyContinue
        [System.IO.File]::WriteAllLines($sshConfig, $out, (New-Object System.Text.UTF8Encoding($false)))
        Ok 'ssh config updated (backup: .srl-tune-bak)'
    }
}

Say ''
Say '== done. In VS Code: Ctrl+Shift+P -> Developer: Reload Window, then reconnect.'
Say '   undo everything with:  .\code\tune_remote_ssh.ps1 -Revert'
