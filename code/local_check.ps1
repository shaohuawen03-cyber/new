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

# ---- 4. node unit/e2e tests, 5. real-VSCode integration test (opens SSH terminal)
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    Push-Location ssh-remote-lite
    if (-not (Test-Path node_modules)) {
        Write-Output '[..] npm install (first run downloads mocha + @vscode/test-electron)'
        npm install --no-audit --no-fund 2>&1 | Out-String | Write-Output
    }
    npm test 2>&1 | Out-String | Write-Output
    Mark ($LASTEXITCODE -eq 0) 'npm test (unit + ssh e2e + ssh CLI + autologin/manifest, 22 cases)'
    npm run it 2>&1 | Out-String | Write-Output
    Mark ($LASTEXITCODE -eq 0) 'npm run it (real VS Code activates ext + SSH terminal opens and stays alive)'
    Pop-Location
} else {
    Mark $false 'node.js found' 'install Node LTS from nodejs.org, or: conda install -c conda-forge nodejs'
}

if ($fail -eq 0) {
    Write-Output '== LOCAL CHECK: ALL PASSED =='
} else {
    Write-Output '== LOCAL CHECK: FAILURES PRESENT =='
}
exit $fail
