param([switch]$Yes)

$ErrorActionPreference = "Stop"

$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$payload = Join-Path $root "payload"
$adb     = Join-Path $payload "adb\adb.exe"
$java    = Join-Path $payload "jre\bin\java.exe"
$lspatch = Join-Path $payload "lspatch.jar"
$module  = Join-Path $payload "module.apk"
$bundled = Join-Path $payload "nga.apk"
$pkg     = "gov.pianzong.androidnga"
$work    = Join-Path $env:TEMP ("NGAExt_" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$cacheDir = Join-Path $env:TEMP "NGAExt-cache"
$cacheApk = Join-Path $cacheDir "nga-base.apk"
$cacheMaxDays = 7


function Step($n, $msg) { Write-Host ("[" + $n + "] " + $msg) -ForegroundColor Cyan }
function Ok($msg)       { Write-Host ("  OK  " + $msg) -ForegroundColor Green }
function Warn($msg)     { Write-Host ("  !   " + $msg) -ForegroundColor Yellow }
function Fail($msg)     { Write-Host ("  X   " + $msg) -ForegroundColor Red; exit 1 }

foreach ($f in @($adb, $java, $lspatch, $module)) {
    if (-not (Test-Path $f)) { Fail ("缺少文件: " + $f) }
}

New-Item -ItemType Directory -Force -Path $work | Out-Null

try {
    Step 1 "检测设备"
    $list = @()
    foreach ($line in (& $adb devices)) {
        if ($line -match "^(\S+)\s+device$") { $list += $Matches[1] }
    }
    if ($list.Count -eq 0) {
        Fail "没有检测到设备。请先启动 MuMu 模拟器，或用 USB 连接手机并在弹窗中允许 USB 调试。"
    }
    $serial = $list[0]
    $A = @("-s", $serial)
    if ($list.Count -gt 1) { Warn ("多个设备，使用第一个: " + $serial) }
    $model = (& $adb @A shell getprop ro.product.model) -join ""
    Ok ("设备: " + $model + " (" + $serial + ")")

    Step 2 "定位已安装的 NGA"
    $installed = (& $adb @A shell "pm path $pkg") -join ""
    $isInstalled = $installed -match "package:"

    $baseApk = $null
    if (Test-Path $bundled) {
        $baseApk = $bundled
        Ok "使用安装包内置的原版 APK"
    }
    elseif (-not $isInstalled) {
        Fail "设备上没有安装 NGA。请先从应用商店安装官方版，再运行本安装器。"
    }
    else {
        $remote = ($installed -replace "package:", "").Trim()
        Step 3 "从设备提取已安装的 APK"
        $pulled = Join-Path $work "base.apk"
        & $adb @A pull $remote $pulled | Out-Null
        if (-not (Test-Path $pulled) -or ((Get-Item $pulled).Length -lt 10MB)) {
            Fail "提取失败。请确认设备已授权 USB 调试（手机弹窗点允许）。"
        }
        Ok ("已提取: " + [math]::Round((Get-Item $pulled).Length / 1MB, 1) + " MB")

        $patchedAlready = $false
        try {
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $z = [System.IO.Compression.ZipFile]::OpenRead($pulled)
            foreach ($e in $z.Entries) {
                if ($e.FullName -like "*liblspatch.so*") { $patchedAlready = $true; break }
            }
            $z.Dispose()
        } catch { }

        if ($patchedAlready) {
            Warn "检测到当前装的是增强版（不是官方原版）"
            $useCache = $false
            if (Test-Path $cacheApk) {
                $age = ((Get-Date) - (Get-Item $cacheApk).LastWriteTime).TotalDays
                if ($age -le $cacheMaxDays) {
                    $useCache = $true
                    $baseApk = $cacheApk
                    Ok ("使用临时缓存的原版 APK（" + [math]::Round($age, 1) + " 天前）")
                } else {
                    Warn ("临时缓存已超过 " + $cacheMaxDays + " 天，忽略")
                }
            }
            if (-not $useCache) {
                Fail "无法从增强版反推原版。请先卸载增强版，安装官方 NGA 新版后再运行本安装器。"
            }
        } else {
            $baseApk = $pulled
            try {
                New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
                Copy-Item $pulled $cacheApk -Force
                Ok "原版已缓存到临时目录（7 天后自动失效）"
            } catch { }
        }
    }

    Step 4 "检查 root"
    $isRoot = $false
    try {
        $idOut = (& $adb @A shell "su -c id" 2>$null) -join ""
        if ($idOut -match "uid=0") { $isRoot = $true }
    } catch { }
    if ($isRoot) { Ok "已 root，可迁移数据（保留登录）" } else { Warn "未 root，首次安装会清空登录态" }

    Step 5 "合并模块生成安装包"
    $out = Join-Path $work "out"
    New-Item -ItemType Directory -Force -Path $out | Out-Null
    & $java -jar $lspatch $baseApk -m $module -o $out -l 2 --force | Out-Null
    $patched = Get-ChildItem $out -Filter "*-lspatched.apk" | Select-Object -First 1
    if (-not $patched) { Fail "生成安装包失败（APK 可能不是官方原版）" }
    Ok ("已生成: " + [math]::Round($patched.Length / 1MB, 1) + " MB")

    Step 6 "安装"
    $okInstall = $false
    if ($isInstalled) {
        & $adb @A install -r $patched.FullName | Out-Null
        if ($LASTEXITCODE -eq 0) { $okInstall = $true; Ok "覆盖安装成功，数据与登录保留" }
        else { Warn "签名不同，无法覆盖（官方版场景）" }
    }

    if (-not $okInstall) {
        $backup = $null
        if ($isRoot) {
            Step 7 "备份应用数据"
            & $adb @A shell "su -c 'cd /data/user/0 && tar czf /data/local/tmp/nga_bak.tgz $pkg'" | Out-Null
            $backup = Join-Path $work "nga_bak.tgz"
            & $adb @A pull /data/local/tmp/nga_bak.tgz $backup | Out-Null
            if (-not (Test-Path $backup) -or (Get-Item $backup).Length -eq 0) { $backup = $null; Warn "备份失败" }
            else { Ok "备份完成" }
        }

        if (-not $Yes -and -not $isRoot) {
            Write-Host ""
            Write-Host "  需要卸载现有 NGA 才能安装（会清空登录与缓存）。" -ForegroundColor Yellow
            $ans = Read-Host "  继续? (Y/N)"
            if ($ans -notmatch "^(y|Y)") { Fail "已取消" }
        }

        Step 8 "卸载并安装"
        & $adb @A uninstall $pkg | Out-Null
        & $adb @A install $patched.FullName | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail "安装失败" }
        Ok "安装完成"

        if ($backup) {
            Step 9 "恢复数据"
            $uidOut = (& $adb @A shell "dumpsys package $pkg | grep userId=") -join ""
            if ($uidOut -match "userId=(\d+)") {
                $uid = $Matches[1]
                & $adb @A push $backup /data/local/tmp/nga_bak.tgz | Out-Null
                & $adb @A shell ("su -c 'rm -rf /data/user/0/$pkg && cd /data/user/0 && tar xzf /data/local/tmp/nga_bak.tgz && chown -R " + $uid + ":" + $uid + " $pkg && rm -rf /data/user/0/$pkg/cache /data/user/0/$pkg/code_cache /data/user/0/$pkg/oat && restorecon -R /data/user/0/$pkg'") | Out-Null
                Ok "数据已恢复（登录应保留）"
            } else { Warn "未取到 uid，跳过恢复" }
        }
    }

    Step 10 "启动应用"
    & $adb @A shell "monkey -p $pkg -c android.intent.category.LAUNCHER 1" | Out-Null
    Ok "完成，进入任意帖子即可看到转译卡片"
    & $adb @A shell "rm -f /data/local/tmp/nga_bak.tgz" | Out-Null
}
finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "临时文件已清理。" -ForegroundColor DarkGray
}
