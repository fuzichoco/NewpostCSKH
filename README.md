# NewpostCSKH

Repository: [fuzichoco/NewpostCSKH](https://github.com/fuzichoco/NewpostCSKH) · nhánh chính `main` · Public.

Hệ thống chăm sóc khách hàng tự động qua **Zalo Official Account** cho NewPost Global (chuyển phát nhanh quốc tế).
Khách nhắn OA → AI trả lời theo kho kiến thức công ty: báo giá DHL theo cân nặng và kích thước, quy định đóng gói,
gửi ảnh bảng giá, ghi nhận đơn chốt, xin SĐT bằng nút chia sẻ 1 chạm. Cần người thật thì chuyển nhân viên;
10 phút không ai trả lời thì bot tự nhận lại. Kèm trang quản trị cho nhân viên.

Đang chạy 24/24 trên VPS Ubuntu (Node.js 24 + PM2). **Không cần Docker, Redis hay cơ sở dữ liệu riêng** – SQLite có sẵn trong Node.js.

## Bắt đầu

```powershell
npm install
copy .env.example .env      # điền key, xem giải thích trong file
npm run dev                 # http://localhost:3000/admin
```

Trên Windows có thể bấm đúp `start.bat`: tự mở tunnel HTTPS và in ra 3 link cần dán lên Zalo. Chi tiết: [cài đặt](docs/setup.md).

```powershell
npm run check ; npm test
```

## Cấu trúc

```text
src/
├── server.ts        # HTTP: webhook Zalo, đăng nhập, trang quản trị
├── bot.ts           # Nghiệp vụ: trả lời, chuyển nhân viên, nhận lại, hỏi thăm, ảnh, SĐT, đơn
├── ai.ts            # Prompt, quy tắc, thẻ điều khiển; Gemini / OpenAI / Claude
├── zalo.ts          # Zalo OA API: chữ ký, OAuth, token, gửi tin / ảnh / nút SĐT
├── db.ts            # SQLite: bảng và truy vấn
├── views.ts         # Giao diện trang quản trị
└── zns.ts           # Gửi tin ZBS theo SĐT (đang ẩn)
test/                # Kiểm thử node:test (giả lập AI, không gọi Zalo thật)
data/                # prompt.md, knowledge.example.md (trong Git); knowledge.md, app.db, images/ (không đưa lên Git)
public/              # File xác thực tên miền Zalo, ảnh nút chia sẻ SĐT
docs/                # Kiến trúc, cài đặt, triển khai, quyết định, từng chức năng
.github/             # Mẫu Issue, Pull Request, CI
start.bat, start.ps1 # Mở hệ thống trên Windows bằng một lần bấm
```

## Tài liệu

- [Kiến trúc và cách thêm một chức năng](docs/architecture.md)
- [Hợp đồng dữ liệu: bảng, thẻ AI, biến môi trường](docs/data-contracts.md)
- [Cài đặt trên máy](docs/setup.md) · [Triển khai VPS](docs/deploy-vps.md)
- Chức năng: [webhook Zalo](docs/features/webhook-zalo.md) · [bot AI](docs/features/ai-bot.md) ·
  [chuyển nhân viên](docs/features/chuyen-nhan-vien.md) · [trang quản trị](docs/features/trang-quan-tri.md) ·
  [ảnh gửi khách](docs/features/anh-gui-khach.md) · [thống kê và đơn](docs/features/thong-ke-don.md) ·
  [hỏi thăm](docs/features/hoi-tham.md) · [lấy SĐT](docs/features/chia-se-sdt.md) · [ZBS](docs/features/zbs.md)
- [Quyết định đã chốt và việc còn mở](docs/decisions.md)
- [Kết quả kiểm tra](docs/verification.md)
- [Quy trình làm việc](CONTRIBUTING.md) · [Làm việc với GitHub](docs/github-setup.md)
- [Hướng dẫn vận hành cho công ty](HUONG_DAN_VAN_HANH.md)

## Cấu hình riêng

`.env` (key AI, khóa Zalo, mật khẩu quản trị), `data/app.db` (hội thoại, SĐT khách, token Zalo), `data/images/`
và kho kiến thức thật của công ty `data/knowledge.md` (bảng giá nội bộ) được loại khỏi Git;
repo kèm `data/knowledge.example.md` với giá ví dụ để chạy thử. Mỗi máy tạo `.env` từ `.env.example`. Mã tham khảo từ ChatbotX (MIT) ghi nguồn trong
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
