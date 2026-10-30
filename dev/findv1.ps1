$ErrorActionPreference = "Continue"
$adb = if ($env:ANDROID_HOME) { Join-Path $env:ANDROID_HOME "platform-tools\adb.exe" } else { "adb" }
$dev = "127.0.0.1:16384"
$t = @("-s", $dev)
$port = 14646
$outFile = Join-Path $PSScriptRoot "v1link.txt"

function Adb([string]$c) { & $adb @t shell $c 2>&1 | Out-Null }

for ($n = 1; $n -le 16; $n++) {
    if ($n -gt 1) {
        Adb "input tap 639 1869"
        Start-Sleep -Milliseconds 2500
        Adb "input tap 435 1766"
        Start-Sleep -Milliseconds 600
        Adb "input text '$n'"
        Start-Sleep -Milliseconds 600
        Adb "input tap 815 1766"
        Start-Sleep -Seconds 10
    }

    try {
        $pages = (Invoke-RestMethod -Uri "http://127.0.0.1:$port/json" -TimeoutSec 10) |
                 Where-Object { $_.type -eq 'page' -and $_.url -eq 'about:blank' }
    } catch { $pages = @() }

    $found = @()
    foreach ($pg in $pages) {
        $out = Join-Path $PSScriptRoot "_scan.json"
        & (Join-Path $PSScriptRoot "cdp.ps1") -Port $port -PageId $pg.id -ExprFile (Join-Path $PSScriptRoot "scan7.js") -OutFile $out 2>&1 | Out-Null
        if (Test-Path $out) {
            try {
                $o = ([System.IO.File]::ReadAllText($out, [System.Text.Encoding]::UTF8)) | ConvertFrom-Json
                if ($o.fpCount -gt 0) { $found += $o.fps }
            } catch { }
            Remove-Item $out -ErrorAction SilentlyContinue
        }
    }

    Write-Output ("page " + $n + " -> " + $found.Count)
    if ($found.Count -gt 0) {
        $found | Out-File -Encoding utf8 $outFile
        Write-Output "FOUND:"
        $found | ForEach-Object { Write-Output ("  " + $_) }
        break
    }
}

