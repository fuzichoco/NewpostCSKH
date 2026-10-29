# Kiến trúc

Một tiến trình Node.js 24 chạy thẳng file TypeScript, không framework, không Docker. Chỉ phụ thuộc thư viện `@google/genai`.

```text
Khách ── Zalo OA ──webhook HTTPS──▶ src/server.ts ──▶ src/bot.ts ──▶ src/ai.ts ──▶ Gemini / OpenAI / Claude
                                        │                 │
Nhân viên ── trang /admin ──────────────┘                 └──▶ src/zalo.ts ──▶ Zalo OA API (gửi tin, ảnh, nút SĐT)
                                        │
                                   src/db.ts ── data/app.db (SQLite)
```

| File | Vai trò |
|---|---|
| `src/server.ts` | Máy chủ HTTP: `/webhook/zalo`, `/login`, `/admin/*`, ảnh công khai, chống CSRF, đăng nhập |
| `src/bot.ts` | Nghiệp vụ: gộp tin 3 giây, gọi AI (hỏi lại tối đa 3 lần), chuyển nhân viên, bot nhận lại sau 10 phút, hỏi thăm 2 giờ, gửi ảnh, nút chia sẻ SĐT, chốt đơn |
| `src/ai.ts` | Ghép prompt (`data/prompt.md` + quy tắc + kho kiến thức + 20 tin gần nhất), gọi 3 hãng AI, định nghĩa các thẻ `[CHUYEN_NHAN_VIEN]`, `[GUI_ANH:id]`, `[DON_HANG]`, `[XIN_SDT]` |
| `src/zalo.ts` | API Zalo: chữ ký webhook, OAuth v4, làm mới token, gửi chữ / ảnh / yêu cầu thông tin, lấy tên + SĐT đã chia sẻ |
| `src/db.ts` | SQLite (`node:sqlite`): bảng, truy vấn, tự thêm cột khi nâng cấp |
| `src/views.ts` | HTML trang quản trị (render phía server, JS nhỏ cho chat trực tiếp) |
| `src/zns.ts` | Gửi tin ZBS theo SĐT – đang ẩn (`ZNS_ENABLED`) |

## Nguyên tắc

- **Webhook trả 200 ngay**, xử lý phía sau; Zalo gửi lặp thì chặn bằng `zalo_msg_id` UNIQUE.
- **Refresh token Zalo dùng 1 lần**: lưu ngay vào DB sau mỗi lần làm mới, chỉ chạy **một** nơi với OA thật.
- **Không tin AI tuyệt đối**: quyết định có hậu quả (chuyển nhân viên, lưu đơn, gửi ảnh, xin SĐT) đi qua thẻ do code kiểm soát; thẻ được ẩn với khách.
- **Một tiến trình**: khóa và bộ đếm nằm trong bộ nhớ (đánh dấu `ponytail:` trong code). Chạy nhiều tiến trình thì phải chuyển khóa vào DB.

## Thêm một chức năng

1. Logic vào `src/bot.ts` (hoặc file mới nếu lớn), truy vấn vào `src/db.ts`.
2. Nếu AI cần ra quyết định: thêm thẻ trong `RULES` của `src/ai.ts`, xử lý thẻ trong `finish()` của `src/bot.ts`.
3. Trang quản trị: hàm render trong `src/views.ts`, route trong `handleAdmin()` của `src/server.ts`, mục menu trong `NAV`.
4. Viết kiểm thử trong `test/` (giả lập AI bằng `fakeAi`), viết tài liệu trong `docs/features/`.
