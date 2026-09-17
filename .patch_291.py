#!/usr/bin/env python3
"""v2.9.1: fix the account pin (helper form + mandatory empty reset + verify)."""
import sys, io

def patch(path, pairs):
    s = io.open(path, encoding='utf-8').read()
    for marker, old, new, tag in pairs:
        if marker and marker in s:
            print('[skip] %s: %s' % (path, tag)); continue
        c = s.count(old)
        if c != 1:
            print('[FAIL] %s: anchor "%s" found %d times' % (path, tag, c)); sys.exit(1)
        s = s.replace(old, new, 1); print('[ok] %s: %s' % (path, tag))
    io.open(path, 'w', encoding='utf-8', newline='').write(s)

# ---------------------------------------------------------- auth.ps1 helpers
patch('skills/git-sync/scripts/auth.ps1', [
(
 "function Reset-LocalHelperList",
 """function Show-Accounts {""",
 """function Test-LocalHelperReset {
    # the reset is in place when the FIRST local credential.helper entry is empty
    $r = GitG @('config', '--local', '--get-all', 'credential.helper')
    if ($r.code -ne 0) { return $false }
    $first = ($r.text -split "`r?`n", 2)[0]
    return ($first -eq '')
}
function Reset-LocalHelperList {
    # An EMPTY credential.helper value drops every helper collected so far -
    # the machine-level ones (GCM / gh's global helper = the ACTIVE account)
    # included. Without it a local pin changes nothing at all, because those
    # machine helpers are consulted FIRST and answer with the wrong account.
    #
    # Writing an EMPTY ARGUMENT is unreliable on Windows: cmd/MSYS can drop it,
    # then `git config key ""` degrades into a READ that exits 1 - exactly how
    # the first version of this feature failed in the field (2026-09-17,
    # "could not write the local pin:" with an empty detail). So try three
    # routes and verify after each one:
    #   argv  - git config --local --replace-all credential.helper ""
    #   stdin - git config --stdin (git >= 2.45), empty value line, no argv
    #   file  - insert the entry into .git/config by hand (always works)
    $null = GitG @('config', '--local', '--replace-all', 'credential.helper', '')
    if (Test-LocalHelperReset) { return 'argv' }

    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        [System.IO.File]::WriteAllText($tmp, "credential.helper`n`n", (New-Object System.Text.UTF8Encoding($false)))
        $r = RunLine ('git config --local --stdin < "' + $tmp + '"')
        if ($r.code -eq 0 -and (Test-LocalHelperReset)) { return 'stdin' }
    } catch { } finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }

    # last resort: edit the config text. The entry has to come FIRST in the
    # [credential] section - the reset only drops what git has already read.
    $cfgRel = (GitG @('rev-parse', '--git-path', 'config')).text.Trim()
    if (-not $cfgRel) { return '' }
    $cfgAbs = if ([System.IO.Path]::IsPathRooted($cfgRel)) { $cfgRel } else { Join-Path $repo $cfgRel }
    if (-not (Test-Path -LiteralPath $cfgAbs)) { return '' }
    try {
        $raw = [System.IO.File]::ReadAllText($cfgAbs)
        $nl = if ($raw -match "`r`n") { "`r`n" } else { "`n" }
        $out = New-Object System.Collections.ArrayList
        $done = $false
        foreach ($ln in ($raw -split "`r?`n")) {
            $null = $out.Add($ln)
            if (-not $done -and $ln -match '^\\s*\\[credential\\]\\s*$') {
                $null = $out.Add("`thelper = ")
                $done = $true
            }
        }
        if (-not $done) {
            $null = $out.Insert(0, '')
            $null = $out.Insert(0, "`thelper = ")
            $null = $out.Insert(0, '[credential]')
        }
        [System.IO.File]::WriteAllText($cfgAbs, ($out -join $nl), (New-Object System.Text.UTF8Encoding($false)))
        if (Test-LocalHelperReset) { return 'file' }
    } catch { }
    return ''
}

function Show-Accounts {""",
 'reset helpers'),

(
 "SYNTAX ERROR (field case",
 """        # Full path on purpose: the credential helper runs from git's own shell,
        # where PATH may differ from the console's (and session 0 has none).
        $ghExe = ''
        $gc = Get-Command gh -ErrorAction SilentlyContinue
        if ($gc -and $gc.Source) { $ghExe = [string]$gc.Source }
        $q = if ($ghExe) { "'" + $ghExe + "'" } else { 'gh' }
        # Fail CLOSED: when the account has no token any more, the helper exits
        # non-zero instead of quietly handing out the ACTIVE account's token
        # (an empty GH_TOKEN makes gh fall back to the active account - that
        # would silently push as the wrong user). No double quotes anywhere, so
        # the value survives the trip through cmd unchanged.
        #   !if T=$(... auth token -u NAME); then GH_TOKEN=$T ... git-credential; else exit 1; fi
        $pin = '!if T=$(' + $q + ' auth token -u ' + $Account + '); then GH_TOKEN=$T ' + $q + ' auth git-credential; else exit 1; fi'
        # An EMPTY credential.helper value RESETS the accumulated helper list.
        # Without that reset git asks the machine-wide helpers FIRST (GCM, or the
        # global gh helper = the ACTIVE account) and the pin is never consulted -
        # which is exactly how "I set the helper and nothing changed" happens.
        $r1 = GitG @('config', '--local', 'credential.helper', '')
        $r2 = GitG @('config', '--local', '--add', 'credential.helper', $pin)
        if ($r1.code -ne 0 -or $r2.code -ne 0) {
            Bad "could not write the local pin: $(Brief $r2.text 2)"
            exit 1
        }
        Ok "this clone now authenticates as '$Account' (local git config of this folder)"
        $null = $changed.Add("credential.helper (local) pinned to gh account $Account")
        if ($cfgState.helper -and $cfgState.helper -notmatch '"') {
            # Keep the machine-wide helper as a FALLBACK - it is consulted only
            # when the pin yields nothing (another host, or gh logged out).
            # Skipped when the value contains double quotes: re-quoting such a
            # value through cmd risks writing a broken helper entry, and a bad
            # fallback is worse than none (the probe below would catch it).
            $r3 = GitG @('config', '--local', '--add', 'credential.helper', $cfgState.helper)
            if ($r3.code -eq 0) { Note "fallback kept after the pin: $($cfgState.helper)" }
        } elseif ($cfgState.helper) {
            Note 'machine-wide helper not re-added as a fallback (it contains quotes)'
            Note 'if the pin ever fails you get a clear error instead of the wrong account'
        }
        $null = $notes.Add("account pin: $Account")""",
 """        # The helper command. git runs a '!'-helper as
        #     sh -c '<value> "$@"' '<value>' get
        # - it APPENDS "$@" - so the value has to be a function that is then
        # CALLED:
        #     !f() { ...; }; f    ->  f get             OK
        #     !if ...; fi         ->  if ...; fi get    SYNTAX ERROR
        # The second form was shipped in v2.9.0 and never worked: git failed with
        # "syntax error near unexpected token `get'" (field case 2026-09-17).
        # Fail CLOSED on purpose: with no token for that account the helper exits
        # non-zero instead of handing out the ACTIVE account's token (an empty
        # GH_TOKEN makes gh fall back to the active account = wrong user).
        # No double quotes anywhere (the value travels through cmd), forward
        # slashes in the path (works in both the Git shell and cmd).
        $ghExe = ''
        $gc = Get-Command gh -ErrorAction SilentlyContinue
        if ($gc -and $gc.Source) { $ghExe = [string]$gc.Source }
        $ghFwd = if ($ghExe) { $ghExe -replace '\\\\', '/' } else { 'gh' }
        $q = if ($ghExe) { "'" + $ghFwd + "'" } else { $ghFwd }
        $pin = '!f() { T=$(' + $q + ' auth token -u ' + $Account + ') || exit 1; GH_TOKEN=$T ' + $q + ' auth git-credential $@; }; f'

        $resetHow = Reset-LocalHelperList
        if (-not $resetHow) {
            Bad 'could not put the empty (resetting) entry into the local helper list'
            Note 'do it by hand and re-run -Account:'
            Note '   git config --local --replace-all credential.helper ""'
            exit 1
        }
        $r2 = GitG @('config', '--local', '--add', 'credential.helper', $pin)
        $listTxt = (GitG @('config', '--local', '--get-all', 'credential.helper')).text
        if ($r2.code -ne 0 -or $listTxt -notmatch [regex]::Escape("auth token -u $Account")) {
            Bad "could not write the pin (exit $($r2.code))"
            if ($r2.text) { Note "git said: $(Brief $r2.text 2)" }
            Note ("local list now: " + (($listTxt -split "`r?`n") -join ' | '))
            exit 1
        }
        Ok "this clone now authenticates as '$Account' (empty reset via $resetHow + pin)"
        Note 'no fallback is added after the pin on purpose: if that account loses its'
        Note 'token the push FAILS instead of silently using the machine default'
        $null = $changed.Add("credential.helper (local) pinned to gh account $Account")
        $null = $notes.Add("account pin: $Account (reset via $resetHow)")""",
 'pin write block'),
])

print('[done]')
