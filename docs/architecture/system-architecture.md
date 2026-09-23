# TapTalk System Architecture

## Context

TapTalk is a small learning application with a responsive Vue 3 PWA, a Node.js API, and SQLite persistence. The first release uses a modular monolith so deployment and local development remain simple while domain boundaries stay explicit.

## Shape of the system

```text
Browser / installed PWA
        |
        v
apps/web (Vue UI, router, API client)
        |
        v
apps/api (HTTP handlers, auth middleware)
        |
        v
Application services (use cases, orchestration)
        |
        v
Domain modules (matching, scoring, selection, import rules)
        |
        v
Persistence repositories --> database migrations --> SQLite

packages/shared (schemas, DTOs, enums) <---- web and api
```

The browser is an untrusted client. The API owns authorization, validation of trusted operations, answer matching, scoring, and persistence decisions.

## Workspace modules

- `apps/web`: Vue components, routes, application shell, forms, accessible learning views, and API transport client. It must not contain authoritative scoring or authorization.
- `apps/api`: HTTP server, request parsing, authentication/session middleware, authorization, response mapping, and composition of application services.
- `packages/shared`: Runtime schemas and TypeScript types shared across the API and web. It contains no browser, database, or server side effects.
- `database`: Migration files, development database instructions, and database-only operational assets.
- `docs`: Requirements, architecture, ADRs, testing, deployment, and operational guidance.
- Application/domain services: Keep use-case orchestration and pure learning rules separate from HTTP and SQLite. These may live inside `apps/api` initially, but their dependency direction remains explicit.

## Dependency direction

```text
web -> shared
api/http -> application -> domain
api/http -> shared
persistence -> domain interfaces and shared persistence types
domain -> no framework or persistence implementation
```

Repositories are interfaces at the application boundary and SQLite implementations at the persistence boundary. HTTP handlers translate transport input and output; they do not implement learning rules.

## Cross-cutting rules

- Validate input at every trust boundary with shared schemas where the contract is shared.
- Keep authenticated session state in an HTTP-only, secure-in-production cookie according to the session ADR.
- Enforce user ownership and administrator roles in API services, not only in routes or UI controls.
- Use migrations for schema evolution and transactions for imports and attempt-plus-statistics updates.
- Return stable safe errors and avoid sensitive values in logs.
- Test pure domain behavior with unit tests and module boundaries with integration tests.

## Request flow

1. The web client sends a typed request to the API.
2. The API parses and validates the request and resolves the session.
3. Authorization is checked for the use case.
4. An application service invokes domain rules and repositories.
5. The service returns a safe result or typed application error.
6. The API maps that result to the shared response contract.

## First-release boundary

The first release does not require microservices, a separate queue, or a second database. Those can be considered only after measured operational needs justify their cost.