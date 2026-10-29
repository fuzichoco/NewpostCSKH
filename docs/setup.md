# Cài đặt trên máy

Yêu cầu: **Node.js 24** (`node -v`) và Git. Không cần Docker hay cơ sở dữ liệu riêng.

```powershell
git clone https://github.com/fuzichoco/NewpostCSKH.git
cd NewpostCSKH
npm install
copy .env.example .env
notepad .env
npm run dev
```

Mở http://localhost:3000/admin, đăng nhập bằng `ADMIN_PASSWORD`. Mục **Chat thử** dùng được ngay, không cần Zalo.
`data/prompt.md` có sẵn. Kho kiến thức thật `data/knowledge.md` không có trong repo: chưa có thì bot dùng
`data/knowledge.example.md` (giá ví dụ); bấm Lưu ở trang **Kiến thức & giọng văn** là tạo file thật. `data/app.db` tự tạo khi chạy lần đầu.

## Kết nối Zalo OA để thử

⚠ Không chạy bản trên máy cùng lúc với bản đang phục vụ khách trên VPS: refresh token Zalo dùng 1 lần, hai nơi cùng chạy sẽ mất kết nối OA.

1. `cloudflared tunnel --url http://localhost:3000` → lấy địa chỉ `https://….trycloudflare.com`, ghi vào `PUBLIC_URL`. Trên Windows, `start.bat` làm sẵn bước này và in ra 3 link cần dán lên Zalo.
2. developers.zalo.me → ứng dụng: **Xác thực domain** (tiền tố URL), **OA Callback Url** = `PUBLIC_URL/admin/zalo/callback`, **Webhook** = `PUBLIC_URL/webhook/zalo`; bật sự kiện `user_send_*`, `oa_send_*`, `user_submit_info`.
3. `/admin` → **Kết nối Zalo OA**.

## Lệnh

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy, tự khởi động lại khi sửa code |
| `npm start` | Chạy bản chính thức |
| `npm run check` | Kiểm tra kiểu TypeScript |
| `npm test` | Chạy kiểm thử (không gọi AI, không gọi Zalo thật) |
