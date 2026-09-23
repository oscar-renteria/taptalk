# ADR-006: Account Identifier and Credential Policy

- **Status:** Accepted (resolves OPEN DECISION 001; product decision 2026-09-23).
- **Date:** 2026-09-23
- **Requirements:** PR-001, PR-002, NFR-002, NFR-003

## Context

TapTalk accounts must not require email (PR-001). Learners may be children, so rules must be easy to understand. Credentials still need to resist trivial guessing, and the API must not become a password-guessing oracle.

## Decision

- **Identifier:** a username of 2–32 characters. Allowed are letters from any script, digits, `.`, `-` and `_`. Leading and trailing whitespace is trimmed. Uniqueness is case-insensitive (`LOWER(username)` unique index).
- **Credential:** a password of 8–128 characters. It must contain at least 4 distinct characters, must not contain the username, and must not appear on a small list of very common passwords (`packages/shared`). The 128-character limit bounds hashing cost. A PIN-only credential is not supported, because a short numeric PIN cannot withstand offline guessing.
- **Hashing:** Node's `scrypt` with a 16-byte random salt per password and a 64-byte key. Only `salt:hash` is stored (NFR-002).
- **Validation:** one Zod schema (`registrationSchema`) runs in the browser for immediate feedback and on the server as the authority. Errors are field-level messages that never echo the submitted password.
- **Abuse mitigation:** login and registration share a fixed-window, per-client-IP limit (default 20 attempts per 15 minutes, `AUTH_RATE_LIMIT_MAX`). Exceeding it returns `429 RATE_LIMITED` with `Retry-After`. The limiter is in memory, which matches the single-process deployment in ADR-001.
- **Failures:** registration writes the user, preferences and session in one transaction. A unique-index conflict returns `409 USERNAME_UNAVAILABLE`. Any other storage failure returns `500 INTERNAL_ERROR` with a generic message, and details go to the log only.
- **Recovery:** there is no self-service recovery, because there is no email. An administrator can help a learner create a new account. Password reset by an administrator remains open.

## Alternatives

- PIN-equivalent credentials: easier for young children, but too weak without device binding or lockout.
- A large breached-password list: stronger, but adds a dependency and size. It can be added later behind the same schema.
- `@fastify/rate-limit`: a feature-rich dependency. It is not needed for one limit in a single process.

## Consequences

- Behind a reverse proxy, the limiter needs Fastify `trustProxy` configured so that `request.ip` is the client address. This is tracked for Prompt 035.
- Restarting the API resets the rate-limit counters.
- Learners who share one network address (for example a classroom) share one limit, so the default may need tuning.
