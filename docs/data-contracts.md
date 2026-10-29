# Hợp đồng dữ liệu

## Bảng SQLite (`data/app.db`)

| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `users` | `id` (Zalo user_id), `name`, `phone` (dạng `84xxxxxxxxx`), `paused_until`, `last_user_at`, `followed_up_at` | Thời gian là mili-giây (`Date.now()`) |
| `messages` | `id`, `user_id`, `role` (`user` / `bot` / `staff`), `text`, `zalo_msg_id` (UNIQUE), `created_at` | Tin không phải chữ lưu dạng `[Gửi hình ảnh] #id tên`, `[Gửi yêu cầu chia sẻ số điện thoại]` |
| `orders` | `user_id`, `phone`, `summary`, `created_at` | Tạo từ thẻ `[DON_HANG]` |
| `images` | `name`, `usage` (gửi khi nào), `file` | File nằm ở `data/images/` |
| `kv` | `key`, `value` | Token Zalo, `ai_provider`, `ai_model`, `ai_key_*`, `bot_enabled`, `follow_up_text` |
| `zns_jobs`, `zns_optout` | | Gửi tin theo SĐT (đang ẩn) |

Thêm cột mới: thêm vào danh sách `ALTER TABLE` ở đầu `src/db.ts` để DB cũ tự nâng cấp.

## Thẻ trong câu trả lời của AI

| Thẻ | Ý nghĩa | Xử lý |
|---|---|---|
| `[CHUYEN_NHAN_VIEN]` | Cần người thật | Hỏi lại AI tối đa 3 lần; vẫn vậy thì gửi câu chuyển nhân viên, bot dừng 10 phút |
| `[GUI_ANH:3]` | Gửi ảnh số 3 | Tải ảnh lên Zalo, gửi sau phần chữ |
| `[DON_HANG] Nước đến: … \| SĐT: …` | Khách chốt đơn | Lưu bảng `orders`, ẩn với khách |
| `[XIN_SDT]` | Cần số điện thoại | Gửi nút "Chia sẻ" nếu chưa có số và 24 giờ qua chưa gửi |

## Biến môi trường

Xem `.env.example`. Bắt buộc: `PUBLIC_URL`, `ZALO_APP_ID`, `ZALO_APP_SECRET`, `ZALO_OA_SECRET_KEY`, `GEMINI_API_KEY`, `ADMIN_PASSWORD`.
Tùy chọn: `HANDOVER_MINUTES` (mặc định 10), `ZNS_ENABLED`, `GEMINI_MODEL`, `PORT`.
