# ===========================================================
# 在局域网上开一个临时服务器，让手机通过 Wi-Fi 访问
# 用法：powershell -ExecutionPolicy Bypass -File scripts/serve-lan.ps1
# 只在你自己的局域网内可见，不经过互联网。
# 按 Ctrl+C 停止。
# ===========================================================

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$PublicDir = Join-Path $Root "public"
$Port = 4173

Write-Host ""
Write-Host "  尺码助手 · 局域网预览" -ForegroundColor White
Write-Host "  ----------------------------------------" -ForegroundColor DarkGray

if (-not (Test-Path (Join-Path $PublicDir "index.html"))) {
  Write-Host "  找不到 public/index.html，请在仓库目录下运行。" -ForegroundColor Red
  exit 1
}

# 找一个 Node
$node = $null
foreach ($cand in @("node", "$env:ProgramFiles\nodejs\node.exe")) {
  try {
    $null = & $cand --version 2>$null
    if ($LASTEXITCODE -eq 0) { $node = $cand; break }
  } catch {}
}

if (-not $node) {
  Write-Host "  没找到 Node.js。装一个 Node，或改用 PWA 方案。" -ForegroundColor Yellow
  exit 1
}

# 取本机局域网 IP：只保留真正的私有网段，排除虚拟网卡 / VPN
$ips = @()
try {
  $ips = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and
      $_.IPAddress -notmatch '^(192\.168\.56\.1|192\.168\.83\.1|192\.168\.200\.1)$'
    } |
    Select-Object -ExpandProperty IPAddress
} catch {
  $ips = (ipconfig | Select-String "IPv4.*?(\d+\.\d+\.\d+\.\d+)") |
    ForEach-Object { $_.Matches[0].Groups[1].Value }
  $ips = $ips | Where-Object { $_ -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' }
}
$ips = $ips | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -Unique

if (-not $ips) {
  Write-Host "  没找到局域网地址，检查电脑是否连着 Wi-Fi。" -ForegroundColor Yellow
}

# 极简静态服务器，不依赖 npm 包
$serverJs = @'
const http = require("http");
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const port = Number(process.argv[3] || 4173);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404");
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  res.end(fs.readFileSync(file));
}).listen(port, "0.0.0.0", () => console.log("READY"));
'@

$tmp = Join-Path $env:TEMP ("dachu-serve-" + [guid]::NewGuid().ToString("N") + ".cjs")
Set-Content -Path $tmp -Value $serverJs -Encoding UTF8

Write-Host ""
Write-Host "  在手机浏览器里打开下面任意一个地址：" -ForegroundColor White
Write-Host ""
foreach ($ip in $ips) {
  Write-Host ("    http://" + $ip + ":" + $Port + "/") -ForegroundColor Cyan
}
Write-Host ""
Write-Host "  前提：手机和电脑连的是同一个 Wi-Fi。" -ForegroundColor Gray
Write-Host "  第一次连可能弹防火墙提示，选「允许」。" -ForegroundColor Gray
Write-Host "  按 Ctrl+C 停止服务。" -ForegroundColor Gray
Write-Host ""

try {
  & $node $tmp $PublicDir $Port
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
