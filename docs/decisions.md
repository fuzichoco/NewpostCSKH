# Quyết định đã chốt

| Thời gian | Quyết định | Lý do |
|---|---|---|
| 10/2026 | Không dùng ChatbotX làm nền, viết hệ thống mới | ChatbotX chạy Docker tốn khoảng 6 GB RAM; chỉ tham khảo hàm nhỏ (MIT, xem `THIRD_PARTY_NOTICES.md`) |
| 10/2026 | Node.js 24 + SQLite có sẵn, không framework, không Docker | Chạy được trên laptop và VPS 1 GB; ít thứ phải bảo trì |
| 10/2026 | Kho kiến thức đưa thẳng vào prompt, chưa dùng RAG | Kho khoảng 20 KB; bảng giá DHL 7.370 dòng nén theo zone còn 11 KB |
| 10/2026 | Nước chưa có trong bảng giá → chuyển nhân viên | Theo yêu cầu công ty, không để AI đoán giá |
| 10/2026 | Hỏi lại AI tối đa 3 lần trước khi chuyển nhân viên | Gemini Flash-Lite chọn chuyển nhân viên ngẫu nhiên khoảng một nửa số lần |
| 10/2026 | Bot nhận lại khách sau 10 phút nếu nhân viên chưa trả lời | Không để khách chờ mà không ai trả lời |
| 10/2026 | Lấy SĐT bằng tin "Yêu cầu chia sẻ thông tin" | Zalo không cho lấy SĐT khi khách chưa đồng ý chia sẻ |
| 10/2026 | Ẩn chức năng gửi tin theo SĐT (ZBS) | Tài khoản ZBS công ty chưa có mẫu tin được duyệt |

## Còn cần chốt

- Bản ghi DNS `cskh.newpostglobal.vn` (bộ phận IT).
- API key AI trả phí của công ty.
- Bảng giá phần 2 và các hãng khác; API tra cứu vận đơn.
