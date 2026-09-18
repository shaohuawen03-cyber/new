# diagnose_reason.ps1 - run this and push fill_reason.last.log back to me.
# It writes every probe result to deliverable/fill_reason.last.log so nothing
# is swallowed by a quiet console. ASCII-only like fill_reason.ps1.

$repo = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
while ($repo -and -not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
    $up = Split-Path -Parent $repo
    if (-not $up -or $up -eq $repo) { break }
    $repo = $up
}
Set-Location -LiteralPath $repo
$log = Join-Path $repo 'deliverable\fill_reason.last.log'
Start-Transcript -LiteralPath $log -Force | Out-Null

Write-Host '== 1. shell ==='
Write-Host ('  PSScriptRoot: ' + $PSScriptRoot)
Write-Host ('  cwd: ' + (Get-Location).Path)
Write-Host ('  repo: ' + $repo)
Write-Host ('  PS: ' + $PSVersionTable.PSVersion.ToString())

Write-Host ''
Write-Host '== 2. sources/*.doc ==='
$doc = Get-ChildItem -LiteralPath (Join-Path $repo 'sources') -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -eq '.doc' }
if ($doc) { $doc | ForEach-Object { Write-Host ('  found: ' + $_.FullName + ' (' + $_.Length + ' B)') } }
else { Write-Host '  [MISSING] no .doc in sources/ - did you .\sync.ps1?' }

Write-Host ''
Write-Host '== 3. deliverable/*.txt with 200 ==='
$t = Get-ChildItem -LiteralPath (Join-Path $repo 'deliverable') -Filter '*.txt' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '200' }
if ($t) { $t | ForEach-Object { Write-Host ('  found: ' + $_.Name + ' (' + $_.Length + ' B)') } }
else { Write-Host '  [MISSING] no *200*.txt in deliverable/ - did you .\sync.ps1?' }

Write-Host ''
Write-Host '== 4. COM hosts ==='
foreach ($id in @('Word.Application','KWPS.Application','WPS.Application','ET.Application')) {
    try {
        $obj = New-Object -ComObject $id -ErrorAction Stop
        Write-Host ('  [ok]  ' + $id)
        try { $obj.Quit() } catch {}
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj)
    } catch {
        Write-Host ('  [no]  ' + $id + ' : ' + $_.Exception.Message)
    }
}

Write-Host ''
Write-Host '== 5. done. push the log: ==='
Write-Host '  .\push.ps1 "diag: fill_reason log"'
Stop-Transcript | Out-Null
