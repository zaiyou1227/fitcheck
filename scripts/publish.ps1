# ===========================================================
# 认证之后一步到位：建仓库 -> 推送 -> 开启 Pages
# 前提：已经 gh auth login 成功
# 用法：powershell -ExecutionPolicy Bypass -File scripts/publish.ps1
# ===========================================================

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Step($m) { Write-Host ""; Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    注意 $m" -ForegroundColor Yellow }
function Die($m)  {
  Write-Host ""
  Write-Host "失败：$m" -ForegroundColor Red
  exit 1
}

$Gh = "C:\Program Files\GitHub CLI\gh.exe"
if (-not (Test-Path $Gh)) {
  $cmd = Get-Command gh -ErrorAction SilentlyContinue
  if ($cmd) { $Gh = $cmd.Source } else { Die "没找到 gh，先运行 winget install GitHub.cli" }
}

Write-Host ""
Write-Host "  尺码助手 · 发布到 GitHub" -ForegroundColor White
Write-Host "  ----------------------------------------" -ForegroundColor DarkGray

# ---------- 1. 检查登录 ----------
Step "检查 GitHub 登录状态"

$status = & $Gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
  Die "还没登录。先运行 gh auth login --web --git-protocol https 再重试。"
}
$user = & $Gh api user --jq .login 2>$null
if (-not $user) { Die "拿不到用户名，登录可能不完整。" }
Ok "已登录：$user"

# ---------- 2. 仓库名 ----------
Step "确认仓库名"

$repoName = "fitcheck"
if ($args.Count -ge 1) {
  $candidate = $args | Where-Object { $_ -and -not $_.ToString().StartsWith("-") } | Select-Object -First 1
  if ($candidate -and -not [string]::IsNullOrWhiteSpace($candidate.ToString())) {
    $repoName = $candidate.ToString().Trim()
  }
}
Ok "仓库名：$repoName"

$desc = "尺码助手：按围度买衣服，不按码数买。纯前端、离线可用、数据只存本地。"

# ---------- 3. 建仓库 ----------
Step "创建仓库 $user/$repoName"

$exists = $false
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $Gh repo view "$user/$repoName" --json name 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  $exists = $true
  Warn "仓库已存在，将直接推送（不会覆盖历史）"
}
$ErrorActionPreference = $prevEap

if (-not $exists) {
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $Gh repo create $repoName --private --description $desc --disable-wiki 2>&1 | Out-Null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($code -ne 0) { Die "创建仓库失败，检查网络或权限。" }
  Ok "已创建（私有）"
}

# ---------- 4. 推送 ----------
Step "推送代码"

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"

& $Gh auth setup-git 2>&1 | Out-Null

$remote = "https://github.com/$user/$repoName.git"
$current = git remote get-url origin 2>&1
if ($LASTEXITCODE -eq 0 -and $current) {
  git remote set-url origin $remote 2>&1 | Out-Null
} else {
  git remote add origin $remote 2>&1 | Out-Null
}

git branch -M main 2>&1 | Out-Null
git push -u origin main 2>&1 | Out-Null
$pushCode = $LASTEXITCODE
$ErrorActionPreference = $prevEap

if ($pushCode -ne 0) { Die "推送失败，检查网络或仓库状态。" }
Ok "已推送 main 分支"

# ---------- 5. 开启 Pages ----------
Step "开启 GitHub Pages"

# 免费账号的私有仓库不支持 Pages，必须先转公开
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$vis = & $Gh api "repos/$user/$repoName" --jq .visibility 2>&1
$ErrorActionPreference = $prevEap

if ($vis -ne "public") {
  Warn "当前是 $vis 仓库。GitHub 免费账号的私有仓库不支持 Pages，正在转为公开。"
  Warn "仓库里只有代码和文档，不含任何身体数据。"
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $Gh repo edit "$user/$repoName" --visibility public --accept-visibility-change-consequences 2>&1 | Out-Null
  $ErrorActionPreference = $prevEap
  if ($LASTEXITCODE -ne 0) {
    Die "转公开失败。也可以手动去 Settings 改成 Public，再重跑本脚本。"
  }
  Ok "已转为公开仓库"
}

$body = '{"build_type":"workflow"}'
$tmp = Join-Path $env:TEMP ("gh-pages-" + [guid]::NewGuid().ToString("N") + ".json")
[System.IO.File]::WriteAllText($tmp, $body, (New-Object System.Text.UTF8Encoding($false)))

$pagesOk = $false
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"

$out = & $Gh api -X POST "repos/$user/$repoName/pages" -H "Accept: application/vnd.github+json" --input $tmp 2>&1
$code = $LASTEXITCODE
if ($code -eq 0) { $pagesOk = $true }
# 409 = 已经开通过，也算成功
if (-not $pagesOk -and ($out -join " ") -match "409|already enabled|Exists") { $pagesOk = $true }

if (-not $pagesOk) {
  & $Gh api -X PUT "repos/$user/$repoName/pages" -H "Accept: application/vnd.github+json" --input $tmp 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $pagesOk = $true }
}

$ErrorActionPreference = $prevEap
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

if ($pagesOk) {
  Ok "Pages 已设为 GitHub Actions"
  # 触发一次部署，让站点立刻生效
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $Gh workflow run pages.yml --repo "$user/$repoName" 2>&1 | Out-Null
  $ErrorActionPreference = $prevEap
  Ok "已触发部署"
} else {
  Warn "自动开启失败，手动开：仓库 Settings -> Pages -> Source 选 GitHub Actions"
}

# ---------- 6. 结果 ----------
$pagesUrl = "https://$user.github.io/$repoName/"

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Green
Write-Host "  发布完成" -ForegroundColor Green
Write-Host "  ========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  仓库：https://github.com/$user/$repoName" -ForegroundColor Cyan
Write-Host "  站点：$pagesUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "  站点可能等 1-2 分钟才生效（Actions 正在构建）。"
Write-Host "  构建进度：https://github.com/$user/$repoName/actions"
Write-Host ""
Write-Host "  手机上打开站点地址，浏览器菜单里选「添加到主屏幕」。"
Write-Host ""
