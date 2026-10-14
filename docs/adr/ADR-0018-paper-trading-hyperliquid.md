# ADR-0018: Paper trading trên giá Hyperliquid, bỏ MT5

- **Ngày:** 2026-10-14
- **Trạng thái:** Accepted (thay thế ADR-0007, ADR-0009, ADR-0011, ADR-0016)

## Context

Đường vào lệnh thật qua MT5 (Wine + EA + bridge outbound) quá rườm rà so với giá trị: spike Wine kẹt ở anti-debug installer, vận hành 2 chiều tốn kém, trong khi nhu cầu thực là **ảnh cập nhật lệnh + follow giá TP/SL**.

## Decision

- Bỏ hẳn MT5: xóa EA, bridge, Wine/Docker MT5, reconciliation, execution commands.
- Nguồn giá duy nhất: **Hyperliquid public info API** (`meta`/`allMids`, không key), mapping symbol **data-driven** từ universe (vàng → `PAXG`, đã verify live).
- **Tài khoản ảo cross-margin** (mặc định x10): equity/balance, unrealized PnL, margin ratio, liquidation xấp xỉ; MVP chưa fee/funding.
- 2 mode mở lệnh: `AUTO` / `APPROVE` (mặc định, approve = mở); multi-TP (TP1 50%, còn lại chia đều); SL đóng hết.
- TP/SL detector poll `allMids` ~5s; card + publish reply như cũ.

## Consequences

- Tích cực: không còn phụ thuộc terminal/Wine/broker; test được toàn bộ bằng mock + live public API; deploy gọn 1 VPS.
- Tiêu cực: không phải lệnh thật — báo cáo phải ghi rõ paper; P&L chưa trừ fee/funding.
- Ràng buộc: thiếu quote thì từ chối (không đoán); mapping fail thì review.
