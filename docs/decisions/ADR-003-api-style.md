# ADR-003: API Style

- **Status:** Accepted for first release
- **Date:** 2026-09-23

## Context

The application has resource-oriented operations, typed request and response contracts, and a browser client. The first release needs a simple inspectable API without a separate query language.

## Decision

Use a versioned JSON HTTP API under `/api/v1`. Use resource-oriented routes for accounts, vocabulary administration, practice sessions, attempts, dashboard data, and settings. Define request, response, and error schemas in `packages/shared` where both sides need them.

## Alternatives

- GraphQL would add schema and resolver complexity without a demonstrated need for client-selected graphs.
- Server-rendered forms would reduce client flexibility and conflict with the planned Vue PWA.

## Consequences

The API is easy to test and consume from the PWA. Versioning, consistent errors, and bounded list queries must be enforced by convention and tests.