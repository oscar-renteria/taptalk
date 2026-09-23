# ADR-001: SQLite Deployment Model

- **Status:** Accepted for first release
- **Date:** 2026-09-23

## Context

TapTalk needs relational constraints, transactions, reproducible local development, and a low-operations first deployment. The product is initially a single modular monolith rather than a horizontally scaled service.

## Decision

Use SQLite as a single persistent database file owned by the API deployment. Store it on explicitly configured persistent storage, run versioned migrations before the application becomes ready, and use transactions for atomic application operations. The API process is the only writer.

## Alternatives

- PostgreSQL would improve multi-instance scaling but adds operational cost before it is needed.
- An embedded document store would weaken relational constraints and query clarity for attempts and user isolation.

## Consequences

Local setup stays simple and transaction behavior is strong. Horizontal scaling and concurrent writers require a future migration or a carefully designed single-writer deployment. Backup, file permissions, and persistent storage are operational requirements.