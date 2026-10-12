# ADR-0016: MT5 terminal chạy trên Linux Docker + Wine, ghim version

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

MT5 là ứng dụng native Windows; deploy mục tiêu là một VPS Linux với Docker Compose. MetaQuotes hỗ trợ MT5 trên Wine (script `mt5linux.sh`), nhưng cộng đồng 2026 vẫn báo gãy vặt theo version (crash sau update OS/Wine, MT5 tự update phá tương thích). Từ khi bỏ chụp màn hình MT5, terminal chỉ cần chạy EA + WebRequest, không cần GUI/chart.

## Decision

Chạy MT5 terminal trong **Linux Docker + Wine/Xvfb** trên cùng VPS, kèm chính sách ghim version:

- Wine pin exact trong Dockerfile; ghi version vào docs khi spike pass.
- Hoãn MT5 auto-update; test build mới ở môi trường tách biệt trước.
- Giám sát heartbeat + build version; mất heartbeat quá ngưỡng → cảnh báo + auto-restart; mọi reconnect qua reconciliation.
- Fallback: Windows host tách riêng nếu spike rớt (backend giữ nguyên nhờ bridge outbound — ADR-0007).

## Consequences

- Tích cực: 1 VPS, đúng plan deploy; bridge outbound nên đổi host không sửa backend.
- Tiêu cực: rủi ro Wine gãy sau update — giảm bằng version pin + spike gate 7 bước.
- Ràng buộc: không pass spike thì không đưa execution live lên Wine.

## Alternatives considered

- Windows host ngay từ đầu: ổn định hơn nhưng tốn 2 máy — giữ làm fallback.
- Tất cả trên 1 Windows VPS: lệch plan Docker/Linux — loại.
