# Security Checklist

> Ánh xạ từ plan §18 (Security checklist).

- **Authentication** và role-based authorization (quyền approve/kill switch giới hạn bởi `OPERATOR_USERNAMES`).
- **Authentication** và role-based authorization (quyền approve/kill switch/quản trị tài khoản giới hạn bởi `OPERATOR_USERNAMES`).
- **Operator bot commands**: chỉ private chat + username trong `OPERATOR_USERNAMES`; lệnh trong group/channel bị bỏ qua; rate limit lệnh; không log nội dung nhạy cảm; callback inline verify allowlist.
- **Audit log** cho approve/reject/open/close, nạp/rút/reset/mode tài khoản, source/template changes và kill switch.
- **TLS** và **encrypted credentials**.
- **Secret rotation** và **log masking**.
- **Template placeholder allowlist** và Markdown/HTML escaping.
- **Input validation** và **rate limits**.
- **Secure headers**; CSRF protection nếu dùng cookie session.
- **Xác minh sender Telegram** có quyền đăng lên destination channel.
- **Supply-chain**: lockfile commit kèm repo + `npm ci`; pin version chính xác cho dependency nhạy cảm; `npm audit` fail khi có critical/high; update qua PR riêng có review; kiểm tra tình trạng maintain và provenance trước khi merge (chi tiết: [docker-cicd](../08-deploy/docker-cicd.md)).

## Liên kết tài liệu

- Template: [07-reporting/telegram-reporting.md](../07-reporting/telegram-reporting.md)
- Quy tắc production: [08-deploy/docker-cicd.md](../08-deploy/docker-cicd.md)
