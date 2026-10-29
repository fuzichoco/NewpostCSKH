# Đồng bộ bản đang phát triển (thư mục này) sang bản bàn giao cho công ty.
# Mã nguồn và tài liệu: luôn ghi đè bằng bản mới.
# .env và data/ (mật khẩu, key, hội thoại, token Zalo, kho kiến thức công ty đã sửa): chỉ chép lần đầu, KHÔNG BAO GIỜ ghi đè.
param([string]$Dest = "C:\Jobs\Newpost CSKH")
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Src = $PSScriptRoot

$first = -not (Test-Path $Dest)
New-Item -ItemType Directory -Force "$Dest\data" | Out-Null

# Thư mục mã: chép giống hệt bản phát triển (file đã xoá ở đây cũng xoá bên kia).
foreach ($dir in "src", "test", "public") {
  robocopy "$Src\$dir" "$Dest\$dir" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Chép thư mục $dir lỗi (robocopy $LASTEXITCODE)" }
}
$files = "package.json", "package-lock.json", "tsconfig.json", "start.bat", "start.ps1", ".env.example", ".gitignore",
  "README.md", "HUONG_DAN_VAN_HANH.md", "THIRD_PARTY_NOTICES.md"
foreach ($f in $files) { Copy-Item "$Src\$f" "$Dest\$f" -Force }

# Chỉ chép khi bên bàn giao chưa có, để không mất dữ liệu và thay đổi của công ty.
$keep = ".env", "data\app.db", "data\knowledge.md", "data\prompt.md"
$skipped = @()
foreach ($f in $keep) {
  if (Test-Path "$Dest\$f") { $skipped += $f } else { Copy-Item "$Src\$f" "$Dest\$f" }
}

# Thư viện thay đổi theo package.json: cài lại cho khớp.
Push-Location $Dest
try { npm install --silent --no-audit --no-fund | Out-Null } finally { Pop-Location }

Write-Host ""
Write-Host $(if ($first) { "  ✔ Đã tạo bản bàn giao tại: $Dest" } else { "  ✔ Đã cập nhật bản bàn giao: $Dest" }) -ForegroundColor Green
if ($skipped) { Write-Host "  Giữ nguyên của công ty (không ghi đè): $($skipped -join ', ')" -ForegroundColor DarkGray }
Write-Host "  Kho kiến thức mới cần đưa sang? Sửa trong trang quản trị của bản bàn giao (mục Kiến thức & giọng văn)." -ForegroundColor DarkGray
Write-Host ""
