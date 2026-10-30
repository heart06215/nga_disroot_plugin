param(
    [string]$Version = "dev",
    [string]$JdkPath = $env:JAVA_HOME,
    [string]$SdkPath = $env:ANDROID_HOME,
    [string]$GradlePath = "",
    [string]$GradleUserHome = $env:GRADLE_USER_HOME,
    [switch]$SkipModuleBuild
)

$ErrorActionPreference = "Stop"

$root    = $PSScriptRoot
$stage   = Join-Path $root "build\NGAExt"
$payload = Join-Path $stage "payload"
$dist    = Join-Path $root "dist"
$installerSrc = Join-Path $root "installer"
$moduleProject = Join-Path $root "ngaext"

function Step([string]$m) { Write-Host "[build] $m" -ForegroundColor Cyan }
function Die([string]$m)  { Write-Host "[error] $m" -ForegroundColor Red; exit 1 }

if (-not $JdkPath -or -not (Test-Path (Join-Path $JdkPath "bin\java.exe"))) {
    Die "JAVA_HOME not set or invalid (need JDK 17)."
}
if (-not $SdkPath) { Die "ANDROID_HOME not set." }

$env:JAVA_HOME = $JdkPath
$env:ANDROID_HOME = $SdkPath
$env:ANDROID_SDK_ROOT = $SdkPath
$java   = Join-Path $JdkPath "bin\java.exe"
$jlink  = Join-Path $JdkPath "bin\jlink.exe"
$adbSrc = Join-Path $SdkPath "platform-tools"

$lspatch = Join-Path $root "tools\lspatch.jar"
if (-not (Test-Path $lspatch)) { $lspatch = Join-Path $root "lspatch.jar" }
if (-not (Test-Path $lspatch)) {
    Die "lspatch.jar not found. Put it at tools\lspatch.jar (download from https://github.com/LSPosed/LSPatch/releases)."
}

Step "clean staging"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $payload | Out-Null

Step "build module apk"
if (-not $SkipModuleBuild) {
    if (-not $GradlePath) {
        $cand = @(
            (Join-Path $root "tools\gradle-8.7\bin\gradle.bat"),
            "gradle"
        )
        foreach ($c in $cand) {
            if ($c -eq "gradle") {
                $cmd = Get-Command gradle -ErrorAction SilentlyContinue
                if ($cmd) { $GradlePath = $cmd.Source; break }
            } elseif (Test-Path $c) { $GradlePath = $c; break }
        }
    }
    if (-not $GradlePath) { Die "gradle not found. Pass -GradlePath." }
    if ($GradleUserHome) { $env:GRADLE_USER_HOME = $GradleUserHome }
    $ErrorActionPreference = "Continue"
    & $GradlePath -p $moduleProject assembleDebug --no-daemon --console=plain 2>&1 | Out-Null
    $gcode = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($gcode -ne 0) { Die "gradle build failed." }
}
$moduleApk = Join-Path $moduleProject "app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $moduleApk)) { Die "module apk not found: $moduleApk" }
Copy-Item $moduleApk (Join-Path $payload "module.apk") -Force

Step "prepare jre (jlink)"
$jreDir = Join-Path $payload "jre"
$ErrorActionPreference = "Continue"
& $jlink --add-modules java.base,java.logging,java.xml,java.naming,java.security.jgss,jdk.crypto.ec,jdk.zipfs `
    --strip-debug --no-header-files --no-man-pages --compress=2 --output $jreDir 2>&1 | Out-Null
$jcode = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($jcode -ne 0) { Die "jlink failed." }

Step "copy adb / lspatch / installer"
$adbDir = Join-Path $payload "adb"
New-Item -ItemType Directory -Force -Path $adbDir | Out-Null
foreach ($f in @("adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll")) {
    Copy-Item (Join-Path $adbSrc $f) (Join-Path $adbDir $f) -Force
}
Copy-Item $lspatch (Join-Path $payload "lspatch.jar") -Force
Copy-Item (Join-Path $installerSrc "install.ps1") (Join-Path $stage "install.ps1") -Force
Copy-Item (Join-Path $installerSrc "Install.bat") (Join-Path $stage "Install.bat") -Force

Step "pack payload"
$zip = Join-Path $root "build\payload.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
$sevenZip = Get-Command 7z -ErrorAction SilentlyContinue
if ($sevenZip) {
    & $sevenZip.Source a -tzip -mx=5 $zip (Join-Path $stage "*") -r | Out-Null
} else {
    Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal
}

Step "compile stub"
$stubCs = Join-Path $installerSrc "Stub.cs"
$stubExe = Join-Path $root "build\stub.exe"
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { Die "csc.exe not found (need .NET Framework 4.x)." }
$ErrorActionPreference = "Continue"
& $csc /nologo /target:exe /out:$stubExe /r:System.IO.Compression.FileSystem.dll $stubCs 2>&1 | Out-Null
$ccode = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($ccode -ne 0) { Die "stub compile failed." }
if (-not (Test-Path $stubExe)) { Die "stub compile failed." }

Step "link self-extractor"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$out = Join-Path $dist ("NGAExt-Setup-" + $Version + ".exe")
$sb = [System.IO.File]::ReadAllBytes($stubExe)
$zb = [System.IO.File]::ReadAllBytes($zip)
$fs = [System.IO.File]::Create($out)
try {
    $fs.Write($sb, 0, $sb.Length)
    $fs.Write($zb, 0, $zb.Length)
    $fs.Write([BitConverter]::GetBytes([int64]$zb.Length), 0, 8)
    $fs.Write([System.Text.Encoding]::ASCII.GetBytes("NGAEXTPK"), 0, 8)
} finally { $fs.Close() }

$size = [math]::Round((Get-Item $out).Length / 1MB, 1)
$hash = (Get-FileHash $out -Algorithm SHA256).Hash
Write-Host ""
Write-Host "OK  $out" -ForegroundColor Green
Write-Host "    size: $size MB"
Write-Host "    sha256: $hash"
