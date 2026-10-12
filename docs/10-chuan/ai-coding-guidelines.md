# Hướng dẫn cho AI Coding Agent

> Ánh xạ từ plan §19 (Hướng dẫn cho AI coding agent).

## 1. Quy trình làm việc

Không yêu cầu AI code toàn bộ hệ thống trong một lượt. Mỗi phase phải:

1. Đọc tài liệu và xác định assumptions.
2. Chia thành task nhỏ.
3. Nêu **acceptance criteria** trước khi code.
4. Viết unit/integration tests phù hợp.
5. Báo **file đã thay đổi**.
6. Báo **lệnh test đã chạy và kết quả**.
7. Nêu **phần chưa kiểm chứng và rủi ro còn lại**.

## 2. Không được phép

- **Fake broker success** trong production path.
- Tự đổi approval/risk policy mà **không cập nhật tài liệu và tests**.
- **Retry OPEN mù** sau timeout.
- Tự **bật live trading** khi startup/deploy.
- **Bỏ qua reconciliation** khi có trạng thái UNKNOWN.
- Tự **vượt cơ chế bảo vệ truy cập của X**.

## 3. Quy tắc NestJS DI (rút từ Phase 2–3)

- `@UseGuards(GuardClass)` khởi tạo guard qua injector của **module chứa controller** — mọi module có controller dùng guard phải **import trực tiếp module export config** (`AppConfigModule`), `@Global` ở module khác không đủ.
- Provider dùng chung (config, auth, audit, DB) đặt trong module `@Global` riêng; không re-provide ở module con.
- Viết integration test khởi tạo full `AppModule` để bắt lỗi DI trước production.

## 4. Review theo rủi ro

Thay đổi liên quan đến **concurrency, tiền, migration hoặc auth** cần review theo rủi ro.

## 5. Nguyên tắc cuối cùng

Ưu tiên **correctness, traceability và recovery** trước automation tối đa. Chỉ cân nhắc live trading sau khi demo end-to-end, reconciliation, risk controls và recovery tests đều đạt.

## 5. Liên kết tài liệu

- Quy tắc bắt buộc: [01-tong-quan/kien-truc.md](../01-tong-quan/kien-truc.md)
- Kế hoạch triển khai theo phase: [open-decisions.md](open-decisions.md)
