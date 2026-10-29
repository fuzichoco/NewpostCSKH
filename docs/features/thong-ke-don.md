# Thống kê và đơn chốt

Mã nguồn: `src/db.ts` → `customersBetween`, `ordersBetween`; `src/views.ts` → `statsPage`, `statsCsv`

- Khách đồng ý gửi hàng → bot xin đủ thông tin rồi thêm dòng `[DON_HANG] …` (ẩn với khách) → lưu bảng `orders`.
- Trang **Thống kê** theo ngày (giờ Việt Nam): khách nhắn tin, khách mới, khách có SĐT, đơn đã chốt, số lần chuyển nhân viên.
- Tải CSV có BOM để Excel đọc đúng tiếng Việt.
