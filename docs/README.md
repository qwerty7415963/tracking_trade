# Trading Signal Automation — Tài liệu lập trình

Tài liệu kỹ thuật cho hệ thống tự động hóa tín hiệu giao dịch:

**Luồng hệ thống:** Telegram + X → Phân tích tín hiệu → Duyệt thủ công → MT5 → Screenshot → Telegram reporting.

Bộ tài liệu này được biên soạn từ bản *Technical Design & AI Coding Implementation Plan v1.0 (12/10/2026)*. Nội dung chỉ tổng hợp từ plan gốc; các quyết định chưa được chốt được liệt kê tại [10-chuan/open-decisions.md](10-chuan/open-decisions.md).

---

## Kiến trúc tổng thể

```text
Source Management
       |
       v
Telegram Connector ---- X Connector
       |                     |
       +----------+----------+
                  |
                  v
       Ingestion / Normalization
                  |
                  v
         Signal Parser
                  |
                  v
         Signal Matcher
                  |
          +-------+-------+
          |               |
     New Signal       Signal Update
          |               |
          v               v
   Manual Approval   Validation / Review
          |               |
          +-------+-------+
                  |
                  v
             Risk Engine
                  |
                  v
          Execution Service
                  |
                  v
             MT5 Bridge
                  |
                  v
             MT5 / Broker
                  |
                  v
          Reconciliation
                  |
          +-------+--------+
          |                |
          v                v
   Screenshot Worker  Telegram Publisher
```

---

## Cây tài liệu

| Thư mục | Nội dung |
|---|---|
| [`01-tong-quan`](01-tong-quan/kien-truc.md) | Mục tiêu, quy tắc bắt buộc, kiến trúc tổng thể, danh sách module và công nghệ |
| [`02-du-lieu`](02-du-lieu/database-design.md) | Thiết kế database (toàn bộ bảng) và state machines |
| [`03-nghiep-vu`](03-nghiep-vu/signal-parsing-matching.md) | Signal parsing, normalized signal, matching update và quy tắc update |
| [`04-risk-execution`](04-risk-execution/risk-engine.md) | Risk engine, position sizing, kill switch, MT5 bridge/EA và retry/idempotency |
| [`05-connectors`](05-connectors/telegram-connector.md) | Connector Telegram và X (kèm ràng buộc truy cập) |
| [`06-api`](06-api/source-management-api.md) | API quản lý nguồn, API vận hành và API reporting |
| [`07-reporting`](07-reporting/telegram-reporting.md) | Sender, destination, template, publication rules |
| [`08-deploy`](08-deploy/docker-cicd.md) | Docker Compose, GitHub Actions CI/CD, MT5 Docker spike, recovery |
| [`09-kiem-thu`](09-kiem-thu/acceptance-tests.md) | Danh sách acceptance tests |
| [`10-chuan`](10-chuan/definition-of-done.md) | Definition of Done, hướng dẫn AI coding agent, security checklist, quyết định chưa chốt |
| [`adr`](adr/README.md) | Architecture Decision Records (12 ADR) |

---

## Cách đọc tài liệu

1. **Mới bắt đầu:** đọc [`01-tong-quan/kien-truc.md`](01-tong-quan/kien-truc.md) → [`02-du-lieu/database-design.md`](02-du-lieu/database-design.md) → [`02-du-lieu/state-machines.md`](02-du-lieu/state-machines.md).
2. **Đang code một module:** mở đúng thư mục tương ứng theo bảng trên, và đọc các ADR có liên quan.
3. **Thay đổi kiến trúc:** ghi ADR mới tại [`adr`](adr/README.md), không sửa lịch sử ADR cũ.
4. **Trước production:** duyệt danh sách [`10-chuan/open-decisions.md`](10-chuan/open-decisions.md).

---

## Quy tắc bắt buộc (tóm tắt)

1. Tín hiệu mở lệnh mới luôn cần manual approval.
2. Không tự điền dữ liệu tín hiệu còn thiếu.
3. Update mơ hồ hoặc không xác thực được không được tác động MT5.
4. Không retry lệnh OPEN một cách mù quáng sau timeout.
5. Không báo lệnh đã khớp trước khi broker xác nhận.
6. Không tự bật live trading sau deploy hoặc restart.
7. Mọi thao tác tài chính phải có audit trail.
8. X connector lỗi không được làm sập pipeline Telegram.
9. Không tuyên bố hệ thống có exactly-once execution; sử dụng idempotency, journal và reconciliation.

Chi tiết: [`01-tong-quan/kien-truc.md`](01-tong-quan/kien-truc.md).

---

## Nguyên tắc triển khai cuối cùng

Ưu tiên **correctness, traceability và recovery** trước automation tối đa. Chỉ cân nhắc live trading sau khi demo end-to-end, reconciliation, risk controls và recovery tests đều đạt.
