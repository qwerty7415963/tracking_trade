# Docker & GitHub Actions CI/CD

> Ánh xạ từ plan §13 (Docker và GitHub Actions CI/CD).

## 1. Repository structure

```text
apps/
  api/
  worker/
  screenshot-worker/

packages/
  domain/
  database/
  connectors/
  mt5-bridge-contract/
  reporting/
  shared/

mt5/
  bridge-ea/

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

## 3. Build và deploy

1. Build Docker images.
2. Push GHCR với **immutable commit SHA/digest**.
3. Production deploy **chỉ dùng image đã xác định chính xác**.
4. SSH xác thực vào VPS.
5. **Backup trước migration**.
6. Chạy migration **một lần**.
7. Rollout Docker Compose.
8. Chạy health checks và smoke tests.
9. **Rollback image nếu unhealthy**, với migration recovery plan phù hợp.

> **Không dùng tag `latest`** làm định danh production.

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
- `MT5_SERVER` mặc định `vantagemarkets-demo` (broker Vantage Markets, môi trường demo).
- `OPERATOR_USERNAMES`: danh sách username duy nhất có quyền approve/kill switch (comma-separated).
- Xoay (rotate) secret định kỳ: Telegram session, bot token, MT5 password.

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

## 7. Backup

Backup mã hóa offsite về máy operator theo mô hình pull (restic, retention 7 ngày, drill restore hàng tháng). Chi tiết đầy đủ: [backup-restore.md](backup-restore.md).

## 8. Liên kết tài liệu

- MT5 Docker spike: [mt5-docker-spike.md](mt5-docker-spike.md)
- Recovery sau restart: [recovery.md](recovery.md)
- Backup & restore: [backup-restore.md](backup-restore.md)
- Security: [10-chuan/security-checklist.md](../10-chuan/security-checklist.md)
- ADR: [ADR-0014](../adr/ADR-0014-telegram-mtproto-teleproto.md)
