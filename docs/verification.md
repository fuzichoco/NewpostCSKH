# Kết quả kiểm tra

## Tự động

`npm run check` (0 lỗi) và `npm test` (21/21). CI chạy lại mỗi lần push hoặc mở Pull Request.

Bao phủ: chữ ký webhook, chống lưu trùng, chuyển nhân viên, hỏi lại AI, nhận SĐT trong tin nhắn, chốt đơn + gửi ảnh,
bot nhận lại khách sau 10 phút, nút chia sẻ SĐT, hỏi thăm 2 giờ, thống kê + CSV, ZBS.

## Đối chiếu báo giá (AI thật, model gemini-flash-lite-latest)

| Câu hỏi | Kết quả |
|---|---|
| 3 kg hàng hóa đi Hàn Quốc | Đúng giá trong bảng (Zone 2, mốc 3 kg) |
| 10 kg, 50 × 40 × 30 cm đi Nhật Bản (quy đổi 12 kg) | Đúng giá trong bảng (Zone 11, mốc 12 kg) |
| Quần áo 5 kg, 20 × 21 × 30 cm đi Trung Quốc | Đúng giá trong bảng (Zone 11, mốc 5 kg), gửi kèm ảnh bảng giá |
| Gửi đi Mỹ (chưa có bảng giá) | Chuyển nhân viên – đúng |
| Khiếu nại hàng móp | Chuyển nhân viên – đúng |

## Chưa kiểm tra trên Zalo thật

- Nút chia sẻ SĐT (`request_user_info`) và sự kiện `user_submit_info`.
