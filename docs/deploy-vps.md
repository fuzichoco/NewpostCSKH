# Triển khai VPS

Đang chạy: VPS LANIT Cloud VPS C (FPT Datacenter), Ubuntu 24.04, 1 vCPU, 1 GB RAM. Hệ thống chiếm khoảng 100–150 MB RAM.

## Cài lần đầu

```bash
# Node 24, Caddy, tường lửa, PM2
curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt install -y nodejs caddy ufw && npm i -g pm2
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# Mã nguồn
git clone https://github.com/fuzichoco/NewpostCSKH.git /opt/zalo-cskh
cd /opt/zalo-cskh && npm ci --omit=dev
cp .env.example .env && nano .env        # PUBLIC_URL=https://cskh.newpostglobal.vn
pm2 start npm --name zalo-cskh -- start && pm2 save && pm2 startup

# HTTPS tự động
printf 'cskh.newpostglobal.vn {\n\treverse_proxy localhost:3000\n}\n' > /etc/caddy/Caddyfile && systemctl reload caddy
```

Tên miền: bản ghi DNS `A` · `cskh` → IP VPS · **DNS only** (đám mây xám trên Cloudflare).
Chưa có tên miền thì tạm dùng `pm2 start cloudflared --name tunnel -- tunnel --no-autoupdate --url http://localhost:3000`
(địa chỉ đổi khi tunnel khởi động lại, phải cập nhật 3 link trên Zalo).

## Cập nhật phiên bản

```bash
cd /opt/zalo-cskh && git pull && npm ci --omit=dev && pm2 restart zalo-cskh
```

## Bảo mật

- SSH chỉ đăng nhập bằng khóa (`/etc/ssh/sshd_config.d/00-chi-dung-khoa.conf`), tắt đăng nhập bằng mật khẩu.
- `.env` quyền `600`, không đưa lên Git.
- Sao lưu `data/` (gồm `app.db`) định kỳ.

## Theo dõi

`pm2 ls`, `pm2 logs zalo-cskh`, `pm2 logs tunnel`. Log tự xoay vòng bằng `pm2-logrotate`.
