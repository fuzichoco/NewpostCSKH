# Trang quản trị

Mã nguồn: `src/server.ts` → `handleAdmin`, `src/views.ts`

- Đăng nhập bằng `ADMIN_PASSWORD`: cookie ký HMAC 7 ngày, khóa 15 phút sau 5 lần sai, chặn form từ trang lạ (CSRF).
- **Hội thoại**: khách chờ nhân viên ở trên cùng. Trong một hội thoại: gửi tin không tải lại trang, tin mới tự hiện mỗi 3 giây, Enter để gửi (Shift+Enter xuống dòng).
- **Chat thử**: nhắn như khách, không gửi qua Zalo.
- **Kiến thức & giọng văn**: sửa `data/prompt.md`, `data/knowledge.md`, tin hỏi thăm.
- **Model AI**: chọn hãng, model, API key.
