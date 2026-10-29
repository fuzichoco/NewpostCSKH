# Quy trình làm việc

## Nhánh

- `main`: bản đang chạy trên VPS. Không push thẳng; đi qua Pull Request.
- Nhánh làm việc: `feat/…` (chức năng), `fix/…` (sửa lỗi), `docs/…` (tài liệu).

## Trước khi mở Pull Request

1. `npm run check` không lỗi, `npm test` qua hết (CI chạy lại tự động).
2. Thay đổi cách bot trả lời → thử trên trang **Chat thử** với vài câu thật.
3. Thêm hoặc đổi chức năng → cập nhật `docs/features/` và `docs/data-contracts.md`.
4. Commit theo dạng `feat: …`, `fix: …`, `docs: …`, viết tiếng Việt.

## Quy ước code

- TypeScript chạy thẳng bằng Node 24 (`node --env-file=.env src/server.ts`), không build.
- Ưu tiên thư viện có sẵn của Node (`node:sqlite`, `node:http`, `fetch`); thêm thư viện ngoài phải có lý do.
- Chú thích bằng tiếng Việt, ngắn, giải thích **vì sao**. Chỗ cố ý làm đơn giản đánh dấu `ponytail:` kèm giới hạn và hướng nâng cấp.
- Không đưa bí mật vào code hay Git: dùng `.env`.

## Đưa lên VPS

Sau khi gộp vào `main`: xem `docs/deploy-vps.md` mục **Cập nhật phiên bản**.
