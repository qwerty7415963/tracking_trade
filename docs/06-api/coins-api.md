# Coins API (coin list do operator quản lý)

> Coin list là cổng kiểm tra coin parse được: chỉ coin có trong list (và `enabled`) mới đi tiếp; coin lạ giữ tên thật + gắn `unmapped_symbol_<X>` → `NEEDS_REVIEW`.

## 1. Endpoints

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/coins` | Danh sách coin (A→Z) |
| POST | `/api/v1/coins` | Thêm coin `{symbol, notionalUsd?, notes?}` |
| GET | `/api/v1/coins/:id` | Chi tiết coin |
| PATCH | `/api/v1/coins/:id` | Sửa `{symbol?, enabled?, notionalUsd?, notes?}` |
| DELETE | `/api/v1/coins/:id` | **Xóa hẳn** (không có history FK) |

Tạo/sửa/trùng symbol (không phân biệt hoa thường) → `409` rõ ràng. Mọi thay đổi ghi **audit log**.

## 2. Bot commands

| Lệnh | Tác dụng |
|---|---|
| `/coins` | Danh sách coin đang bật/tắt |
| `/coin_add` | Thêm nhiều coin, mỗi dòng một symbol; trùng được bỏ qua |
| `/coin_del` | Xóa hẳn nhiều coin theo symbol/ID, giữ lịch sử audit |
| `/coin_enable\|/coin_disable <SYM> [...]` | Bật/tắt từng coin |
| `/vol [SYM] [amount\|reset]` | Xem/đổi notional cố định (USDC) của từng coin |

`notionalUsd` mặc định: BTC/ETH/SOL = 100000, coin khác = 50000. Đổi notional có audit và áp dụng ngay cho lệnh mở sau. Đổi list có hiệu lực ngay cho các bài parse sau (không cần restart).

## 3. Liên kết tài liệu

- Parse/matching: [03-nghiep-vu/signal-parsing-matching.md](../03-nghiep-vu/signal-parsing-matching.md)
- Dữ liệu: [02-du-lieu/database-design.md](../02-du-lieu/database-design.md)
