# Bot trả lời bằng AI

Mã nguồn: `src/bot.ts` → `answer`, `aiReply`, `finish`; `src/ai.ts`

- Chờ khách ngừng nhắn 15 giây rồi đọc hết các tin gửi liền nhau, trả lời một lần; khách nhắn thêm lúc AI đang soạn thì bỏ câu đã soạn và soạn lại. Dùng 20 tin gần nhất làm ngữ cảnh.
- Prompt = `data/prompt.md` + quy tắc bắt buộc + danh sách ảnh + thông tin khách + `data/knowledge.md` (đọc lại mỗi lần, sửa trên trang quản trị là có hiệu lực ngay).
- AI lỗi hoặc trả `[CHUYEN_NHAN_VIEN]` → hỏi lại tối đa 3 lần (`AI_TRIES`), cách nhau 2 giây.
- Hỗ trợ Gemini, OpenAI, Anthropic; đổi trên trang **Model AI** (thử một câu trước khi lưu).
