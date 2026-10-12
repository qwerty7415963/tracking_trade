# ADR-0007: MT5 bridge MQL5 EA, outbound authenticated

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

MT5 cần nhận lệnh từ backend và báo lại trạng thái. Mở cổng điều khiển MT5 ra Internet là rủi ro bảo mật không chấp nhận được.

## Decision

Xây dựng **MQL5 EA/bridge** giao tiếp với backend qua kết nối **outbound có xác thực** từ bridge tới backend (bridge chủ động kết nối ra), sử dụng **TLS**, **replay protection** và **account allowlist**. **Không mở cổng điều khiển MT5 trực tiếp ra Internet.**

## Consequences

- Tích cực: MT5 không lộ port ra Internet; backend kiểm soát được kết nối.
- Tích cực: bridge cung cấp heartbeat, journal, command status, quotes, positions.
- Tiêu cực: backend phải xác thực danh tính bridge (mutual auth) và replay protection.
- Ràng buộc: bridge phải có journal phục hồi sau crash (xem spike §14).

## Alternatives considered

- Mở port MT5 ra Internet (Wine bridge TCP): không an toàn.
- Pull từ backend (backend kết nối vào MT5): MT5 phải lộ port, vi phạm nguyên tắc.
