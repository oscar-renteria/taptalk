# ADR-004: Validation Strategy

- **Status:** Accepted for first release
- **Date:** 2026-09-23

## Context

Input crosses browser, HTTP, file, environment, and database boundaries. Compile-time TypeScript types cannot validate runtime data.

## Decision

Use Zod schemas in `packages/shared` for contracts shared by web and API, infer TypeScript types from those schemas, and keep server-only schemas for secrets or persistence details. Parse data at the boundary and map failures to stable safe errors. Domain modules receive already validated typed values but retain invariant checks for business rules.

## Alternatives

- TypeScript-only interfaces would disappear at runtime and allow malformed input through.
- Duplicated frontend/backend schemas would drift.

## Consequences

Contracts have one runtime source of truth. Schema changes require coordinated tests and may require explicit API compatibility handling.