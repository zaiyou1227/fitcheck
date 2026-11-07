# ===========================================================
# 一键上传到 GitHub
# 用法：在仓库根目录执行
#   powershell -ExecutionPolicy Bypass -File scripts/upload.ps1
#
# 只会用一次你的 token，不写入任何配置文件。
# ===========================================================

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Write-Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    注意 $msg" -ForegroundColor Yellow }
function Fail($msg) {
  Write-Host ""
  Write-Host "失败：$msg" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "  尺码助手 · 一键上传" -ForegroundColor White
Write-Host "  ----------------------------------------" -ForegroundColor DarkGray

# ---------- 1. 检查环境 ----------
Write-Step "检查环境"

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) { Fail "没找到 git。先装 Git：https://git-scm.com/download/win" }
Write-Ok "git $((git --version) -replace 'git version ','')"

if (-not (Test-Path (Join-Path $RepoRoot "public\index.html"))) {
  Fail "当前目录不像项目根目录（找不到 public\index.html）。请在仓库根目录运行此脚本。"
}
Write-Ok "项目文件完整"

# ---------- 2. 输入信息 ----------
Write-Step "填写信息"

$defaultName = "fitcheck"
$repoName = Read-Host "仓库名（回车用默认：$defaultName）"
if ([string]::IsNullOrWhiteSpace($repoName)) { $repoName = $defaultName }
if ($repoName -notmatch '^[A-Za-z0-9._-]+$') { Fail "仓库名只能含字母、数字、点、下划线、连字符" }

$desc = "尺码助手：按围度买衣服，不按码数买。纯前端、离线可用。"

Write-Host ""
Write-Host "需要你的 GitHub Token（只勾选 repo 权限就够了）。" -ForegroundColor Gray
Write-Host "获取地址：https://github.com/settings/tokens" -ForegroundColor Gray
Write-Host "提示：输入时屏幕不会显示字符，这是正常的。" -ForegroundColor Gray
$token = Read-Host "粘贴 Token" -AsSecureString

if (-not $token -or $token.Length -eq 0) { Fail "Token 不能为空" }

# SecureString -> 明文（只在内存里）
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
try {
  $tokenText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ($tokenText -notmatch '^(ghp_|github_pat_)') {
  Write-Warn2 "Token 格式看起来不太对（通常以 ghp_ 或 github_pat_ 开头），继续尝试。"
}

# ---------- 3. 验证 token + 拿用户名 ----------
Write-Step "验证 Token"

$headers = @{
  "Authorization"        = "Bearer $tokenText"
  "Accept"               = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent"           = "fitcheck-upload-script"
}

try {
  $me = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers -Method Get -TimeoutSec 20
} catch {
  Fail "Token 验证失败：$($_.Exception.Message)`n    检查是否复制完整、是否过期、是否勾了 repo 权限。"
}
$owner = $me.login
Write-Ok "已登录：$owner"

# ---------- 4. 创建仓库（已存在则跳过） ----------
Write-Step "创建仓库"

$repoExists = $false
try {
  $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repoName" -Headers $headers -Method Get -TimeoutSec 20
  $repoExists = $true
  Write-Warn2 "仓库 $owner/$repoName 已存在，将直接推送（不会覆盖历史）"
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 404) {
    Write-Warn2 "查询仓库时出错，继续尝试创建"
  }
}

if (-not $repoExists) {
  $body = @{
    name        = $repoName
    description = $desc
    private     = $true
    has_issues  = $true
    has_wiki    = $false
  } | ConvertTo-Json

  try {
    $created = Invoke-RestMethod -Uri "https://api.github.com/user/repos" `
      -Headers $headers -Method Post -Body $body -ContentType "application/json" -TimeoutSec 25
    Write-Ok "已创建：$($created.html_url)"
  } catch {
    Fail "创建仓库失败：$($_.Exception.Message)`n    可能是同名仓库已存在，或 token 权限不足。"
  }
}

# ---------- 5. 本地 git 初始化 ----------
Write-Step "准备本地仓库"

if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
  git init --quiet
  Write-Ok "git init"
} else {
  Write-Ok "已有 .git，继续"
}

git branch -M main 2>$null

# 只在没有配置时才设，避免覆盖用户已有身份
$uname = git config user.name 2>$null
if ([string]::IsNullOrWhiteSpace($uname)) {
  git config user.name "$owner"
  git config user.email "$owner@users.noreply.github.com"
  Write-Ok "设置提交身份为 $owner（可用 git config 改）"
} else {
  Write-Ok "沿用已有提交身份：$uname"
}

git add -A
$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
  Write-Ok "没有新改动"
} else {
  git commit -m "feat: 尺码助手 v1.0.0" --quiet
  Write-Ok "已提交"
}

# ---------- 6. 推送 ----------
Write-Step "推送到 GitHub"

# 不把 token 拼进 remote URL（那会留在 .git/config 里）。
# 用 GIT_ASKPASS 临时喂给 git：token 只存在于进程环境变量中。
$askpass = Join-Path $env:TEMP ("dachu-askpass-" + [guid]::NewGuid().ToString("N") + ".cmd")
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$askpassSrc = Join-Path $scriptDir "git-askpass.cmd"
if (Test-Path $askpassSrc) {
  Copy-Item $askpassSrc $askpass -Force
} else {
  "@echo off`r`necho %DACHU_TOKEN%" | Set-Content $askpass -Encoding ASCII
}

$env:GIT_ASKPASS = $askpass
$env:DACHU_TOKEN = $tokenText
$env:GIT_TERMINAL_PROMPT = "0"

$cleanUrl = "https://github.com/$owner/$repoName.git"
git remote remove origin 2>$null
git remote add origin $cleanUrl

$pushOk = $true
try {
  git -c credential.helper= push -u origin main --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { $pushOk = $false }
} catch {
  $pushOk = $false
}

# 清理：删掉临时 askpass、抹掉环境变量
Remove-Item $askpass -Force -ErrorAction SilentlyContinue
$env:DACHU_TOKEN = $null
$env:GIT_ASKPASS = $null
$env:GIT_TERMINAL_PROMPT = $null

if (-not $pushOk) {
  Fail "推送失败。常见原因：token 没有 repo 权限、或网络问题。`n    仓库已建好，代码还在本地，可稍后重试。"
}
Write-Ok "推送成功"

# 双重保险：确认 remote 是干净地址
git remote set-url origin $cleanUrl
Write-Ok "remote 已设为 $cleanUrl"

# 抹掉内存里的明文
$tokenText = $null
$token = $null

# ---------- 7. 结果 ----------
Write-Host ""
Write-Host "  ========================================" -ForegroundColor Green
Write-Host "  上传完成" -ForegroundColor Green
Write-Host "  ========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  仓库地址：" -NoNewline
Write-Host "https://github.com/$owner/$repoName" -ForegroundColor Cyan
Write-Host ""
Write-Host "  下一步（让手机能打开）：" -ForegroundColor White
Write-Host "  1. 打开仓库 Settings -> Pages"
Write-Host "  2. Source 选 GitHub Actions"
Write-Host "  3. 等 1 分钟，访问：" -NoNewline
Write-Host "https://$owner.github.io/$repoName/" -ForegroundColor Cyan
Write-Host ""
Write-Host "  手机打开后，浏览器菜单里选「添加到主屏幕」。" -ForegroundColor Gray
Write-Host ""
