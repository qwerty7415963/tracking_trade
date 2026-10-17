# Backup & Restore Runbook

> Quyết định: backup mã hóa offsite về **máy local của operator** (mô hình pull). Retention **7 ngày** (quyết định #10).

## 1. Kiến trúc

```text
VPS (cron 03:00 hàng ngày)                 Máy local operator (khi bật máy)
┌──────────────────────────┐              ┌─────────────────────────────┐
│ pg_dump → /var/backups/   │              │ Task Scheduler / chạy tay   │
│ artifacts/, .env, compose │              │  scripts/pull-backup.ps1    │
│            │              │              │            │                │
│ restic repo (mã hóa,      │◄─── scp ─────│  copy repo về backups\      │
│ giữ 7 ngày, check)        │ (SSH key)    │                             │
└──────────────────────────┘              └─────────────────────────────┘
```

- **Không backup Redis** (dữ liệu tạm, dựng lại từ DB/outbox).
- **Không backup `.env` vào git** — chỉ vào restic repo mã hóa.
- Restic password do operator tự tạo, tự giữ (password manager). Mất password = backup vô dụng. Không ai khác được thấy.

## 2. Cài đặt trên VPS (operator chạy từng lệnh, dán output nếu lỗi)

```bash
# 1. Lấy version restic mới nhất rồi GHIM version đó
RESTIC_VERSION=$(curl -s https://api.github.com/repos/restic/restic/releases/latest | grep -m1 tag_name | cut -d'"' -f4 | tr -d v)
echo "pin restic $RESTIC_VERSION"
curl -sL -o restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2"
curl -sL "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/SHA256SUMS" | grep "linux_amd64.bz2" | sha256sum -c -
bunzip2 -f restic.bz2 && sudo install -m 0755 restic /usr/local/bin/restic
restic version
# GHI version trên vào docs này (mục 6) sau khi xong.

# 2. Tạo password repo (chỉ làm 1 lần, LƯU password vào password manager)
openssl rand -base64 32 | sudo tee /root/.restic-pass >/dev/null
sudo chmod 600 /root/.restic-pass

# 3. Init repo
sudo RESTIC_PASSWORD_FILE=/root/.restic-pass restic -r /var/backups/restic-repo init

# 4. Đặt script backup (nội dung ở deploy/backup.sh trong repo, copy lên /opt/tracking_trade)
# 5. Cron hàng ngày 03:00
(sudo crontab -l 2>/dev/null; echo "0 3 * * * /opt/tracking_trade/deploy/backup.sh >> /var/log/tracking-backup.log 2>&1") | sudo crontab -
```

## 3. Script `deploy/backup.sh` (chạy trên VPS)

- `pg_dump` từ container postgres ra `/var/backups/dbdump.sql`.
- `restic backup`: dbdump + thư mục artifacts (`./artifacts` repo root, bind-mount vào cả api/worker để dev local đọc chung) + `.env` + compose files, tag `daily`.
- `restic forget --keep-daily 7 --prune` (đúng retention 7 ngày).
- `restic check` nhanh; fail → bắn cảnh báo Telegram cho operator (dùng `TELEGRAM_BOT_TOKEN` + `ALERT_CHAT_ID`).
- Mọi bước ghi log `/var/log/tracking-backup.log`.

## 4. Pull về máy local (Windows)

```powershell
.\scripts\pull-backup.ps1 -VpsHost <IP> -VpsUser <user> -SshKey $HOME\.ssh\id_ed25519
```

Script copy repo về `.\backups\restic-repo-<ngày>`. Chạy bằng Task Scheduler hàng tuần hoặc chạy tay khi bật máy.

## 5. Drill restore hàng tháng (bắt buộc, ghi kết quả vào mục 7)

```bash
# Trên VPS, restore ra thư mục tạm (không đụng production)
sudo RESTIC_PASSWORD_FILE=/root/.restic-pass restic -r /var/backups/restic-repo restore latest --target /tmp/restore-test
# Dựng DB tạm từ dump và đếm bảng
docker run -d --name restore-pg -e POSTGRES_PASSWORD=t -p 5435:5432 postgres:16-alpine
PGPASSWORD=t psql -h localhost -p 5435 -U postgres -c "CREATE DATABASE t;"
PGPASSWORD=t pg_restore -h localhost -p 5435 -U postgres -d t /tmp/restore-test/var/backups/dbdump.sql
PGPASSWORD=t psql -h localhost -p 5435 -U postgres -d t -c "\dt" | wc -l
docker rm -f restore-pg; rm -rf /tmp/restore-test
```

Pass khi: restore thành công + đủ 19+ bảng + artifacts đọc được.

## 6. Nhật ký version và drill

| Ngày | Restic version | Kết quả drill | Ghi chú |
|---|---|---|---|
| _(điền sau lần cài đầu)_ |  |  |  |

## 7. Liên kết

- Quy tắc production: [docker-cicd.md](docker-cicd.md)
- Recovery: [recovery.md](recovery.md)
- Retention: [10-chuan/open-decisions.md](../10-chuan/open-decisions.md) (#10)
