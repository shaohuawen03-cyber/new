# setup_terminal.ps1 - configure the SSH terminal FOR the user, in every IDE
# found on this machine (VS Code, Antigravity, Cursor, Insiders).
#
#   .\code\setup_terminal.ps1 -Target 25wenshaohua@10.10.5.210 -Password A123456
#   .\code\setup_terminal.ps1 -Target 25wenshaohua@10.10.5.210          # no key deploy,
#                                                                       # terminal asks for
#                                                                       # the password itself
#   .\code\setup_terminal.ps1 -Target ... -Password ... -WhatIf         # show, change nothing
#
# What it does (no clicking in the IDE, no extension activation needed):
#   1. finds the system ssh.exe and checks the server answers on the port
#   2. with -Password: makes sure a local key exists and installs it into the
#      remote ~/.ssh/authorized_keys (ssh2 over a password session), then
#      PROVES it with `ssh -o BatchMode=yes` before using it
#   3. writes a PLAIN profile (path + args) into each IDE's settings.json and
#      points terminal.integrated.defaultProfile.<os> at it (a .bak is kept)
#   4. prints exactly what was written
#
# The password is never written into settings, never logged and never leaves
# this machine: it is only used for the one key-installation session.
# ASCII-only on purpose (Windows PowerShell 5.1 reads .ps1 as ANSI/GBK).

param(
    [Parameter(Mandatory = $true)][string]$Target,
    [string]$Password = '',
    [string]$KeyPath = '',
    [switch]$NoKey,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo

# NB: Write-Output, never Write-Host. The watcher runs this script without a
# console (zero-window vbs launcher) through a redirected pipe, and Write-Host
# output is then lost - round 11 logged nothing at all and looked like a
# script that never ran.
function Say([string]$m, [string]$c = 'Gray') { Write-Output $m }
function Ok([string]$m)   { Write-Output "  [ok]   $m" }
function Warn([string]$m) { Write-Output "  [warn] $m" }
function Bad([string]$m)  { Write-Output "  [FAIL] $m" }

# ---------------------------------------------------------------- target
if ($Target -notmatch '^(?:([^@]+)@)?([^:@]+)(?::(\d+))?$') {
    Bad "cannot parse -Target '$Target' (expected user@host[:port])"
    exit 1
}
$user = if ($Matches[1]) { $Matches[1] } else { 'root' }
$hostName = $Matches[2]
$port = if ($Matches[3]) { [int]$Matches[3] } else { 22 }
Say "== target : ${user}@${hostName}:${port}" 'Cyan'

# ---------------------------------------------------------------- ssh.exe
$sshExe = ''
foreach ($c in @(
    'C:\Windows\System32\OpenSSH\ssh.exe',
    'C:\Program Files\OpenSSH\ssh.exe',
    'C:\Program Files (x86)\OpenSSH\ssh.exe')) {
    if (Test-Path -LiteralPath $c) { $sshExe = $c; break }
}
if (-not $sshExe) {
    $cmd = Get-Command ssh -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { $sshExe = [string]$cmd.Source }
}
if (-not $sshExe) {
    Bad 'no ssh client found - install "OpenSSH Client" (Settings > Apps > Optional features)'
    exit 1
}
Ok "ssh client: $sshExe"

# ---------------------------------------------------------------- reachable?
$tcp = Test-NetConnection -ComputerName $hostName -Port $port -WarningAction SilentlyContinue
if ($tcp -and $tcp.TcpTestSucceeded) {
    Ok "tcp ${hostName}:${port} is open"
} else {
    Warn "tcp ${hostName}:${port} did NOT answer - VPN / firewall / wrong address?"
    Warn 'the profile will still be written, but the terminal cannot connect until this works'
}

# ---------------------------------------------------------------- key
$keyToUse = ''
if ($KeyPath -and (Test-Path -LiteralPath $KeyPath)) { $keyToUse = $KeyPath }

function Test-KeyLogin([string]$key) {
    if (-not $key -or -not (Test-Path -LiteralPath $key)) { return $false }
    $args = @('-p', "$port", '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
              '-o', 'ConnectTimeout=10', '-o', 'IdentitiesOnly=yes', '-i', $key,
              "${user}@${hostName}", 'echo SRL_KEY_OK')
    $out = & $sshExe @args 2>&1 | Out-String
    return ($out -match 'SRL_KEY_OK')
}

if (-not $NoKey) {
    $defaultKey = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
    if (-not $keyToUse -and (Test-Path -LiteralPath $defaultKey)) { $keyToUse = $defaultKey }
    if ($keyToUse -and (Test-KeyLogin $keyToUse)) {
        Ok "passwordless login already works with $keyToUse"
    } elseif ($Password) {
        Say '== installing the local public key on the server (one password session) ...' 'Cyan'
        $node = Get-Command node -ErrorAction SilentlyContinue
        if (-not $node) {
            Warn 'node.js not found - skipping key install (the terminal will ask for the password)'
            $keyToUse = ''
        } else {
            & node (Join-Path $repo 'code\deploy_key.js') ("${user}@${hostName}:${port}") $Password 2>&1 |
                ForEach-Object { Write-Output "   $_" }
            $deployed = ($LASTEXITCODE -eq 0)
            $keyToUse = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
            if ($deployed -and (Test-KeyLogin $keyToUse)) {
                Ok "passwordless login verified with $keyToUse"
            } else {
                Warn 'key install did not result in a passwordless login - falling back to the password prompt'
                $keyToUse = ''
            }
        }
    } else {
        Warn 'no -Password given and no working key - the terminal will ask for the password (that is fine)'
        $keyToUse = ''
    }
} else {
    $keyToUse = ''
}

# ---------------------------------------------------------------- profile
# If ~/.ssh/config already describes this host (user, port, IdentityFile,
# ProxyJump ...), the profile must NOT fight it: plain `ssh <host>` picks all
# of that up. Overriding with our own -i/-p is how a working ssh config gets
# broken. (This machine has: Host 25wenshaohua 10.10.5.210 hpc-mu01 ...)
$hasConfigBlock = $false
$sshConfigFile = Join-Path $env:USERPROFILE '.ssh\config'
if (Test-Path -LiteralPath $sshConfigFile) {
    foreach ($ln in (Get-Content -LiteralPath $sshConfigFile)) {
        if ($ln -match '^\s*Host\s+(.+)$') {
            $names = ($Matches[1] -split '\s+')
            if ($names -contains $hostName) { $hasConfigBlock = $true; break }
        }
    }
}

$profileName = "SSH Remote Lite (${user}@${hostName})"
$argList = New-Object System.Collections.ArrayList
if ($hasConfigBlock) {
    Ok "~/.ssh/config already has a Host block for $hostName - the profile will just use it"
    $null = $argList.Add('-o'); $null = $argList.Add('StrictHostKeyChecking=accept-new')
    $null = $argList.Add($hostName)
} else {
    $null = $argList.Add('-p'); $null = $argList.Add("$port")
    $null = $argList.Add('-o'); $null = $argList.Add('StrictHostKeyChecking=accept-new')
    $null = $argList.Add('-o'); $null = $argList.Add('ServerAliveInterval=30')
    if ($keyToUse) {
        $null = $argList.Add('-o'); $null = $argList.Add('IdentitiesOnly=yes')
        $null = $argList.Add('-i'); $null = $argList.Add($keyToUse)
    }
    $null = $argList.Add("${user}@${hostName}")
}

Say ''
Say "== profile : $profileName" 'Cyan'
Say ("   path    : " + $sshExe)
Say ("   args    : " + ($argList -join ' '))
if (-not $keyToUse) {
    Say '   (no -i: ssh will ask "password:" inside the terminal, like before)' 'DarkGray'
}

# ---------------------------------------------------------------- settings
$targets = @(
    @{ name = 'VS Code';          path = (Join-Path $env:APPDATA 'Code\User\settings.json') },
    @{ name = 'VS Code Insiders'; path = (Join-Path $env:APPDATA 'Code - Insiders\User\settings.json') },
    @{ name = 'Antigravity';      path = (Join-Path $env:APPDATA 'Antigravity\User\settings.json') },
    @{ name = 'Cursor';           path = (Join-Path $env:APPDATA 'Cursor\User\settings.json') }
)
# Forks keep their user data wherever they like, so also look for any
# <root>\User\settings.json that belongs to a VS Code-like app.
foreach ($root in @($env:APPDATA, (Join-Path $env:LOCALAPPDATA 'Programs'), $env:USERPROFILE)) {
    if (-not $root -or -not (Test-Path -LiteralPath $root)) { continue }
    Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match 'antigravity|windsurf|trae|cursor|vscodium|code' } |
        ForEach-Object {
            $cand = Join-Path $_.FullName 'User\settings.json'
            $candDir = Split-Path -Parent $cand
            if ((Test-Path -LiteralPath $candDir) -and -not ($targets | Where-Object { $_.path -eq $cand })) {
                $targets += @{ name = $_.Name; path = $cand }
            }
        }
}
$written = 0
foreach ($t in $targets) {
    $p = [string]$t.path
    $dir = Split-Path -Parent $p
    if (-not (Test-Path -LiteralPath $dir)) { continue }   # that IDE is not installed
    Say ''
    Say ("== " + $t.name + " : " + $p) 'Cyan'
    $json = $null
    if (Test-Path -LiteralPath $p) {
        $raw = [System.IO.File]::ReadAllText($p, (New-Object System.Text.UTF8Encoding($false)))
        # settings.json may contain // comments and trailing commas
        $clean = [System.Text.RegularExpressions.Regex]::Replace($raw, '(?m)^\s*//.*$', '')
        $clean = [System.Text.RegularExpressions.Regex]::Replace($clean, ',(\s*[}\]])', '$1')
        try {
            $json = $clean | ConvertFrom-Json
        } catch {
            Bad ("cannot parse this settings.json (" + $_.Exception.Message + ") - skipped, fix the file or edit it by hand")
            continue
        }
    }
    if (-not $json) { $json = New-Object PSObject }

    $osKey = 'windows'
    $profKey = "terminal.integrated.profiles.$osKey"
    $defKey = "terminal.integrated.defaultProfile.$osKey"

    $profiles = $json.$profKey
    if (-not $profiles) { $profiles = New-Object PSObject }
    # drop stale "SSH Remote Lite (...)" entries we wrote earlier (a bad run
    # once produced "SSH Remote Lite (root@-Target)") - keep only the current one
    foreach ($stale in @($profiles.PSObject.Properties |
            Where-Object { $_.Name -like 'SSH Remote Lite (*' -and $_.Name -ne $profileName } |
            ForEach-Object { $_.Name })) {
        $profiles.PSObject.Properties.Remove($stale)
        Say ("   removed stale profile: " + $stale)
    }
    $entry = New-Object PSObject
    Add-Member -InputObject $entry -MemberType NoteProperty -Name 'path' -Value $sshExe
    Add-Member -InputObject $entry -MemberType NoteProperty -Name 'args' -Value ([string[]]$argList.ToArray())
    Add-Member -InputObject $entry -MemberType NoteProperty -Name 'overrideName' -Value $true
    if ($profiles.PSObject.Properties[$profileName]) {
        $profiles.$profileName = $entry
    } else {
        Add-Member -InputObject $profiles -MemberType NoteProperty -Name $profileName -Value $entry
    }
    if ($json.PSObject.Properties[$profKey]) { $json.$profKey = $profiles }
    else { Add-Member -InputObject $json -MemberType NoteProperty -Name $profKey -Value $profiles }
    if ($json.PSObject.Properties[$defKey]) { $json.$defKey = $profileName }
    else { Add-Member -InputObject $json -MemberType NoteProperty -Name $defKey -Value $profileName }

    $outJson = $json | ConvertTo-Json -Depth 20
    if ($WhatIf) {
        Say '   -WhatIf: nothing written. It would become:' 'DarkGray'
        ($outJson -split "`r?`n" | Select-Object -First 40) | ForEach-Object { Say ('   ' + $_) 'DarkGray' }
        continue
    }
    if (Test-Path -LiteralPath $p) {
        Copy-Item -LiteralPath $p -Destination ($p + '.srl-bak') -Force -ErrorAction SilentlyContinue
    }
    [System.IO.File]::WriteAllText($p, $outJson + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
    Ok "default terminal set to: $profileName"
    Say ("   backup: " + $p + '.srl-bak') 'DarkGray'
    $written++
}

Say ''
if ($written -gt 0) {
    Say "== done. In the IDE: Ctrl+Shift+P -> 'Developer: Reload Window', then open a NEW terminal." 'Green'
    Say "   It should land on ${user}@${hostName} right away." 'Green'
    if (-not $keyToUse) {
        Say "   It will ask 'password:' in the terminal - type it there." 'Yellow'
    }
} elseif (-not $WhatIf) {
    Warn 'no IDE settings folder found (%APPDATA%\Code\User etc.) - is the IDE installed for this user?'
}
