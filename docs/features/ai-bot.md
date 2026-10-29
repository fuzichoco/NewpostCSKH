# Bot trả lời bằng AI

Mã nguồn: `src/bot.ts` → `answer`, `aiReply`, `finish`; `src/ai.ts`

- Chờ 3 giây gộp các tin khách gửi liền nhau, dùng 20 tin gần nhất làm ngữ cảnh.
- Prompt = `data/prompt.md` + quy tắc bắt buộc + danh sách ảnh + thông tin khách + `data/knowledge.md` (đọc lại mỗi lần, sửa trên trang quản trị là có hiệu lực ngay).
- AI lỗi hoặc trả `[CHUYEN_NHAN_VIEN]` → hỏi lại tối đa 3 lần (`AI_TRIES`), cách nhau 2 giây.
- Hỗ trợ Gemini, OpenAI, Anthropic; đổi trên trang **Model AI** (thử một câu trước khi lưu).
