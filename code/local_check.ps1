# local_check.ps1 - round checks for ssh-remote-lite on the real Windows box.
# ASCII-only (Windows PowerShell 5.1 reads .ps1 as ANSI/GBK).
# Exit 0 = all passed, 1 = something failed.

$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')

$fail = 0
function Mark($ok, $label, $extra) {
    if ($ok) {
        Write-Output ('[PASS] ' + $label)
    } else {
        $msg = '[FAIL] ' + $label
        if ($extra) { $msg = $msg + ' - ' + $extra }
        Write-Output $msg
        $script:fail = 1
    }
}

# ---- 0. repo gate (bash from Git for Windows when available)
$bashExe = ''
$g = Get-Command git -ErrorAction SilentlyContinue | Select-Object -First 1
if ($g -and $g.Source) {
    $gitDir = Split-Path -Parent (Split-Path -Parent $g.Source)
    foreach ($c in @((Join-Path $gitDir 'bin\bash.exe'), (Join-Path $gitDir 'usr\bin\bash.exe'))) {
        if (Test-Path -LiteralPath $c) { $bashExe = $c; break }
    }
}
if ($bashExe) {
    & $bashExe code/check_all.sh 2>&1 | Out-String | Write-Output
    Mark ($LASTEXITCODE -eq 0) 'repo gate (code/check_all.sh)'
} else {
    Write-Output '[SKIP] no bash (Git for Windows) - gate skipped'
}

# ---- 1. VS Code CLI
$codeCmd = $null
foreach ($c in @('code', 'code.cmd')) {
    if (Get-Command $c -ErrorAction SilentlyContinue) { $codeCmd = $c; break }
}
if (-not $codeCmd) {
    foreach ($p in @("$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd", "$env:PROGRAMFILES\Microsoft VS Code\bin\code.cmd")) {
        if (Test-Path -LiteralPath $p) { $codeCmd = $p; break }
    }
}
if ($codeCmd) {
    Mark $true ('VS Code CLI found - ' + $codeCmd)
} else {
    Mark $false 'VS Code CLI found' 'in VS Code: Ctrl+Shift+P -> Shell Command: Install code command in PATH'
}

# ---- 2+3. install vsix + extension listed
$vsix = Get-ChildItem -Path 'ssh-remote-lite' -Filter '*.vsix' | Sort-Object Name -Descending | Select-Object -First 1
if ($codeCmd -and $vsix) {
    & $codeCmd --install-extension $vsix.FullName --force 2>&1 | Out-String | Write-Output
    Mark ($LASTEXITCODE -eq 0) ('vsix installed - ' + $vsix.Name)
    # package.json is UTF-8 and contains Chinese: Get-Content -Raw decodes it
    # as ANSI/GBK on PS 5.1 and ConvertFrom-Json then dies with
    # "invalid object, expected : or }" (field report 2026-09-24).
    $pkgPath = Join-Path (Get-Location) 'ssh-remote-lite\package.json'
    $pkgText = [System.IO.File]::ReadAllText($pkgPath, (New-Object System.Text.UTF8Encoding($false)))
    $extId = ''
    try {
        $pkg = $pkgText | ConvertFrom-Json
        $extId = [string]$pkg.publisher + '.' + [string]$pkg.name
    } catch {
        # no JSON parser is needed for two flat string fields
        if ($pkgText -match '"publisher"\s*:\s*"([^"]+)"') { $extId = $Matches[1] }
        if ($pkgText -match '"name"\s*:\s*"([^"]+)"') { $extId = $extId + '.' + $Matches[1] }
    }
    $list = & $codeCmd --list-extensions --show-versions 2>&1 | Out-String
    Mark ($extId -and $list -like "*$extId*") ('extension listed in VS Code - ' + $extId)
    # the installed VSIX must be the one in the repo (an old copy staying behind
    # is exactly how "the fix is not there" happens)
    $want = ''
    if ($vsix.Name -match '-(\d+\.\d+\.\d+)\.vsix$') { $want = $Matches[1] }
    Mark ($want -and $list -like "*$extId@$want*") ('installed version matches the repo vsix - ' + $want)
} else {
    Mark $false 'vsix install' 'missing code CLI or vsix file'
}

# ---- 3b. the same vsix into Antigravity (its own extensions dir + own CLI).
# The user hit "No terminal profile provider registered for id ..." because the
# IDE they clicked in still had an older build installed (2026-09-24).
$agCmd = $null
foreach ($c in @('antigravity', 'antigravity.cmd')) {
    if (Get-Command $c -ErrorAction SilentlyContinue) { $agCmd = $c; break }
}
if (-not $agCmd) {
    foreach ($p in @(
        "$env:LOCALAPPDATA\Programs\Antigravity\bin\antigravity.cmd",
        "$env:PROGRAMFILES\Antigravity\bin\antigravity.cmd")) {
        if (Test-Path -LiteralPath $p) { $agCmd = $p; break }
    }
}
if ($agCmd -and $vsix) {
    & $agCmd --install-extension $vsix.FullName --force 2>&1 | Out-String | Write-Output
    Mark ($LASTEXITCODE -eq 0) ('vsix installed into Antigravity - ' + $vsix.Name)
    $agList = & $agCmd --list-extensions --show-versions 2>&1 | Out-String
    Mark ($extId -and $agList -like "*$extId*") ('extension listed in Antigravity - ' + $extId)
} else {
    Write-Output '[SKIP] Antigravity CLI not found on PATH - install the vsix there by hand if you use it'
}

# ---- 4. node unit/e2e tests, 5. real-VSCode integration test (opens SSH terminal)
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    Push-Location ssh-remote-lite
    if (-not (Test-Path node_modules)) {
        Write-Output '[..] npm install (first run downloads mocha + @vscode/test-electron)'
        npm install --no-audit --no-fund 2>&1 | Out-String | Write-Output
    }
    npm test 2>&1 | Out-String | Write-Output
    Mark ($LASTEXITCODE -eq 0) 'npm test (unit + e2e + ssh CLI + autologin + keyboard-interactive + profile contract, 28 cases)'
    npm run it 2>&1 | Out-String | Write-Output
    Mark ($LASTEXITCODE -eq 0) 'npm run it (real VS Code activates ext + SSH terminal opens and stays alive)'
    # the same suite against the PACKAGED extension: development mode can never
    # reproduce "file system provider for ssh:// is not available"
    npm run it:installed 2>&1 | Out-String | Write-Output
    Mark ($LASTEXITCODE -eq 0) 'npm run it:installed (the .vsix itself activates, ssh:// FS + terminal work)'
    Pop-Location
} else {
    Mark $false 'node.js found' 'install Node LTS from nodejs.org, or: conda install -c conda-forge nodejs'
}

# ---- 8. configure the terminal profile FOR the user (no password needed:
#         without a key the terminal simply asks for it, like Xshell does)
$targetFile = Join-Path $PSScriptRoot 'terminal_target.txt'
if (Test-Path -LiteralPath $targetFile) {
    $sshTarget = (Get-Content -LiteralPath $targetFile -Raw).Trim()
    if ($sshTarget) {
        Write-Output ('[..] writing the terminal profile for ' + $sshTarget)
        # The password never lives in this repo. If the user dropped it into
        # %USERPROFILE%\.srl_password (one line, local only), the round can
        # also install the key and make the login passwordless; without it we
        # just write a profile that asks for the password in the terminal.
        $pwFile = Join-Path $env:USERPROFILE '.srl_password'
        # hashtable splatting: array splatting bound '-Target' as the VALUE
        # (the profile came out as root@-Target, round 15)
        $setupArgs = @{ Target = $sshTarget }
        $havePw = $false
        if (Test-Path -LiteralPath $pwFile) {
            $pw = ([System.IO.File]::ReadAllText($pwFile)).Trim()
            if ($pw) { $setupArgs['Password'] = $pw; $havePw = $true }
        }
        if (-not $havePw) { $setupArgs['NoKey'] = $true }
        Write-Output ('   password file present: ' + $havePw)
        # in-process on purpose: a child powershell running console-less gave
        # back zero output in round 11
        & (Join-Path $PSScriptRoot 'setup_terminal.ps1') @setupArgs 2>&1 |
            ForEach-Object { Write-Output ('   ' + $_) }
        Write-Output ('   setup_terminal exit: ' + $LASTEXITCODE)
        $vsSettings = Join-Path $env:APPDATA 'Code\User\settings.json'
        $okProfile = $false
        if (Test-Path -LiteralPath $vsSettings) {
            $txt = [System.IO.File]::ReadAllText($vsSettings, (New-Object System.Text.UTF8Encoding($false)))
            $okProfile = ($txt -like '*SSH Remote Lite (*') -and ($txt -like '*defaultProfile.windows*')
        }
        Mark $okProfile 'terminal profile written into VS Code settings.json'
    }
}

# ---- 8b. the real server: is it reachable, and does the terminal command line
#          actually get a shell there?
$realHost = '10.10.5.210'
$realExe = 'C:\Windows\System32\OpenSSH\ssh.exe'
if (-not (Test-Path -LiteralPath $realExe)) {
    $rc = Get-Command ssh -ErrorAction SilentlyContinue
    if ($rc) { $realExe = [string]$rc.Source }
}
# a plain TCP connect with an explicit timeout: Test-NetConnection also pings
# first and reports False on ICMP-filtered networks / slow VPN links
function Test-Tcp([string]$h, [int]$p, [int]$timeoutMs = 8000) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect($h, $p, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($timeoutMs, $false)) { return $false }
        $client.EndConnect($iar)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}
$tcpOk = Test-Tcp $realHost 22
if (-not $tcpOk) {
    Start-Sleep -Seconds 2
    $tcpOk = Test-Tcp $realHost 22 12000
}
Write-Output ('   tcp probe -> ' + $tcpOk)
if (-not $tcpOk) {
    Write-Output ("[SKIP] " + $realHost + ":22 is not reachable from here (VPN/LAN down) - real-server checks skipped")
} else {
    Mark $true ("tcp " + $realHost + ":22 reachable")
    $probe = & $realExe '-o' 'BatchMode=yes' '-o' 'StrictHostKeyChecking=accept-new' '-o' 'ConnectTimeout=12' $realHost 'echo SRL_REMOTE_OK; uname -a; whoami' 2>&1 | Out-String
    $probeOk = ($probe -match 'SRL_REMOTE_OK')
    if ($probeOk) {
        Mark $true 'passwordless login to the real server works'
        ($probe -split "`r?`n" | Where-Object { $_ -match '\S' }) | ForEach-Object { Write-Output ('   ' + $_) }
    } elseif ($havePw) {
        Mark $false 'passwordless login to the real server' (($probe -split "`r?`n" | Where-Object { $_ -match '\S' } | Select-Object -Last 3) -join ' | ')
    } else {
        Write-Output '[SKIP] no passwordless login yet (no password file) - the terminal will ask for the password'
        ($probe -split "`r?`n" | Where-Object { $_ -match '\S' } | Select-Object -Last 3) | ForEach-Object { Write-Output ('   ' + $_) }
    }
}

# ---- 9. diagnostics (never fails the round - it only reports the real state)
Write-Output ''
Write-Output '===== DIAGNOSTICS ====='
function Redact([string]$text) {
    if (-not $text) { return '' }
    $t = $text -replace '("password"\s*:\s*")[^"]*(")', '$1<redacted>$2'
    $t = $t -replace '("passphrase"\s*:\s*")[^"]*(")', '$1<redacted>$2'
    return $t
}
$settingsPaths = @(
    (Join-Path $env:APPDATA 'Code\User\settings.json'),
    (Join-Path $env:APPDATA 'Antigravity\User\settings.json'),
    (Join-Path $env:APPDATA 'Code - Insiders\User\settings.json')
)
foreach ($sp in $settingsPaths) {
    if (Test-Path -LiteralPath $sp) {
        Write-Output ("--- settings: " + $sp)
        $raw = [System.IO.File]::ReadAllText($sp, (New-Object System.Text.UTF8Encoding($false)))
        $keep = @()
        foreach ($ln in ($raw -split "`r?`n")) {
            if ($ln -match 'sshRemoteLite|terminal\.integrated|SSH Remote Lite|defaultProfile|profiles\.|"path"|"args"|ssh\.exe|10\.10\.5\.210|-i"|IdentitiesOnly|StrictHostKey') {
                $keep += (Redact $ln)
            }
        }
        if ($keep.Count -eq 0) { Write-Output '   (no ssh/terminal related lines)' }
        else { $keep | ForEach-Object { Write-Output ('   ' + $_) } }
    } else {
        Write-Output ("--- settings MISSING: " + $sp)
    }
}
Write-Output '--- ~/.ssh'
$sshHome = Join-Path $env:USERPROFILE '.ssh'
if (Test-Path -LiteralPath $sshHome) {
    Get-ChildItem -LiteralPath $sshHome -Force | ForEach-Object { Write-Output ('   ' + $_.Name + '  ' + $_.Length + ' bytes') }
} else {
    Write-Output '   (no .ssh directory)'
}
Write-Output '--- installed extension folder'
$extRoot = Join-Path $env:USERPROFILE '.vscode\extensions'
if (Test-Path -LiteralPath $extRoot) {
    Get-ChildItem -LiteralPath $extRoot -Directory -Filter '*ssh-remote-lite*' -ErrorAction SilentlyContinue |
        ForEach-Object {
            Write-Output ('   ' + $_.Name)
            foreach ($need in @('package.json', 'out\extension.js', 'node_modules\ssh2\package.json')) {
                $f = Join-Path $_.FullName $need
                Write-Output ('      ' + $need + ' exists=' + (Test-Path -LiteralPath $f))
            }
        }
} else {
    Write-Output '   (no ~/.vscode/extensions)'
}
Write-Output '--- extension host log (ssh-remote-lite / activation errors)'
$logRoot = Join-Path $env:APPDATA 'Code\logs'
if (Test-Path -LiteralPath $logRoot) {
    $recent = Get-ChildItem -LiteralPath $logRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 2
    foreach ($d in $recent) {
        Get-ChildItem -LiteralPath $d.FullName -Recurse -Filter 'exthost.log' -ErrorAction SilentlyContinue |
            Select-Object -First 4 |
            ForEach-Object {
                $hits = Select-String -LiteralPath $_.FullName -Pattern 'ssh-remote-lite|Activating extension|activationEvent|Error: |ERR ' -ErrorAction SilentlyContinue |
                    Select-Object -Last 12
                if ($hits) {
                    Write-Output ('   ' + $_.FullName)
                    $hits | ForEach-Object { Write-Output ('      ' + $_.Line) }
                }
            }
    }
} else {
    Write-Output '   (no Code logs dir)'
}
Write-Output '--- ~/.ssh/config (host blocks only)'
$sshCfg = Join-Path $env:USERPROFILE '.ssh\config'
if (Test-Path -LiteralPath $sshCfg) {
    (Get-Content -LiteralPath $sshCfg) | ForEach-Object { Write-Output ('   ' + $_) }
} else {
    Write-Output '   (no ~/.ssh/config)'
}
Write-Output '--- network to the server'
try {
    $t = Test-NetConnection -ComputerName '10.10.5.210' -Port 22 -WarningAction SilentlyContinue
    Write-Output ('   ping=' + $t.PingSucceeded + '  tcp22=' + $t.TcpTestSucceeded + '  via=' + $t.SourceAddress.IPAddress)
} catch {
    Write-Output ('   Test-NetConnection failed: ' + $_.Exception.Message)
}
Write-Output '--- Antigravity layout'
$agRoot = Join-Path $env:LOCALAPPDATA 'Programs\Antigravity'
if (Test-Path -LiteralPath $agRoot) {
    foreach ($sub in @('bin', '')) {
        $d = if ($sub) { Join-Path $agRoot $sub } else { $agRoot }
        if (Test-Path -LiteralPath $d) {
            Get-ChildItem -LiteralPath $d -ErrorAction SilentlyContinue |
                Select-Object -First 20 |
                ForEach-Object { Write-Output ('   ' + $d + ' > ' + $_.Name) }
        }
    }
}
foreach ($cand in @(
    (Join-Path $env:APPDATA 'Antigravity\User\settings.json'),
    (Join-Path $env:APPDATA 'Google\Antigravity\User\settings.json'),
    (Join-Path $env:USERPROFILE '.antigravity\settings.json'),
    (Join-Path $env:APPDATA 'antigravity\User\settings.json'))) {
    Write-Output ('   settings candidate: ' + $cand + '  exists=' + (Test-Path -LiteralPath $cand))
}
Write-Output '--- ssh client'
$sshExe = 'C:\Windows\System32\OpenSSH\ssh.exe'
if (-not (Test-Path -LiteralPath $sshExe)) {
    $c = Get-Command ssh -ErrorAction SilentlyContinue
    if ($c) { $sshExe = $c.Source }
}
Write-Output ('   exe: ' + $sshExe + '  exists=' + (Test-Path -LiteralPath $sshExe))
if (Test-Path -LiteralPath $sshExe) {
    & $sshExe -V 2>&1 | ForEach-Object { Write-Output ('   ' + $_) }
    Write-Output '--- reachability of the real server (no password is sent; batch mode)'
    $target = '25wenshaohua@10.10.5.210'
    $out = & $sshExe '-v' '-o' 'BatchMode=yes' '-o' 'StrictHostKeyChecking=accept-new' '-o' 'ConnectTimeout=8' '-o' 'NumberOfPasswordPrompts=0' $target 'echo SRL_OK' 2>&1 | Out-String
    ($out -split "`r?`n" | Where-Object { $_ -match '\S' } | Select-Object -Last 22) | ForEach-Object { Write-Output ('   ' + $_) }
}
Write-Output '--- IDE versions'
if ($codeCmd) { & $codeCmd --version 2>&1 | Select-Object -First 1 | ForEach-Object { Write-Output ('   VS Code ' + $_) } }
foreach ($p in @(
    "$env:LOCALAPPDATA\Programs\Antigravity\bin\antigravity.cmd",
    "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe",
    "$env:PROGRAMFILES\Antigravity\bin\antigravity.cmd")) {
    Write-Output ('   antigravity candidate: ' + $p + '  exists=' + (Test-Path -LiteralPath $p))
}
Write-Output '===== END DIAGNOSTICS ====='

if ($fail -eq 0) {
    Write-Output '== LOCAL CHECK: ALL PASSED =='
} else {
    Write-Output '== LOCAL CHECK: FAILURES PRESENT =='
}
exit $fail
