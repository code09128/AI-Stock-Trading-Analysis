# 股票交易分析系統：手動線上更新（manual_update.ps1）
# 給「程式內的檢查更新連不上 GitHub」時使用（例如 Python 憑證驗證失敗）。
# 做的事和程式內建的線上更新一樣：下載 GitHub 最新正式版（Release），只取出 src\ 與 web\ 放到 update\，
# 寫入 update\version.json；程式下次啟動時就會改用新版。不會動到 data\、.env、logs\。
# 用法：把 manual_update.bat 與本檔放在程式資料夾（exe 所在的資料夾），雙擊 manual_update.bat。
param(
    [string]$AppDir = $PSScriptRoot,
    [string]$Repo = "code09128/AI-Stock-Trading-Analysis"
)

$ErrorActionPreference = "Stop"
$ExeName = "股票交易分析系統.exe"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Fail([string]$msg) {
    Write-Host ""
    Write-Host "更新失敗：$msg" -ForegroundColor Red
    exit 1
}

function Write-Utf8NoBom([string]$path, [string]$text) {
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

# ---------- 1. 確認程式資料夾 ----------
$AppDir = (Resolve-Path $AppDir).Path
$exeHere = Join-Path $AppDir $ExeName
$exeInDist = Join-Path $AppDir ("dist\" + [IO.Path]::GetFileNameWithoutExtension($ExeName) + "\" + $ExeName)
if (Test-Path $exeHere) {
    $exe = $exeHere
} elseif ((Test-Path $exeInDist) -and (Test-Path (Join-Path $AppDir "run.py"))) {
    # 從原始碼專案的 dist\ 執行的打包版：資料夾以專案根目錄為準
    $exe = $exeInDist
    Write-Host "注意：這是原始碼專案資料夾。更新會放在 $AppDir\update，" -ForegroundColor Yellow
    Write-Host "      dist\ 的打包版會套用；用 run.py／start.bat 執行時網頁也會改用 update\web。" -ForegroundColor Yellow
    Write-Host "      原始碼版建議改用 git pull 更新。" -ForegroundColor Yellow
    $ans = Read-Host "仍要繼續嗎？(y/N)"
    if ($ans -notmatch '^[yY]') { Write-Host "已取消。"; exit 0 }
} else {
    Fail "這個資料夾找不到 $ExeName。請把 manual_update.bat 與 manual_update.ps1 放到程式安裝資料夾（exe 所在的位置）再執行。`n目前位置：$AppDir"
}

Write-Host "程式資料夾：$AppDir"

# 程式還開著：更新檔要等重新啟動才會生效，而且舊版在關閉時不會用到 update\，先請使用者關掉比較單純
$running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }
if ($running) {
    Fail "程式還在執行中。請先完全結束程式（系統匣圖示右鍵 →「結束程式」）再執行一次。"
}

# ---------- 2. 查最新正式版 ----------
Write-Host "正在查詢 GitHub 最新版本…"
try {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" `
        -Headers @{ "User-Agent" = "TW-US-Trading-Analyzer-ManualUpdate/1.0"; "Accept" = "application/vnd.github+json" }
} catch {
    Fail "無法連線至 GitHub：$($_.Exception.Message)"
}
$tag = [string]$rel.tag_name
if ($tag -notmatch '^v?(\d+)\.(\d+)\.(\d+)$') { Fail "最新 Release 的標籤「$tag」不是版本號格式" }
$version = "$($Matches[1]).$($Matches[2]).$($Matches[3])"

$updDir = Join-Path $AppDir "update"
$curFile = Join-Path $updDir "version.json"
$cur = $null
if (Test-Path $curFile) {
    try { $cur = (Get-Content $curFile -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { $cur = $null }
}
Write-Host "最新版本：$tag（$($rel.published_at)）"
if ($cur) {
    Write-Host "目前已下載的更新：v$cur"
    if ([version]$cur -ge [version]$version) {
        Write-Host ""
        Write-Host "已經是最新版，不需要更新。" -ForegroundColor Green
        exit 0
    }
} else {
    Write-Host "目前沒有下載過線上更新（使用安裝時內建的版本）"
}

# ---------- 3. 下載並解壓 ----------
$work = Join-Path ([IO.Path]::GetTempPath()) ("trading_update_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $zip = Join-Path $work "release.zip"
    Write-Host "正在下載 $tag …"
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "https://codeload.github.com/$Repo/zip/refs/tags/$tag" -OutFile $zip `
            -Headers @{ "User-Agent" = "TW-US-Trading-Analyzer-ManualUpdate/1.0" }
    } catch {
        Fail "下載失敗：$($_.Exception.Message)"
    }
    $ex = Join-Path $work "x"
    Expand-Archive -Path $zip -DestinationPath $ex -Force
    $root = Get-ChildItem $ex -Directory | Select-Object -First 1
    if (-not $root -or -not (Test-Path (Join-Path $root.FullName "src")) -or -not (Test-Path (Join-Path $root.FullName "web\index.html"))) {
        Fail "更新包結構不完整（缺少 src\ 或 web\index.html）"
    }
    $verPy = Join-Path $root.FullName "src\version.py"
    $codeVer = $null
    if (Test-Path $verPy) {
        $m = Select-String -Path $verPy -Pattern 'APP_VERSION\s*=\s*["''](\d+\.\d+\.\d+)["'']' | Select-Object -First 1
        if ($m) { $codeVer = $m.Matches[0].Groups[1].Value }
    }
    if ($codeVer -ne $version) {
        Fail "Release $tag 裡的程式版本是 $(if ($codeVer) { $codeVer } else { '未標示' })，和標籤不一致，未套用"
    }

    # ---------- 4. 放到 update\（先放暫存資料夾，完整後再換掉，失敗不會留下一半的檔案）----------
    $tmp = Join-Path $AppDir "update_tmp"
    $old = Join-Path $AppDir "update_old"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    New-Item -ItemType Directory -Path $tmp | Out-Null
    Copy-Item (Join-Path $root.FullName "src") (Join-Path $tmp "src") -Recurse
    Copy-Item (Join-Path $root.FullName "web") (Join-Path $tmp "web") -Recurse
    $info = [ordered]@{
        version      = $version
        tag          = $tag
        name         = [string]$rel.name
        published_at = ([string]$rel.published_at).Replace("T", " ").Replace("Z", "")
        updated_at   = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        method       = "manual_update.ps1"
    }
    Write-Utf8NoBom (Join-Path $tmp "version.json") ($info | ConvertTo-Json)
    if (Test-Path $old) { Remove-Item $old -Recurse -Force }
    if (Test-Path $updDir) { Rename-Item $updDir "update_old" }
    Rename-Item $tmp "update"
    if (Test-Path $old) { Remove-Item $old -Recurse -Force }
} finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    $leftover = Join-Path $AppDir "update_tmp"
    if (Test-Path $leftover) { Remove-Item $leftover -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host "更新完成：$tag 已放到 $updDir" -ForegroundColor Green
Write-Host "請重新開啟程式，啟動畫面標題下方會顯示新版本號。"
