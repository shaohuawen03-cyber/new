# fill_reason.ps1 - fill the reason cell of the ORIGINAL form .doc (Word/WPS COM).
#
# The agent must NOT rebuild the form: this script edits a COPY of the user's
# original .doc on the user's own machine, so the format stays 100% original.
# The reason text comes from deliverable/*200*.txt line 3 (index 2).
#
# Usage (inside the repo folder):
#     powershell -NoProfile -ExecutionPolicy Bypass -File code/fill_reason.ps1
#
# Output: deliverable/<original-basename>_filled.doc
# Then open it in Word/WPS to verify, and push it back:
#     .\push.ps1 "upload: filled form"
#
# ASCII-only on purpose (Windows PowerShell 5.1 decodes .ps1 as ANSI/GBK;
# the gate fails any non-ASCII byte, so all messages are English).

$ErrorActionPreference = 'Stop'

# repo root = walk up from this script until .git appears
$repo = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
while ($repo -and -not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
    $up = Split-Path -Parent $repo
    if (-not $up -or $up -eq $repo) { break }
    $repo = $up
}
Set-Location -LiteralPath $repo
if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
    Write-Host '[ERROR] not a git repository' -ForegroundColor Red
    exit 1
}

# also mirror ALL output to a log file, so nothing is lost if the console swallows it
$logFile = Join-Path $repo 'deliverable\fill_reason.last.log'
Start-Transcript -LiteralPath $logFile -Force | Out-Null
Write-Host ('== log: ' + $logFile)

# --- 1. read the reason text (line index 2 of the *200*.txt) ---
$txt = Get-ChildItem -LiteralPath (Join-Path $repo 'deliverable') -Filter '*.txt' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '200' } | Select-Object -First 1
if (-not $txt) {
    Write-Host '[ERROR] deliverable/*200*.txt not found - run .\sync.ps1 first' -ForegroundColor Red
    exit 1
}
$lines = @(Get-Content -LiteralPath $txt.FullName -Encoding UTF8)
if ($lines.Count -lt 3) {
    Write-Host '[ERROR] unexpected format in reason txt (need >= 3 lines)' -ForegroundColor Red
    exit 1
}
$reason = $lines[2]
if ($reason.Length -lt 200 -or $reason.Length -gt 300) {
    Write-Host ('[ERROR] reason line has unexpected length: ' + $reason.Length) -ForegroundColor Red
    exit 1
}
Write-Host ('== reason: ' + $reason.Length + ' chars from ' + $txt.Name)

# --- 2. locate the ORIGINAL .doc (extension exactly .doc, not .docx) ---
$src = Get-ChildItem -LiteralPath (Join-Path $repo 'sources') -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -eq '.doc' } | Select-Object -First 1
if (-not $src) {
    Write-Host '[ERROR] sources/*.doc not found - run .\sync.ps1 first' -ForegroundColor Red
    exit 1
}
$destDir = Join-Path $repo 'deliverable'
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$dest = Join-Path $destDir ($src.BaseName + '_filled.doc')
Write-Host ('== source: ' + $src.Name)
Write-Host ('== output: ' + (Split-Path -Leaf $dest))

# --- 3. start Word (or WPS Writer) via COM ---
$app = $null
$progIds = @('Word.Application', 'KWPS.Application')
foreach ($id in $progIds) {
    try {
        $app = New-Object -ComObject $id -ErrorAction Stop
        Write-Host ('== office: ' + $id)
        break
    } catch { }
}
if (-not $app) {
    Write-Host '[ERROR] neither Word nor WPS found (need Word.Application or KWPS.Application)' -ForegroundColor Red
    exit 1
}

try {
    $app.Visible = $false
    $app.DisplayAlerts = 0
    # open read-only so sources/ is never modified
    $doc = $app.Documents.Open($src.FullName, $false, $true)
    try {
        # --- 4. find the label cell holding '(200' and take the NEXT cell ---
        $target = $null
        foreach ($table in @($doc.Tables)) {
            foreach ($row in @($table.Rows)) {
                foreach ($cell in @($row.Cells)) {
                    $t = $cell.Range.Text
                    if ($t -and $t.Contains('(200')) {
                        $target = $cell.Next
                        break
                    }
                }
                if ($target) { break }
            }
            if ($target) { break }
        }
        if (-not $target) {
            Write-Host "[ERROR] label cell '(200' not found in the form" -ForegroundColor Red
            exit 1
        }
        $before = $target.Range.Text
        Write-Host ('== cell before: ' + $before.Length + ' chars (old draft + pasted snippet)')

        # --- 5. replace the cell content (keep the end-of-cell mark) ---
        $rng = $target.Range
        $rng.SetRange($rng.Start, $rng.End - 2)
        $rng.Text = $reason

        # --- 6. read back and verify ---
        $after = $target.Range.Text
        $head = $reason.Substring(0, 20)
        $tail = $reason.Substring($reason.Length - 10, 10)
        if (-not ($after.Contains($head) -and $after.Contains($tail))) {
            Write-Host '[ERROR] read-back mismatch - the cell was not filled as expected' -ForegroundColor Red
            exit 1
        }
        Write-Host ('== cell after: ' + $after.Length + ' chars, head+tail verified')

        # --- 7. save beside the deliverables, keep the .doc format ---
        if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
        $doc.SaveAs($dest)
        Write-Host ('OK: wrote ' + $dest)
    } finally {
        $doc.Close($false)
    }
} finally {
    try { $app.Quit() } catch { }
    if ($app) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
}

Write-Host ''
Write-Host 'next: open the _filled.doc in Word/WPS and check the reason cell, then:'
Write-Host '  .\push.ps1 "upload: filled form"'

# --- end-game: did we actually get a file? (catch silent no-output runs) ---
if (Test-Path -LiteralPath $dest) {
    Write-Host ''
    Write-Host 'next: open the _filled.doc in Word/WPS and check the reason cell, then:'
    Write-Host '  .\push.ps1 "upload: filled form"'
} else {
    Write-Host ''
    Write-Host '[ERROR] finished but NO _filled.doc was written - look for a red [ERROR] line above' -ForegroundColor Red
    Write-Host '--- which Office COM answered on this machine ---'
    foreach ($p in @('Word.Application','KWPS.Application','WPS.Application')) {
        try { $n = New-Object -ComObject $p -ErrorAction Stop; Write-Host "  [ok] $p"; try { $n.Quit() } catch {} }
        catch { Write-Host "  [no] $p : $($_.Exception.Message)" }
    }
}
