# ADR-005: Authentication and Session Strategy

- **Status:** Provisional; confirm credential details in OPEN DECISION 001
- **Date:** 2026-09-23

## Context

TapTalk does not require email accounts. Browser authentication must avoid exposing session secrets to JavaScript or relying on unsafe browser storage.

## Decision

Use server-managed opaque sessions stored in SQLite and identified by an HTTP-only cookie. In production the cookie is Secure, SameSite is selected for the deployment topology, and session expiration and explicit logout invalidation are enforced server-side. Credential hashing uses an approved adaptive password-hashing library; the exact password versus PIN-equivalent policy remains an open product decision.

## Alternatives

- Stateless browser-held JWTs increase revocation and storage risks for this application.
- Local storage tokens are readable by injected scripts and are not appropriate for authenticated session secrets.

## Consequences

Logout and revocation are direct and protected routes can resolve user state centrally. SQLite stores session metadata and requires expiration cleanup. CSRF protection and cookie settings must be tested against the final deployment topology.