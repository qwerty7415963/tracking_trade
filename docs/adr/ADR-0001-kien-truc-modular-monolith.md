# ADR-0001: NestJS modular monolith + TypeScript

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

Hệ thống gồm nhiều module (ingestion, parser, matcher, approval, risk, execution, reporting, ops API) chạy trên một VPS. Cần một khung framework thống nhất cho API và worker, giảm độ phức tạp vận hành so với microservices, nhưng vẫn tách module rõ ràng.

## Decision

Dùng **Node.js + TypeScript + NestJS** dưới dạng **modular monolith**. Toàn bộ app trong một codebase/deployment, chia module theo domain. Worker (BullMQ) nằm chung codebase, chạy như process riêng.

## Consequences

- Tích cực: một codebase, dễ test, dễ deploy, chia sẻ type/domain model.
- Tích cực: NestJS cung cấp DI, module system, guards/interceptors cho auth và audit.
- Tiêu cực: module phải kỷ luật phân lớp để không tạo vòng phụ thuộc; scale theo process riêng khi cần.
- Ràng buộc: chỉ HTTP boundary tiếp xúc framework; logic core là service thuần.

## Alternatives considered

- Microservices (NestJS apps riêng): phức tạp vận hành không cần thiết cho một VPS.
- Express/plain TS: thiếu cấu trúc module sẵn có cho quy mô này.
