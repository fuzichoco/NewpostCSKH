# Mở hệ thống CSKH: bật tunnel Cloudflare, ghi địa chỉ mới vào .env, rồi chạy server.
# Đóng cửa sổ này hoặc bấm Ctrl+C là hệ thống dừng.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "Newpost Global - CSKH Zalo"

$LINE = "  " + ("─" * 64)
function Step($n, $text) { Write-Host ("  [{0}/4] {1,-34}" -f $n, $text) -NoNewline -ForegroundColor Gray }
function Ok($note = "") { Write-Host " ✔ OK $note" -ForegroundColor Green }
function Fail($msg) {
  Write-Host " ✖" -ForegroundColor Red
  Write-Host ""
  Write-Host "  LỖI: $msg" -ForegroundColor Red
  Write-Host ""
  exit 1
}
function Link($label, $value, $color = "White") {
  Write-Host "  │ " -NoNewline -ForegroundColor DarkGray
  Write-Host ("{0,-22}" -f $label) -NoNewline -ForegroundColor Gray
  Write-Host $value -ForegroundColor $color
}

Clear-Host
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║          NEWPOST GLOBAL  ·  HỆ THỐNG CSKH ZALO OA            ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Step 1 "Kiểm tra máy"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Chưa cài Node.js 24: tải tại https://nodejs.org" }
if (-not (Test-Path .env)) { Fail "Thiếu file .env trong $PSScriptRoot" }
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) { $cf = "C:\Program Files (x86)\cloudflared\cloudflared.exe" }
if (-not (Test-Path $cf)) { Fail "Chưa cài cloudflared: mở PowerShell chạy  winget install Cloudflare.cloudflared" }
if (-not (Test-Path node_modules)) { npm install --silent | Out-Null }
Ok "(Node $(node -v))"

# Tắt bản cũ còn sót (cửa sổ cũ, lần chạy trước bị treo) để lần mở này luôn chạy được.
Step 2 "Dọn bản cũ còn chạy"
$killed = 0
foreach ($c in Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
  $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
  if (-not $p) { continue }
  if ($p.ProcessName -ne "node") { Fail "Cổng 3000 đang bị chương trình $($p.ProcessName) dùng. Tắt chương trình đó rồi mở lại." }
  Stop-Process $p -Force; $killed++
}
Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" |
  Where-Object { $_.CommandLine -like "*localhost:3000*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $killed++ }
Start-Sleep 1
Ok $(if ($killed) { "(đã tắt $killed tiến trình cũ)" } else { "" })

Step 3 "Mở tunnel Cloudflare"
$log = Join-Path $env:TEMP "cskh-tunnel.log"
Remove-Item $log -ErrorAction SilentlyContinue
$tunnel = Start-Process $cf -ArgumentList "tunnel", "--no-autoupdate", "--url", "http://localhost:3000" `
  -RedirectStandardError $log -WindowStyle Hidden -PassThru
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep 1
  $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($m) { $url = $m.Matches[0].Value }
}
if (-not $url) { Stop-Process $tunnel -ErrorAction SilentlyContinue; Fail "Không mở được tunnel, kiểm tra mạng rồi chạy lại." }
Ok "($i giây)"

Step 4 "Ghi địa chỉ mới vào .env"
$envText = [IO.File]::ReadAllText("$PSScriptRoot\.env") -replace "(?m)^PUBLIC_URL=.*$", "PUBLIC_URL=$url"
[IO.File]::WriteAllText("$PSScriptRoot\.env", $envText, (New-Object Text.UTF8Encoding $false))
Ok

$admin = "$url/admin"
try { Set-Clipboard $admin } catch {}

Write-Host ""
Write-Host "  ✅ HỆ THỐNG ĐÃ MỞ" -ForegroundColor Green
Write-Host ""
Write-Host "  ┌─ TRANG QUẢN TRỊ ─────────────────────────────────────────────" -ForegroundColor DarkGray
Link "Mở từ mọi máy" $admin "Cyan"
Link "Trên máy này" "http://localhost:3000/admin" "Cyan"
Link "" "(link đã được copy, dán vào trình duyệt là mở)" "DarkGray"
Write-Host "  └──────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ┌─ DÁN 3 LINK NÀY LÊN developers.zalo.me (app CSKH NEWPOST GLOBAL)" -ForegroundColor Yellow
Link "1. Xác thực domain" "$url/"
Link "2. OA Callback Url" "$url/admin/zalo/callback"
Link "3. Webhook URL" "$url/webhook/zalo"
Write-Host "  └──────────────────────────────────────────────────────────────" -ForegroundColor Yellow
Write-Host ""
Write-Host "  ⚠  Giữ cửa sổ này mở (thu nhỏ được). Đóng cửa sổ = bot ngừng trả lời khách." -ForegroundColor Magenta
Write-Host ""
Write-Host "$LINE" -ForegroundColor DarkGray
Write-Host "  NHẬT KÝ HỆ THỐNG" -ForegroundColor DarkGray
Write-Host "$LINE" -ForegroundColor DarkGray

# Server lỗi hay bị tắt ngang thì tự chạy lại; chỉ dừng khi đóng cửa sổ / Ctrl+C.
try {
  while ($true) {
    npm start --silent
    # Tunnel tắt (thường do vừa mở start.bat ở cửa sổ khác): dừng hẳn, không tranh cổng với bản mới.
    if ($tunnel.HasExited) {
      Write-Host "  ✖ Tunnel đã ngắt nên cửa sổ này dừng. Nếu không có cửa sổ hệ thống nào khác đang mở: chạy lại start.bat và cập nhật 3 link mới trên Zalo." -ForegroundColor Red
      break
    }
    Write-Host "  ↻ Server vừa dừng, tự khởi động lại sau 5 giây..." -ForegroundColor Yellow
    Start-Sleep 5
  }
} finally { Stop-Process $tunnel -ErrorAction SilentlyContinue }
