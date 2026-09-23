# Security review (Prompt 032)

- **Date:** 2026-09-23
- **Scope:** API (`apps/api`), web app (`apps/web`), shared contracts, dependencies, and configuration
- **Method:** code review of every point in the prompt, `npm audit`, and automated tests for each fix (`apps/api/src/security.test.ts`, `password-hashing.test.ts`, `e2e/pwa.spec.ts`)

## Summary

No critical or high finding remains open. Two findings are deferred to deployment work (Prompts 034/035) with an explicit decision, and four low risks are accepted. They are listed at the end.

## Findings

| # | Severity | Area | Finding | Resolution |
| --- | --- | --- | --- | --- |
| S1 | **High** | Dependencies | `npm audit` reported 6 advisories: 2 critical (vitest), 1 high (Vite 5 bundled by vitest: path traversal), 3 moderate (esbuild dev server, vite-node, @vitest/mocker). All were in dev tooling; the production bundle was not affected. | **Fixed.** vitest 2 → 5; `npm audit` now reports 0. CI runs `npm audit --audit-level=high`. vitest 5 no longer excludes `dist/` by default, so `vitest.config.ts` restores the exclusion. |
| S2 | **High** | Password storage | scrypt used N=2¹⁴, r=8, p=1, below the OWASP minimum, and ran synchronously, blocking the event loop for every login. | **Fixed.** Async scrypt with N=2¹⁴, r=8, p=5 (OWASP-equivalent, about 16 MB memory, ~0.2 s). Parameters are stored in the hash (`scrypt$N$r$p$salt$hash`); legacy hashes still verify and are re-hashed on the next login. |
| S3 | **High** | Rate limiting | Behind a reverse proxy, every request came from the proxy's address, so 20 failed attempts in total would lock *all* users out for 15 minutes. | **Fixed.** `TRUST_PROXY` configures Fastify `trustProxy`. It must be set in the deployment (Prompt 035). |
| S4 | **High** | Security headers | No security headers on API or web responses. | **Fixed.** The API sends CSP `default-src 'none'`, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CORP/COOP and `Permissions-Policy`. The web app has a strict CSP (`script-src 'self'`, no inline scripts or styles, `frame-ancestors 'none'`) in `webSecurityHeaders`, applied by `vite preview`; the e2e suite runs the production bundle under it with no violations. |
| S5 | Medium | CSRF | Protection relied on `SameSite=Lax` alone, and Fastify also accepted `text/plain` bodies, which cross-site HTML forms can send. | **Fixed.** Only JSON bodies are accepted (other types get `415`). State-changing requests with a foreign `Origin` get `403 CROSS_ORIGIN_REJECTED`. The allowed origins come from `WEB_ORIGIN`; if it is empty, the `Origin` must match the request's `Host`, so the Vite proxy keeps `changeOrigin: false`. |
| S6 | Medium | Input validation / integrity | Attempts stored the client-supplied `prompt`, so history could be falsified with arbitrary text of up to 1 MB. | **Fixed.** The prompt is derived on the server from the entry and direction; the client value is ignored. |
| S7 | Medium | Input limits | All routes accepted 1 MB bodies. `submittedAnswer` and `sourceName` had no length limit and were stored in full. Some handlers threw a 500 for a missing body. | **Fixed.** 64 KB body limit, 2 MB for imports only. Answers are limited to 500 characters (`ANSWER_TOO_LONG`) and file names to 200 characters (`INVALID_SOURCE_NAME`). A missing body returns a 4xx. |
| S8 | Medium | Configuration | Without `DATABASE_PATH`, the API silently used an in-memory database, and all data was lost on restart. | **Fixed.** In production the API refuses to start without a persistent `DATABASE_PATH`. The unused `SESSION_SECRET` was removed from `.env.example`. |
| S9 | Low | Error exposure | Unknown routes returned Fastify's own message and format. | **Fixed.** A uniform `404 NOT_FOUND` body. 5xx responses were already generic, with details only in the log. |
| S10 | Low | Logging | Logs contained no secrets, but nothing enforced it. | **Fixed.** A pino redaction list (cookies, authorization, `set-cookie`, passwords, tokens), plus a test that asserts no password, session token or hash appears in the logs. |

## Regression found after the review

The first version of S5 broke login and registration in development (`403` for every POST, on `localhost` and on LAN addresses). Vite's shorthand proxy sets `changeOrigin: true`, which rewrites `Host` to the API's address, so the same-host fallback never matched. The e2e suite missed it because it set `WEB_ORIGIN` explicitly. Fixed: the proxy forwards the original `Host`, and the e2e suite now runs without `WEB_ORIGIN`, exactly like `npm run dev`.

## Checks performed without findings

- **Authentication and sessions:** 256-bit random tokens, stored only as SHA-256 hashes; `HttpOnly`, `SameSite=Lax` and `Secure` (production) cookies; a new token on every login (no session fixation); logout revokes the session; 14-day absolute expiry (ADR-005).
- **Authorization:** one deny-by-default guard; `/api/v1/admin/*` requires `administrator` whatever the route configuration says. Tested for every route at the API layer (`session-auth.test.ts`, `authorization.test.ts`) and in the browser (`access-control.spec.ts`).
- **Login enumeration:** unknown usernames and wrong passwords produce identical responses and comparable timing (dummy hash).
- **JSON parsing:** Fastify's secure JSON parser rejects `__proto__` and `constructor` poisoning. Vocabulary imports are parsed into plain objects and only known fields are read.
- **XSS:** Vue escapes all interpolation, and there is no `v-html` or `innerHTML`. The CSP forbids inline and foreign scripts.
- **Personal data in responses:** password hashes and user IDs of other users never appear; sessions omit `userId`; API responses are `Cache-Control: no-store`.
- **Database and backup exposure:** the API serves no static files, and `*.db` files are git-ignored. Nothing serves the `database/` directory.

## Deferred with a decision

| # | Item | Why deferred | Owner |
| --- | --- | --- | --- |
| D1 | The production web host must send `webSecurityHeaders`, HSTS, and an SPA fallback | There is no production host yet | Prompt 034 |
| D2 | Deployment must set `TRUST_PROXY` and `WEB_ORIGIN`, restrict SQLite file permissions (0600), keep backups outside any served directory, and terminate HTTPS | Depends on the hosting decision (OPEN DECISION 009) | Prompt 035 |

## Accepted risks

| Risk | Rationale |
| --- | --- |
| Registration reveals whether a username is taken | Inherent to username accounts without email; mitigated by the rate limit |
| No per-username lockout (the rate limit is per client address) | A lockout would let anyone lock a child out of their account; strong hashing and the rate limit make online guessing slow |
| No idle session timeout (14-day absolute) | Low-value data; shared devices log out explicitly; revisit if needed |
| Request logs include client IP addresses | Needed for abuse handling; retention is part of OPEN DECISION 011 |

## Repeating the checks

```sh
npm audit --audit-level=high                         # also runs in CI
npm test --workspace @taptalk/api                    # security.test.ts, password-hashing.test.ts, auth tests
npm run test:e2e -- --project=pwa                    # production bundle under the CSP
```
