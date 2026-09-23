# ADR-002: Monorepo Structure

- **Status:** Accepted for first release
- **Date:** 2026-09-23

## Context

The web client and API share validation contracts and should be versioned and tested together.

## Decision

Use one repository with `apps/web`, `apps/api`, `packages/shared`, `database`, and `docs`. Use workspace package scripts and a single lockfile. Shared contracts are imported as a package rather than copied between applications.

## Alternatives

- Separate repositories would increase release coordination and contract drift.
- A single undifferentiated source directory would make module ownership less visible.

## Consequences

Cross-package checks and atomic changes are straightforward. Workspace tooling and package boundaries must be maintained deliberately.