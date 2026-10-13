# ADR-0017: Deploy production qua Actions SSH, build trên VPS

- **Ngày:** 2026-10-13
- **Trạng thái:** Accepted

## Context

Cần deploy tự động khi `main` có code mới. Plan gốc (§13) chỉ định GHCR + pull digest, nhưng setup registry + provenance tốn công trong khi VPS đủ mạnh để build tại chỗ (8GB RAM).

## Decision

Mô hình B: push `main` → job `gate` (typecheck/test/audit/validate) → job `deploy` SSH vào VPS bằng deploy key riêng → `git pull` → `compose build` → `migrate deploy` → `up -d` → health check → rollback về SHA cũ nếu fail → báo Telegram. Serialize bằng `concurrency`. GHCR dời lại sau khi cần multi-VPS hoặc audit image chặt hơn.

## Consequences

- Tích cực: không cần registry/token registry; image build đúng môi trường chạy; rollback đơn giản (checkout + build lại).
- Tiêu cực: build tốn CPU/RAM VPS mỗi lần deploy (~7 phút); không có image digest bất biến như GHCR.
- Ràng buộc: deploy key riêng (không passphrase, chỉ dùng cho Actions); secrets trong GitHub Secrets, không bao giờ vào chat/repo; commit chỉ-docs không trigger deploy.

## Alternatives considered

- A. VPS cron tự pull: không có CI gate — loại.
- C. GHCR + digest: chuẩn nhất nhưng nặng setup hiện tại — dời lại sau.
