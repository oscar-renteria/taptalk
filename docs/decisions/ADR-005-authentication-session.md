# ADR-005: Authentication and Session Strategy

- **Status:** Accepted for first release. The session strategy resolves OPEN DECISION 002; credential details are in [ADR-006](ADR-006-credential-policy.md).
- **Date:** 2026-09-23

## Context

TapTalk does not require email accounts. Browser authentication must avoid exposing session secrets to JavaScript or relying on unsafe browser storage.

## Decision

Use server-managed opaque sessions stored in SQLite and identified by an HTTP-only cookie. In production the cookie is Secure, SameSite is selected for the deployment topology, and session expiration and explicit logout invalidation are enforced server-side. Credential hashing uses an approved adaptive password-hashing library; the exact password versus PIN-equivalent policy remains an open product decision.

### Session strategy (OPEN DECISION 002)

- **Token:** 32 random bytes (base64url) sent only in the `taptalk_session` cookie. The database stores only the SHA-256 hash of the token, so a leaked database cannot be replayed as sessions.
- **Cookie:** `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` when `NODE_ENV=production`. Nothing authentication-related goes into `localStorage` or `sessionStorage`.
- **Expiration:** an absolute lifetime of 14 days from login, with no sliding renewal and no refresh tokens. Expired rows are deleted whenever a new session is created.
- **Invalidation:** logout sets `revoked_at` on the current session only, so other devices stay signed in, and clears the cookie. Logout without a session still returns `204`.
- **Enforcement:** a single `preHandler` guard (`apps/api/src/auth.ts`) resolves the session once per request. Every route under `/api` requires a user unless it declares `config: { access: 'public' }`, which only register, login and logout do. The default therefore denies access.
- **Login responses:** unknown usernames, wrong passwords, oversized passwords and missing bodies all return the same `401 INVALID_LOGIN`. Unknown usernames are still checked against a dummy hash, so response timing does not reveal whether an account exists.
- **CSRF:** `SameSite=Lax` keeps the cookie off cross-site `POST`, `PUT` and `DELETE` requests. The API accepts only JSON bodies and sends no CORS headers in production. During local development only, `@fastify/cors` is registered with `origin: true` and credentials enabled so local tooling can use the API from another origin; the security review documents this exception. Outside development, an additional `Origin` check enforces `WEB_ORIGIN` or the request host.

## Alternatives

- Stateless browser-held JWTs increase revocation and storage risks for this application.
- Local storage tokens are readable by injected scripts and are not appropriate for authenticated session secrets.

## Consequences

Logout and revocation are direct and protected routes can resolve user state centrally. SQLite stores session metadata and requires expiration cleanup. CSRF protection and cookie settings must be tested against the final deployment topology.