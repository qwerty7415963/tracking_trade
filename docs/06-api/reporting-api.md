# Reporting API

> Ánh xạ từ plan §10.3 (Reporting API).

## 1. Endpoints

### Telegram sender accounts

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/telegram/accounts` | Danh sách sender account |
| POST | `/api/v1/telegram/accounts` | Tạo sender account |
| PATCH | `/api/v1/telegram/accounts/:id` | Cập nhật sender account |
| POST | `/api/v1/telegram/accounts/:id/test` | Kiểm tra gửi thử |

### Destinations

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/telegram/destinations` | Danh sách destination |
| POST | `/api/v1/telegram/destinations` | Tạo destination |
| PATCH | `/api/v1/telegram/destinations/:id` | Cập nhật destination |
| DELETE | `/api/v1/telegram/destinations/:id` | Xóa destination |

### Reporting templates

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/reporting/templates` | Danh sách template |
| POST | `/api/v1/reporting/templates` | Tạo template |
| PATCH | `/api/v1/reporting/templates/:id` | Cập nhật template |
| POST | `/api/v1/reporting/templates/:id/preview` | Xem trước render |
| POST | `/api/v1/reporting/templates/:id/test-send` | Gửi thử |

### Reporting routes

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/reporting/routes` | Danh sách route |
| POST | `/api/v1/reporting/routes` | Tạo route |
| PATCH | `/api/v1/reporting/routes/:id` | Cập nhật route |

## 2. Luồng render/publish (worker render, API gửi)

- `POST /api/v1/positions/:positionId/render-card` enqueue job `card-render` (worker render PNG vào volume `artifacts` chung).
- `GET /api/v1/renders/:renderId` đọc trạng thái job BullMQ + kiểm tra file `<renderId>.png` (không dùng DB artifact).
- `POST /api/v1/publications/position` tạo `TelegramPublication` PENDING rồi enqueue `card-render`; worker render xong enqueue `telegram-send`; API đọc PNG, dựng caption, gửi Telegram.
- Không lưu metadata ảnh trong DB; retention 7 ngày quét theo mtime.

## 3. Quy tắc

- Mọi thay đổi template/route phải ghi **audit log**.
- Sender phải được **xác minh quyền đăng** lên destination.
- Publication dùng **snapshot** template/version (xem [telegram-reporting](../07-reporting/telegram-reporting.md)).

## 4. Liên kết tài liệu

- Chi tiết reporting: [07-reporting/telegram-reporting.md](../07-reporting/telegram-reporting.md)
- Dữ liệu: [02-du-lieu/database-design.md](../02-du-lieu/database-design.md)
