# Risk Engine (paper)

> Ánh xạ từ plan §7 (Risk engine), thích ứng cho paper trading.

## 1. Các kiểm tra bắt buộc

Trước khi mở vị thế ảo (`evaluateVirtualRisk`), hệ thống kiểm tra:

- **Kill switch** không chặn (`STOP_ALL_MUTATIONS` chặn mọi mutation; `STOP_NEW_TRADES` chặn mở mới).
- **Approval hợp lệ** (đúng version, decision APPROVED).
- **Coin đã map** (resolve được từ universe Hyperliquid live).
- **Size** ≥ min size và đúng step (`sizeIncrement`).
- **Leverage** hợp lệ (1..50).
- **Margin đủ**: `notional / leverage ≤ equity`.
- **Max positions**: không giới hạn số vị thế đồng thời (unlimited).

Không còn giới hạn **daily loss** hay **risk per trade**. Mọi kết quả kiểm tra được ghi vào bảng `risk_events`.

## 2. Position sizing (perp)

Size (đơn vị coin) tính từ **notional cố định theo coin** (USDC):

```
size = notional / entryPrice
```

- Notional lấy từ `tradable_coins.notional_usd`: BTC/ETH/SOL mặc định 100k, các coin khác 50k.
- Đổi notional bằng `/vol <SYM> <amount|reset>` hoặc `PUT /api/v1/operations/notional/:symbol` (có audit).
- Entry = `SignalVersion.entry` (fallback mid nếu signal không có entry) — không đoán.
- **Làm tròn size xuống** theo `sizeIncrement` từ `meta`.
- Size tối thiểu từ `minSize`.
- Nếu size < min → **reject lệnh** (`MIN_SIZE_EXCEEDS_NOTIONAL`).

## 3. Cross-margin account (MVP)

- `equity = balance + Σ unrealized PnL` (Margin Balance).
- MMR theo **bậc notional tự định nghĩa** (`packages/domain/src/margin-tiers.ts`): `MM = notional × MMR(bậc) − maintenanceAmount(bậc)`, maintenance amount tự suy ra để MM liên tục tại biên bậc.
- `marginRatio = Σ MM(tất cả vị thế đang mở) / equity` — cấp tài khoản, giống `/accounts`; mọi card cùng account hiện cùng một số.
- Giá thanh lý dùng công thức Cross của Binance: `MP = (WB − side×Q×EP + UPNL_other + cum − TMM_other) / (Q × (MMR − side))`; `side = +1` LONG, `−1` SHORT. Trả `--` nếu không có nghiệm dương.
- MMR **không phụ thuộc leverage**; leverage chỉ ảnh hưởng initial margin.
- MVP **không** tính fee/funding (ghi rõ trong hiển thị và ADR).

## 4. Multi-TP split

- TP1 đóng **50%** size; các TP còn lại chia đều phần còn lại; TP duy nhất đóng 100%.
- SL đóng **toàn bộ** phần còn lại.
- Mỗi lần đóng ghi realized PnL vào ledger (`virtual_transactions`).

## 5. Thứ tự chốt TP/SL (settle)

`pollMarketOnce` **chỉ detect** — không ghi DB. Market-watch enqueue đúng 1 job `position-settle` cho mỗi hit, consumer chạy tuần tự:

| Bước | Việc làm |
|---|---|
| 1 | Tạo publication + render card TP/SL (mark/size đóng băng lúc detect), reply dưới card gốc |
| 2 | Chờ publication `PUBLISHED`, tối đa `SETTLE_PUBLISH_TIMEOUT_MS` (mặc định **60s**) |
| 3 | Đóng lệnh với giá đóng băng (`applyTpHit` / `applySlHit`) — PnL không đổi dù trễ |

### Quy tắc

- Quá 60s vẫn đóng (audit `settle.publish_timeout`); card tiếp tục retry ở hàng `telegram-send` và tự đăng khi card gốc sẵn sàng — **không bao giờ để Telegram giữ lệnh mở vô hạn**.
- Không tạo được card (thiếu destination, payload hỏng) → vẫn đóng, audit `settle.publish_skipped`.
- Idempotent: `publicationId` ghi vào job data (retry không đăng trùng); slice TP đã đóng thì bỏ qua (`settle.already_settled`); jobId dedupe `settle-<positionId>-TP-<i>` / `settle-<positionId>-SL`; job fail hết attempts → market-watch gỡ và enqueue lại để vị thế không bị kẹt.
- Kill switch `STOP_ALL_MUTATIONS` → job throw và retry, **không đóng**.
- Hệ quả chấp nhận: vị thế hiện `OPEN` thêm tối đa ~60s, số dư cộng PnL trễ theo card.

## 6. Kill switch

Hai chế độ:

| Chế độ | Ý nghĩa |
|---|---|
| `STOP NEW TRADES` | Chặn mở mới |
| `STOP ALL AUTOMATED MUTATIONS` | Chặn mọi mutation tự động (kể cả API market-watch bỏ qua chu kỳ TP/SL) |

### Quy tắc

- Kill switch **không tự động đóng** các vị thế hiện có.
- Kill switch được bật/tắt bởi người có quyền (xem open-decisions) và phải ghi audit log.

## 7. Liên kết tài liệu

- Kiểm tra trước khi mở: [03-nghiep-vu/manual-approval.md](../03-nghiep-vu/manual-approval.md)
- Vòng đời vị thế: [02-du-lieu/state-machines.md](../02-du-lieu/state-machines.md)
- Kill switch thiết kế: [ADR-0010](../adr/ADR-0010-kill-switch.md)
- API kill switch: [06-api/operations-api.md](../06-api/operations-api.md)
