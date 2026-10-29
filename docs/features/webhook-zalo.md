# Nhận tin từ Zalo (webhook)

Mã nguồn: `src/server.ts` → `handleWebhook`, `src/zalo.ts` → `verifySignature`

- Kiểm tra chữ ký `X-ZEvent-Signature`: `mac = sha256(appId + body thô + timestamp + OA secret key)`, so bằng `timingSafeEqual`. Sai chữ ký vẫn trả 200 (để nút Kiểm tra của Zalo qua) nhưng bỏ qua.
- `user_send_*` → `bot.onUserMessage`; tin không phải chữ lưu dạng `[Khách gửi hình ảnh]`.
- `oa_send_*` → `bot.onOaMessage`: tin do bot/nhân viên trên trang quản trị gửi thì bỏ qua (so nội dung 5 phút gần nhất); còn lại là nhân viên trả lời trong app Zalo OA → bot dừng 60 phút.
- `user_submit_info` → `bot.onUserInfo` (xem `chia-se-sdt.md`).
- Zalo gửi lặp: chặn bằng `zalo_msg_id` UNIQUE.
