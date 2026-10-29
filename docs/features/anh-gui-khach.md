# Ảnh gửi khách

Mã nguồn: `src/server.ts` → `uploadImage`, `src/zalo.ts` → `sendImage`

- Nhân viên tải ảnh JPG/PNG (≤ 1 MB) hoặc GIF (≤ 5 MB) kèm tên và mô tả **Gửi khi nào**.
- AI thấy danh sách ảnh, thêm `[GUI_ANH:id]` khi tình huống khớp; ảnh đã gửi trong hội thoại thì không gửi lại.
- Gửi: tải ảnh lên `v2.0/oa/upload/image` (hoặc `/gif`) lấy `attachment_id`, rồi gửi tin media qua `v3.0/oa/message/cs`.
