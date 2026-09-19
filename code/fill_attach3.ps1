# fill_attach3.ps1 - fill attachment3 (xueye jiangxuejin form) via Word/WPS COM.
# All CJK strings live in deliverable/fill_attach3.values.txt (UTF-8) so this
# script itself stays ASCII-only (PS 5.1 decodes .ps1 as ANSI/GBK).
#
# Usage (repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File code/fill_attach3.ps1
# Output: deliverable/<src-basename>_filled.doc + deliverable/fill_attach3.last.log

$ErrorActionPreference = 'Stop'

$repo = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
while ($repo -and -not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
    $up = Split-Path -Parent $repo
    if (-not $up -or $up -eq $repo) { break }
    $repo = $up
}
Set-Location -LiteralPath $repo
if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
    Write-Host '[ERROR] not a git repository' -ForegroundColor Red; exit 1
}
$deliv = Join-Path $repo 'deliverable'
$logFile = Join-Path $deliv 'fill_attach3.last.log'
Start-Transcript -LiteralPath $logFile -Force | Out-Null
Write-Host ('== log: ' + $logFile)

# --- load values ------------------------------------------------------------
$vfile = Join-Path $deliv 'fill_attach3.values.txt'
if (-not (Test-Path -LiteralPath $vfile)) {
    Write-Host '[ERROR] fill_attach3.values.txt missing - run .\sync.ps1' -ForegroundColor Red
    Stop-Transcript | Out-Null; exit 1
}
$values  = @{}   # label -> value
$ticks   = @{}   # find -> replace (checkbox)
$exclude = ''    # skip-tick marker (e.g. the level-choices cell)
$reasonLabel = ''
$hintStr = ''
$tickKey = ''
$reasonSrc = ''
foreach ($ln in @(Get-Content -LiteralPath $vfile -Encoding UTF8)) {
    if ([string]::IsNullOrWhiteSpace($ln) -or $ln.StartsWith('#')) { continue }
    $p = $ln -split "`t", 3
    switch ($p[0]) {
        'V' { $values[$p[1]]  = $p[2] }
        'T' { $ticks[$p[1]]   = $p[2] }
        'X' { $exclude        = $p[1] }
        'R' { $reasonLabel    = $p[1] }
        'H' { $hintStr        = $p[1] }
        'S' { $tickKey        = $p[1] }
        'REASON_SRC' { $reasonSrc = $p[1] }
    }
}
$rfile = Join-Path $deliv $reasonSrc
if (-not (Test-Path -LiteralPath $rfile)) {
    Write-Host ('[ERROR] ' + $reasonSrc + ' missing - run .\sync.ps1') -ForegroundColor Red
    Stop-Transcript | Out-Null; exit 1
}
$reason = @(Get-Content -LiteralPath $rfile -Encoding UTF8)[2]
Write-Host ('== values: ' + $values.Count + ', ticks: ' + $ticks.Count + ', reason: ' + $reason.Length + ' chars')

# --- locate source .doc -----------------------------------------------------
$src = Get-ChildItem -LiteralPath (Join-Path $repo 'sources') -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -eq '.doc' -and $_.Name -match '3' -and $_.Name -notmatch '2' } | Select-Object -First 1
if (-not $src) {
    Write-Host '[ERROR] attachment3 .doc not found in sources/ - run .\sync.ps1' -ForegroundColor Red
    Stop-Transcript | Out-Null; exit 1
}
$dest = Join-Path $deliv ($src.BaseName + '_filled.doc')
Write-Host ('== source: ' + $src.Name)
Write-Host ('== output: ' + $dest)

# --- start Word/WPS ---------------------------------------------------------
$app = $null
foreach ($id in @('Word.Application', 'KWPS.Application')) {
    try { $app = New-Object -ComObject $id -ErrorAction Stop; Write-Host ('== office: ' + $id); break } catch { }
}
if (-not $app) {
    Write-Host '[ERROR] neither Word nor WPS COM available' -ForegroundColor Red
    Stop-Transcript | Out-Null; exit 1
}

$filled = 0
try {
    $app.Visible = $false
    $app.DisplayAlerts = 0
    $doc = $app.Documents.Open($src.FullName, $false, $true)   # ReadOnly
    try {
        foreach ($table in @($doc.Tables)) {
            $cells = @($table.Range.Cells)
            for ($i = 0; $i -lt $cells.Count; $i++) {
                    $t = ('' + $cells[$i].Range.Text) -replace "[`r`a\x07]", ''
                    $t = $t.Trim()
                    if ($t.Length -eq 0) { continue }
                    # 1) exact label -> write next cell if empty
                    if ($values.ContainsKey($t)) {
                        if ($i + 1 -lt $cells.Count) {
                            $nxt = ('' + $cells[$i+1].Range.Text) -replace "[`r`a\x07]", ''
                            if ($nxt.Trim().Length -eq 0) {
                                $r = $cells[$i+1].Range
                                $r.SetRange($r.Start, $r.End - 2)
                                $r.Text = $values[$t]
                                Write-Host ('== filled label #' + $filled)
                                $script:filled++
                            }
                        }
                    }
                    # 2) tick checkbox (skip the level-choices cell that also has the exclude marker)
                    if ($t.Contains($tickKey) -and (-not $exclude -or -not $t.Contains($exclude))) {
                        foreach ($k in $ticks.Keys) {
                            if ($t.Contains($k)) {
                                $nt = $t.Replace($k, $ticks[$k])
                                $r = $cells[$i].Range
                                $r.SetRange($r.Start, $r.End - 2)
                                $r.Text = $nt
                                Write-Host '== ticked checkbox'
                                $script:filled++
                                break
                            }
                        }
                    }
                    # 3) reason label -> next big/empty cell gets the reason
                    if ($t -eq $reasonLabel) {
                        for ($j = $i + 1; $j -lt $cells.Count; $j++) {
                            $cand = ('' + $cells[$j].Range.Text) -replace "[`r`a\x07]", ''
                            if ($cand.Contains($hintStr)) {
                                $r = $cells[$j].Range
                                $r.SetRange($r.Start, $r.End - 2)
                                $r.Text = $reason + "`r`n`r`n"
                                Write-Host '== filled reason cell'
                                $script:filled++
                                break
                            }
                        }
                    }
                }
            }
        if ($filled -lt 5) {
            Write-Host ('[ERROR] only ' + $filled + ' field(s) filled (expect >=8) - layout differs; NOT saving') -ForegroundColor Red
            Stop-Transcript | Out-Null; exit 1
        }
        if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
        $doc.SaveAs($dest)
        Write-Host ('OK: wrote ' + $dest + '  (filled: ' + $filled + ')')
    } finally {
        $doc.Close($false)
    }
} finally {
    try { $app.Quit() } catch { }
    if ($app) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
}

if (Test-Path -LiteralPath $dest) {
    Write-Host ''
    Write-Host 'NEXT: open _filled.doc and finish the personal fields (gender/birth/ethnicity/id no./entry date/duration/level checkbox/sign+date), then:'
    Write-Host '  .\push.ps1 "upload: attach3 filled"'
} else {
    Write-Host ''
    Write-Host '[ERROR] finished but no _filled.doc was written' -ForegroundColor Red
}
Stop-Transcript | Out-Null
