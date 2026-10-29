# Hỏi thăm khách im lặng

Mã nguồn: `src/bot.ts` → `followUp`, `startWorkers`

- Bot trả lời xong mà khách im lặng 2 giờ → gửi 1 tin hỏi thăm; mỗi lần khách im lặng chỉ hỏi 1 lần.
- Chỉ gửi 8h–21h, bỏ qua nếu im lặng quá 20 giờ, khách đang chờ nhân viên hoặc vừa chốt đơn.
- Nội dung sửa ở trang **Kiến thức & giọng văn**; để trống là tắt.
