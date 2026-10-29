# Làm việc với GitHub

Repository: [fuzichoco/NewpostCSKH](https://github.com/fuzichoco/NewpostCSKH) · nhánh chính `main` · Public.

```powershell
git clone https://github.com/fuzichoco/NewpostCSKH.git
cd NewpostCSKH
git switch -c feat/ten-chuc-nang
# sửa code, chạy: npm run check ; npm test
git add -A
git commit -m "feat: mô tả ngắn"
git push -u origin feat/ten-chuc-nang
gh pr create --fill
```

Không commit `.env`, `data/app.db`, `data/images/` (đã có trong `.gitignore`).
Nếu lỡ đưa key lên Git: **đổi key ngay** – xóa khỏi lịch sử Git là không đủ.
