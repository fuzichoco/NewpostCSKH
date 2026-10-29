# Lấy số điện thoại khách

Mã nguồn: `src/bot.ts` → `findPhone`, `phoneRequest`, `onUserInfo`; `src/zalo.ts` → `requestUserInfo`, `userDetail`

- Zalo **không** cho lấy SĐT khi khách chưa đồng ý (`shared_info.phone = 0`).
- Khách gõ số trong tin nhắn → tự nhận (`findPhone`, chuẩn hóa `84xxxxxxxxx`).
- AI thêm `[XIN_SDT]` → hệ thống gửi tin `request_user_info` (ảnh `public/chia-se-sdt.png`); khách bấm **Chia sẻ** → sự kiện `user_submit_info` → lưu SĐT, bot trả lời tiếp. Chỉ gửi khi chưa có số và 24 giờ qua chưa gửi.
- Khách từng chia sẻ thông tin với OA → lấy luôn qua `user/detail` khi khách nhắn.
