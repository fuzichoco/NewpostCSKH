# Hướng dẫn vận hành – Hệ thống CSKH Zalo Newpost Global

## 1. Cách mở hệ thống (đơn giản nhất)

Máy đã cài sẵn (laptop đang dùng): chỉ cần 4 bước, khoảng 3 phút.

1. Mở thư mục hệ thống `C:\Jobs\Newpost CSKH`, **bấm đúp `start.bat`**.
2. Chờ cửa sổ đen hiện chữ **HỆ THỐNG ĐÃ MỞ** kèm 4 đường link. **Giữ nguyên cửa sổ này** (thu nhỏ được, không được đóng).
3. Vào https://developers.zalo.me → ứng dụng **CSKH NEWPOST GLOBAL**, dán 3 link từ cửa sổ đen:

   | Mục trên Zalo | Thao tác |
   |---|---|
   | **Xác thực domain** → ô *Tiền tố URL* | Dán link mục 1 → bấm **Xác thực** → thấy "Xác thực thành công" |
   | **Official Account** → *Thiết lập chung* → *Official Account Callback Url* | Bấm **Cập nhật** → dán link mục 2 → bấm **Lưu** |
   | **Webhook** → *Webhook URL* | Bấm **Thay đổi** → dán link mục 3 → **Kiểm tra** → tick *Tôi đã hiểu và đồng ý cập nhật* → **Cập nhật** |

   Không bấm nút **Reset** cạnh *OA Secret Key*.
4. Nhắn thử một tin vào OA bằng điện thoại. Bot trả lời và tin hiện ở trang quản trị là xong.

**Dừng hệ thống:** đóng cửa sổ đen (hoặc bấm Ctrl+C trong đó).

> Vì sao mỗi lần mở phải làm lại bước 3? Tunnel miễn phí đổi địa chỉ mỗi lần mở. Muốn bỏ bước này, xem mục 4.

## 2. Trang quản trị

- Địa chỉ: link **Trang quản trị** trong cửa sổ đen (dạng `https://....trycloudflare.com/admin`). Trên chính máy chạy có thể dùng http://localhost:3000/admin.
- Mật khẩu: giá trị `ADMIN_PASSWORD` trong file `.env`.

| Mục | Dùng để |
|---|---|
| Hội thoại | Xem khách nhắn. Khách **chờ nhân viên** nằm trên cùng. Bấm vào khách → **Nhân viên chat** để trả lời thay bot, **Bot trả lời** để giao lại |
| Chat thử | Hỏi thử bot như khách, không gửi qua Zalo |
| Kiến thức & giọng văn | Sửa bảng giá, quy định, cách bot xưng hô. Lưu là có hiệu lực ngay |
| Model AI | Đổi hãng AI (Gemini / ChatGPT / Claude) và API key. Hệ thống thử trước, key sai thì không đổi |

Bot tự chuyển cho nhân viên khi: khách đòi gặp người thật, khiếu nại, hỏi giá nước chưa có trong bảng, hoặc nhân viên đã trả lời trong app Zalo OA.
Sau khi bot chuyển, nếu **10 phút** không có nhân viên trả lời thì bot tự nhận lại khách, xin lỗi vì để khách chờ và trả lời tiếp (ca khó thì xin số điện thoại để nhân viên gọi lại). Nhân viên đã trả lời hoặc bấm *Nhân viên chat* thì bot không nhận lại.

Khi cần số điện thoại (chốt đơn, hẹn gọi lại), bot gửi kèm nút **Chia sẻ số điện thoại**: khách bấm là số tự lưu vào hệ thống, không phải gõ. Zalo không cho lấy số điện thoại nếu khách chưa đồng ý chia sẻ.

## 3. Cài trên máy mới (chỉ làm một lần)

1. Cài **Node.js 24**: https://nodejs.org (bản 24.x).
2. Cài **cloudflared**: mở PowerShell, chạy `winget install Cloudflare.cloudflared`.
3. Chép **cả thư mục** `Newpost CSKH` sang máy mới, gồm cả file **`.env`** và thư mục **`data`** (chứa hội thoại, token Zalo, kho kiến thức).
4. Bấm đúp `start.bat` (lần đầu tự cài thư viện), rồi làm tiếp như mục 1.

Chỉ chạy hệ thống **trên một máy tại một thời điểm**.

## 4. Đề xuất chạy 24/24 (nên làm sau bàn giao)

Cách hiện tại phụ thuộc máy tính: máy tắt, ngủ, mất mạng là bot ngừng, và mỗi lần mở phải cập nhật Zalo.

**Khuyến nghị:** thuê **VPS tại Việt Nam** (1 CPU, 1–2 GB RAM, Ubuntu, khoảng 100–200 nghìn/tháng) + tên miền con như `cskh.newpostglobal.vn`, chạy bằng PM2 + Caddy (hướng dẫn chi tiết trong `README.md`). Khi đó địa chỉ cố định, chỉ cập nhật Zalo **một lần**, chạy liên tục, không còn cảnh báo IP nước ngoài.

Trong lúc chưa có VPS: để máy chạy hệ thống **luôn cắm sạc, tắt chế độ ngủ** (Settings → System → Power → Sleep: Never).

## 5. Bàn giao – việc cần làm

- [ ] Thêm tài khoản Zalo của người phụ trách công ty làm **Quản trị viên** ứng dụng: developers.zalo.me → ứng dụng → **Vai trò**. Không có quyền này thì không làm được bước 3 mục 1.
- [ ] Đổi `ADMIN_PASSWORD` trong `.env` thành mật khẩu mới của công ty (đổi xong đóng và mở lại `start.bat`).
- [ ] Công ty dùng **API key AI của công ty**: vào mục **Model AI** nhập key mới (key Gemini hiện tại là gói miễn phí, chậm và có giới hạn).
- [ ] Sao lưu định kỳ thư mục `data` và file `.env` (chứa bí mật, **không gửi qua chat/email công khai**).
- [ ] Chức năng *Gửi tin theo SĐT* (ZBS) đang tạm ẩn. Khi tài khoản ZBS công ty có mẫu tin được duyệt và có số dư: thêm `ZNS_ENABLED=1` vào `.env`.

## 6. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Khách nhắn, bot không trả lời | Cửa sổ đen còn mở không? Đã cập nhật 3 link trên Zalo theo lần mở này chưa? Trang quản trị có ghi *Bot đang tắt* không? Khách đó có đang ở chế độ *Nhân viên chat* không? |
| Trang quản trị báo **Chưa kết nối Zalo OA** | Bấm **Kết nối Zalo OA** trên trang Hội thoại, đăng nhập bằng tài khoản admin OA và đồng ý |
| Cửa sổ đen báo *Không mở được tunnel* | Kiểm tra mạng, chạy lại `start.bat` |
| Cửa sổ đen báo cổng 3000 đang bận (`EADDRINUSE`) | Hệ thống đang chạy ở cửa sổ khác: đóng hết cửa sổ cũ rồi mở lại |
| Bot trả lời chậm hoặc toàn chuyển nhân viên | Key AI hết hạn mức: vào **Model AI** đổi key hoặc model |
| Nhân viên gửi tin báo lỗi quá 48 giờ | Quy định Zalo: chỉ trả lời được trong 48 giờ kể từ tin cuối của khách. Chờ khách nhắn lại |
