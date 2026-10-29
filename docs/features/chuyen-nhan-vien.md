# Chuyển nhân viên và bot nhận lại

Mã nguồn: `src/bot.ts` → `handover`, `resumeAfterHandover`, `staffSend`

- Chuyển khi: khách đòi gặp người (từ khóa trong `HANDOVER_WORDS`), hoặc AI trả `[CHUYEN_NHAN_VIEN]` cả 3 lần. Bot dừng `HANDOVER_MINUTES` (mặc định 10) phút.
- Hết 10 phút mà tin cuối phía OA vẫn là câu chuyển nhân viên (chưa ai trả lời) → bot nhận lại: xin lỗi vì để khách chờ, trả lời tiếp; ca khó thì xin SĐT để nhân viên gọi lại. Chỉ xét các lần chuyển trong 6 giờ gần nhất.
- Nhân viên bấm **Nhân viên chat** trên trang quản trị → bot dừng 24 giờ; nhân viên trả lời trong app Zalo OA → bot dừng 60 phút.
