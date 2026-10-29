# Gửi tin theo số điện thoại (ZBS) – đang ẩn

Mã nguồn: `src/zns.ts`

- Gửi mẫu tin ZBS Template Message đã được Zalo duyệt tới SĐT; tính phí theo tin.
- Bật bằng `ZNS_ENABLED=1` trong `.env` khi tài khoản ZBS công ty có mẫu tin được duyệt và có số dư.
- Mỗi số chỉ nhận 1 lần cho mỗi mẫu; danh sách khách từ chối nhận tin không bao giờ được gửi.
