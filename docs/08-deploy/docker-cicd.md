# Docker & GitHub Actions CI/CD

> Ánh xạ từ plan §13 (Docker và GitHub Actions CI/CD).

## 1. Repository structure

```text
apps/
  api/                # HTTP + bot + card render consumer (Chromium)
  worker/             # stub
  screenshot-worker/  # legacy/rollback, không còn trong compose

packages/
  domain/
  database/
  connectors/
  market-data/
  reporting/
  shared/

deploy/
  docker-compose.yml
  docker-compose.prod.yml
  scripts/

prisma/
  schema.prisma
  migrations/

tests/
  integration/
  e2e/

.github/
  workflows/
    ci.yml
    build-publish.yml
    deploy-production.yml
```

## 2. CI pipeline

Trên Pull Request:

1. Lint và format check.
2. Typecheck.
3. Unit tests.
4. Schema/migration validation.
5. Integration tests với PostgreSQL/Redis tạm.
6. Contract tests.
7. Dependency/image scan.

## 3. Build và deploy (mô hình B: Actions SSH, build trên VPS)

GHCR dời lại sau. Hiện tại: push `main` → CI gate → Actions SSH vào VPS → build tại chỗ:

1. Merge vào `main` (chỉ qua PR đã CI xanh; commit chỉ-docs không deploy).
2. Job `gate`: typecheck + test + audit + prisma validate. Fail thì dừng.
3. Job `deploy` (serialize qua `concurrency`): SSH bằng deploy key (secret `VPS_SSH_KEY`) → `git pull main` → `compose build api` → `migrate deploy` một lần → `up -d` → health check.
4. Health fail → rollback tự động (checkout SHA trước đó + build + up).
5. Báo Telegram (non-blocking; cần secrets `TELEGRAM_BOT_TOKEN` + `ALERT_CHAT_ID`).

Secrets repo cần: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (bắt buộc); `TELEGRAM_BOT_TOKEN`, `ALERT_CHAT_ID` (tùy chọn, cho notify).

> Production deploy **chỉ từ commit trên `main`** đã qua gate.

## 4. Quy trình quản lý dependency (khóa version + cập nhật)

Mục tiêu: chống supply-chain attack (package bị chiếm quyền, chèn mã độc qua bản mới).

1. **Lockfile** (`package-lock.json`) luôn commit kèm repo; CI và Docker build cài bằng **`npm ci`**, không dùng `npm install`.
2. **Pin version chính xác** cho dependency nhạy cảm (ví dụ `teleproto`): ghi exact version, không dùng range trôi (`^`, `~`, `latest`) cho các package này.
3. **Dependency scan trong CI**: `npm audit` (fail khi có critical/high) + image scan; CI fail thì không deploy.
4. **Cập nhật theo lịch, qua PR riêng**: dùng Renovate/Dependabot (hoặc lịch thủ công) — mỗi update là một PR riêng, chạy đủ CI, có người review rồi mới merge. Không update ồ ạt nhiều package trong một PR.
5. Trước khi merge update của package nhạy cảm: kiểm tra **diff/changelog**, tình trạng maintain (archived không?), số lượng dependents và provenance (npm provenance/signature nếu có).
6. Production deploy chỉ dùng image build từ **commit đã khóa lockfile** (immutable SHA/digest).

## 5. Hướng dẫn biến môi trường

- File mẫu **`.env.example` nằm ở thư mục gốc dự án**; copy thành `.env` rồi điền giá trị thật.
- **Không commit `.env`** (đưa vào `.gitignore` khi scaffold repo); file `.env` trên VPS đặt quyền `600`.
- Không điền secret thật vào `.env.example`; không bake secret vào Docker image — truyền qua environment khi chạy container.
- `HYPERLIQUID_API_URL` mặc định `https://api.hyperliquid.xyz` (public, không key).
- **Node.js runtime:** **24.22.1 LTS** cho local + CI (`setup-node`), image dùng `node:24-slim` pin digest (`sha256:55fb5f5a...`); `package.json` có `engines.node` chặn version ngoài khoảng `>=24.22.1 <25`.
- Notional mỗi coin lưu trong `tradable_coins` (BTC/ETH/SOL 100k, còn lại 50k); đổi bằng `/vol` hoặc API notional, không cần env.
- `OPERATOR_USERNAMES`: danh sách username duy nhất có quyền approve/kill switch/quản trị (comma-separated).
- `OPERATOR_BOT_ENABLED`: chỉ bật ở **service api** (bot chạy chung backend); replica phụ đặt `false` để tránh 2 poller Telegram trên cùng token.
- `RENDER_WORKER_ENABLED`: mặc định `true` — API render card bằng Chromium trong process; đặt `false` trên replica chỉ phục vụ HTTP (khi scale nhiều API).
- `ARTIFACTS_DIR=/data/artifacts` cho **service `api`** (API vừa render vừa đọc PNG để gửi; volume `artifacts` bind từ host).
- Xoay (rotate) secret định kỳ: Telegram session, bot token.

## 6. Quy tắc production

- Protect production branch.
- **CI fail thì không deploy.**
- **Serialize** các lần deploy.
- **Không deploy từ pull request.**
- Secrets không được commit hoặc bake vào image.
- PostgreSQL/Redis có **persistent volumes**.
- Backup mã hóa ngoài VPS và phải **thử restore**.
- **Không dùng `docker compose down -v`.**
- Có log rotation và disk alerts.
- **Không tự bật kill switch hoặc trading sau deploy.**

## 7. Local deploy đã kiểm chứng (13/10/2026)

- `tracking-trade-api:local` — API image giờ gồm Chromium/Playwright (render card trong process), nặng hơn bản Alpine cũ; health `ok`.
- `tracking-trade-worker:local` — legacy (không còn dùng trong compose); giữ để rollback tạm thời.
- Bài học: workspace symlinks gãy nếu runner thiếu `packages/*/dist` — đã fix bằng COPY tường minh từng package.

## 8. Backup

Backup mã hóa offsite về máy operator theo mô hình pull (restic, retention 7 ngày, drill restore hàng tháng). Chi tiết đầy đủ: [backup-restore.md](backup-restore.md).

## 9. Liên kết tài liệu

- Recovery sau restart: [recovery.md](recovery.md)
- Backup & restore: [backup-restore.md](backup-restore.md)
- Security: [10-chuan/security-checklist.md](../10-chuan/security-checklist.md)
- ADR: [ADR-0014](../adr/ADR-0014-telegram-mtproto-teleproto.md)
