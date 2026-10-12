# ADR-0002: PostgreSQL + Prisma

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

Cần lưu trữ dữ liệu giao dịch với tính toàn vẹn cao (transaction, unique constraints, audit, journal, outbox). Dữ liệu là nguồn sự thật của hệ thống bên cạnh broker.

## Decision

Dùng **PostgreSQL** làm database chính và **Prisma** làm ORM/migration tool.

## Consequences

- Tích cực: transaction, foreign keys, unique constraints, advisory locks — phù hợp yêu cầu data integrity.
- Tích cực: Prisma cung cấp typed client và migration versioned.
- Tiêu cực: một số pattern (transactional outbox, concurrency serialize) cần làm đúng qua transaction/constraint, không phụ thuộc ORM.
- Ràng buộc: giá và volume dùng decimal-safe representation; không dùng float.
- Ràng buộc: migration chạy một lần khi deploy, có backup trước.

## Alternatives considered

- MongoDB: không đủ transaction/constraint mạnh cho yêu cầu tài chính.
- TypeORM: schema drift và quản lý migration kém ổn định hơn Prisma.
