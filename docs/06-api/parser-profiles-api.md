# Parser Profiles API (alias coin theo channel)

> Khi một channel dùng nickname riêng cho coin (ví dụ gọi BTC là `PAWS`), operator xác nhận mapping **một lần** thành profile rồi gán cho nguồn — các bài sau parse tự động.

## 1. Endpoints

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/parser-profiles` | Danh sách profile (A→Z) |
| POST | `/api/v1/parser-profiles` | Tạo profile `{name, coinAliases?, notes?}` |
| GET | `/api/v1/parser-profiles/:id` | Chi tiết profile |
| PATCH | `/api/v1/parser-profiles/:id` | Sửa profile |
| DELETE | `/api/v1/parser-profiles/:id` | **Xóa hẳn** (không có history FK) |

Tạo/sửa validate `coinAliases` là object string→string (chuẩn hoá hoa 2 vế); trùng `name` → `409`. Mọi thay đổi ghi **audit log**.

## 2. Gán cho nguồn

`PATCH /api/v1/sources/:id` với `{parserProfileId: "<profileId>"}` (để `null` để gỡ). Alias trong profile đè lên map mặc định khi parse bài của nguồn đó; coin sau alias vẫn phải qua coin list.

## 3. Liên kết tài liệu

- Parse/matching: [03-nghiep-vu/signal-parsing-matching.md](../03-nghiep-vu/signal-parsing-matching.md)
- Coin list: [coins-api.md](coins-api.md)
- Dữ liệu: [02-du-lieu/database-design.md](../02-du-lieu/database-design.md)
