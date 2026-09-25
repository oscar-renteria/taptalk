# Prompt 034 — Production Build and Deployment Plan

- **Status:** `IN PROGRESS` — implementation is being delivered incrementally; acceptance validation is not yet complete.
- **Date:** 2026-09-25
- **Approved hosting direction:** Google Cloud Free Tier VM + Docker Compose + Caddy + GitHub Actions/GHCR + persistent SQLite volume.

## Roadmap status

- **Prompt 034:** `IN PROGRESS`
- **Prompt 035:** `NOT STARTED`
- **Prompt 036:** `NOT STARTED`

## Decision

TapTalk will be deployed as a small same-origin application on a Google Cloud Compute Engine VM. Docker Compose will run the API and Caddy, Caddy will terminate HTTPS and serve the built Vue PWA, and the Fastify API will use a persistent SQLite volume. GitHub Actions will validate releases, build immutable API and web images, publish them to GitHub Container Registry (GHCR), and deploy an approved image to the VM.

GitHub Pages and Render's free web-service tier will not be the primary deployment target. GitHub Pages cannot run the Fastify API or persist SQLite data, and splitting the frontend and API would undermine the current same-origin cookie, CORS, CSRF, and PWA routing model. Render's free services do not provide persistent disks and may sleep or restart, which is incompatible with durable SQLite storage.

This document plans the work across the roadmap prompts:

- **Prompt 034:** production build, configuration, logging, health/readiness, migrations, and graceful shutdown.
- **Prompt 035:** Docker, Caddy, persistent storage, HTTPS, backup/restore, and deployment documentation.
- **Prompt 036:** CI/CD, image publishing, approval, deployment, and rollback.

## Goals

- Build reproducibly from a clean checkout with `npm ci` and the production build command.
- Fail fast with actionable messages when production configuration is missing or invalid.
- Keep development, test, and production settings separate.
- Serve the API and PWA from one HTTPS origin.
- Run the API as a non-root container with explicit signal handling.
- Run SQLite migrations before the API becomes ready.
- Persist SQLite outside the container filesystem.
- Inject secrets through the VM or GitHub deployment secret management, never through the repository or image.
- Document health checks, backups, restore, deployment, and rollback procedures.

## Non-goals and limits

- Do not migrate TapTalk from SQLite to a hosted database in these prompts.
- Do not use GitHub Pages as the application host.
- Do not use Render's free web-service tier for the production database.
- Do not design for multiple API replicas while using a single local SQLite writer.
- Do not commit `.env` files, database files, SSH keys, cloud credentials, or real user data.
- Do not add automatic production deployment before environment protection and rollback are documented and tested.

## Target architecture

```text
Internet
   │
   ▼
Caddy (HTTPS :443, static web assets, SPA fallback)
   │
   └── reverse proxy /api/*, /health, /ready
          │
          ▼
      Fastify API (:3000)
          │
          ▼
  SQLite /data/taptalk.db
          │
          ▼
  persistent Docker volume on the VM disk

GitHub push/tag
   └── GitHub Actions
         ├── quality and production validation
         ├── build API and web images
         ├── push immutable images to GHCR
         └── approved SSH deployment to the VM
```

The API port is exposed only on the private Compose network. Caddy is the only public application ingress. The browser uses relative `/api` URLs, so the production browser origin and API origin remain identical and the existing `SameSite=Lax`, `Secure` cookie, origin guard, and no-production-CORS policy remain effective.

## Google Cloud host

Use the smallest currently eligible Google Cloud Compute Engine free-tier shape for the selected region. The historical `e2-micro` allowance is a likely candidate, but the current machine type, region, persistent-disk quota, external-IP rules, and outbound-transfer allowance must be verified in the Google Cloud console immediately before provisioning. Free-tier quotas and eligibility are provider-controlled and can change.

The VM should use a supported current Ubuntu or Debian release, Docker Engine with the Compose plugin, a dedicated persistent disk for application data, and a restricted firewall:

- Allow SSH only from the administrator's source range or through a bastion.
- Allow inbound HTTP on port 80 for ACME challenges and redirect to HTTPS.
- Allow inbound HTTPS on port 443.
- Do not expose the API's port 3000 publicly.
- Keep the deployment user and SSH key separate from the application container user.
- Store the production environment file on the VM with mode `0600` and owner restricted to the deployment user.

Use a real DNS name for Caddy so ACME certificate issuance and renewal work. The VM and its persistent disk are not backups; encrypted backups must be copied outside the VM.

## Environment contract

The production process should consume a validated configuration object. The exact parser may use the repository's existing Zod dependency, but it must be a direct, typed API dependency if imported by the API workspace.

| Variable              | Production requirement                               | Purpose                                          |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| `NODE_ENV`            | Exactly `production`                                 | Enables secure cookie and strict origin behavior |
| `API_HOST`            | `0.0.0.0` inside the container                       | Bind address for Fastify                         |
| `API_PORT`            | Valid integer, normally `3000`                       | Internal API listener                            |
| `DATABASE_PATH`       | Absolute persistent path such as `/data/taptalk.db`  | SQLite location                                  |
| `WEB_ORIGIN`          | Exact `https://` browser origin, no path or wildcard | Production origin/CSRF policy                    |
| `TRUST_PROXY`         | `true` only behind the single Caddy proxy            | Correct client IP rate limiting                  |
| `AUTH_RATE_LIMIT_MAX` | Positive integer                                     | Login/registration abuse protection              |
| `LOG_LEVEL`           | Supported production level such as `info`            | Structured stdout logging                        |
| `SHUTDOWN_TIMEOUT_MS` | Positive bounded integer                             | Graceful shutdown deadline                       |

A missing `DATABASE_PATH`, an in-memory database, a wildcard or malformed `WEB_ORIGIN`, an invalid port, or an invalid proxy/logging/rate-limit value must stop startup with a message naming the invalid setting. Existing environment variables take precedence over development files, and production must never load a repository `.env` file.

There is no `SESSION_SECRET` in the current design; do not add one without a separate security decision. If a future secret is required, inject it through the VM secret file or GitHub Actions secrets and redact it from logs.

## Same-origin routing and security

Caddy, not the API, is the production static-file host and reverse proxy. It must:

- Redirect HTTP to HTTPS and obtain/renew certificates.
- Serve `apps/web/dist` with hashed assets cached immutably.
- Use no-cache or short-cache headers for `index.html`, `sw.js`, and the web manifest.
- Return `index.html` for Vue Router navigations that are not API or health routes.
- Proxy `/api/*`, `/health`, and `/ready` to `api:3000`.
- Preserve the public host and forwarded headers needed by the origin guard.
- Apply the web CSP, `X-Content-Type-Options`, frame policy, referrer policy, permissions policy, and HSTS.
- Never serve the SQLite volume, backups, `.env`, or the `database/` directory.
- Preserve `Cache-Control: no-store` on all API responses.

Keep production CORS disabled. Do not weaken the origin guard to compensate for a split frontend/API deployment.

## Prompt 034 implementation — production build and runtime

### 1. Central configuration validation

Create a typed configuration module in the API workspace, for example:

```text
/home/rakzo/Development/Playground/TapTalk/apps/api/src/config.ts
/home/rakzo/Development/Playground/TapTalk/apps/api/src/config.test.ts
```

Parse configuration once at process startup rather than interpreting `process.env` independently in multiple modules. The repository already uses Zod in the shared workspace; if the API imports it, declare it as a direct API dependency rather than relying on workspace hoisting.

Validation must reject, with a message naming the setting:

- missing or empty `DATABASE_PATH` in production;
- `:memory:` in production;
- a relative or otherwise unsuitable production database path;
- malformed, wildcard, path-bearing, or non-HTTPS `WEB_ORIGIN`;
- invalid or out-of-range `API_PORT` and `SHUTDOWN_TIMEOUT_MS`;
- invalid `TRUST_PROXY` and `AUTH_RATE_LIMIT_MAX` values;
- unsupported `LOG_LEVEL` values;
- a missing or invalid production environment mode.

Update `/home/rakzo/Development/Playground/TapTalk/apps/api/src/load-env.ts` so development explicitly loads the development file, tests never load a developer `.env`, and production never loads a repository environment file. Shell and deployment variables must take precedence over file values.

Add focused unit tests for valid production configuration, every missing required value, invalid values, mode separation, and the fact that production ignores `ENV_FILE`.

### 2. Separate server construction from process startup

Refactor `/home/rakzo/Development/Playground/TapTalk/apps/api/src/server.ts` so that:

- `buildServer()` remains a side-effect-free Fastify factory for tests and embedded callers;
- a separate entry point loads configuration, opens the database, starts listening, and installs process handlers;
- importing the server module does not unexpectedly bind a production port;
- database ownership is explicit: the entry point closes the database after the server.

A possible layout is:

```text
/home/rakzo/Development/Playground/TapTalk/apps/api/src/main.ts
/home/rakzo/Development/Playground/TapTalk/apps/api/src/config.ts
/home/rakzo/Development/Playground/TapTalk/apps/api/src/cli/migrate.ts
```

The exact filenames may follow existing conventions, but the lifecycle responsibilities must be separated.

### 3. Explicit migration phase

Add a production migration command that opens the configured database, applies pending SQL migrations, and closes the database with a clear exit code. The API should not be considered ready until this phase succeeds.

For the initial single-VM deployment, the container start sequence may run migrations before the API process. For a future multi-instance deployment, move migrations to a one-shot release job before starting replicas.

Test migrations against:

- a fresh database;
- a database with pending migrations;
- repeated execution with no changes;
- a failing migration, including transaction rollback;
- a production database path.

### 4. Liveness and readiness

Keep the existing liveness route:

```http
GET /health
```

Add a readiness route:

```http
GET /ready
```

`/health` should report that the process is alive without exposing dependency details. `/ready` should return success only after configuration, database opening, and migrations are complete. It should return `503` during initialization, while draining, or when the database cannot be queried.

Readiness responses must not expose database paths, SQL errors, environment values, stack traces, or internal hostnames. Document both endpoints, their status codes, and their use by Docker, Caddy, and GitHub deployment checks.

### 5. Production logging and graceful shutdown

Configure Fastify/Pino to emit structured JSON to stdout with a validated `LOG_LEVEL`. Preserve the existing redaction paths and add focused tests proving that passwords, cookies, authorization headers, tokens, and password hashes do not appear in logs.

The production entry point must handle both `SIGTERM` and `SIGINT` exactly once:

1. Mark readiness false.
2. Stop accepting new connections.
3. Allow in-flight requests to finish.
4. Close Fastify.
5. Close SQLite.
6. Emit a structured shutdown message.
7. Exit successfully, or force termination after `SHUTDOWN_TIMEOUT_MS`.

Test this with a child process or an integration harness, not only with mocked function calls.

### 6. Production build contract

Add a root `build:production` command that:

1. Cleans prior production output.
2. Builds the shared package.
3. Compiles the API using a production TypeScript configuration that excludes tests.
4. Builds the Vite PWA.
5. Verifies that expected artifacts exist.

The current API build includes test modules in `dist`; a production build should emit runtime modules, shared contracts, and migrations without `*.test.js` files. The web build should continue to generate `index.html`, hashed assets, `manifest.webmanifest`, and the service worker.

A clean checkout must be able to run:

```sh
cd /home/rakzo/Development/Playground/TapTalk
npm ci
npm run build:production
```

The build must not require production secrets merely to compile. Secrets are runtime/deployment inputs, not build-time source inputs.

## Prompt 035 implementation — Docker, Caddy, and persistent storage

### Container image

Add a multi-stage `/home/rakzo/Development/Playground/TapTalk/Dockerfile` with named `build`, `api`, and `web` stages:

- Use a pinned Node 22 Debian-slim-compatible base for the build and API stages.
- Run `npm ci` in the build stage and `npm run build:production`.
- Install only production dependencies in the API runtime with `npm ci --omit=dev`.
- Copy the compiled API, shared package output, web output, and database migrations into the appropriate images.
- Run the API as a non-root user with a writable `/data` directory.
- Add a health check that calls `/ready` using Node's built-in `fetch`; do not add a shell/curl dependency solely for health checking.
- Set `STOPSIGNAL SIGTERM` and use an exec-form process command.

Add `/home/rakzo/Development/Playground/TapTalk/.dockerignore` that excludes at least:

```text
node_modules
.git
.env
.env.*
!.env.example
coverage
playwright-report
test-results
database/*.db
database/*.db-*
*.log
```

The untracked `/home/rakzo/Development/Playground/TapTalk/database/dataset.json` must not be copied into a production image unless the deployment design explicitly requires it.

### Compose topology

Add `/home/rakzo/Development/Playground/TapTalk/compose.production.yml` with two services:

- `api`: internal port 3000, persistent database mount, health check, and restart policy;
- `caddy`: ports 80 and 443, static web assets, reverse proxy routes, and persistent Caddy data/config volumes.

Use an explicit named volume:

```text
taptalk-data:/data
```

and configure:

```dotenv
DATABASE_PATH=/data/taptalk.db
```

Do not publish the API port to the host. The API must be reachable only from Caddy over the Compose network. Keep Caddy's certificate state in named volumes so certificate renewal survives container replacement.

### Caddy configuration

Add `/home/rakzo/Development/Playground/TapTalk/deploy/Caddyfile` and a matching web image. The configuration should:

- use the production domain from an injected environment value;
- redirect port 80 to HTTPS;
- serve hashed static assets with immutable caching;
- prevent caching of `index.html`, `sw.js`, and the manifest;
- return the SPA fallback only for web navigation routes;
- proxy API and health/readiness paths before applying the fallback;
- forward the original host and appropriate proxy headers;
- apply the production web security headers and HSTS;
- avoid access to `.env`, database files, and backup directories.

Keep the API's strict production origin guard enabled. Do not enable permissive CORS in production.

### Backup and restore

Add a documented and tested backup procedure outside the served web root. Prefer a SQLite-aware backup or `VACUUM INTO` over copying an active database file without accounting for SQLite journal state.

The procedure must:

1. Create a backup outside the web root.
2. Verify the backup with SQLite integrity checks.
3. Copy it to storage outside the VM.
4. Document retention and encryption expectations.
5. Test restoration into a clean temporary directory.
6. Test restoring a database before starting the application.
7. Document forward-only migration behavior and rollback constraints.

Prompt 035 is complete only after a container restart proves that SQLite data survives and a backup/restore exercise has succeeded.

## Prompt 036 implementation — GitHub Actions, GHCR, and deployment

### Correct the branch trigger

The current checkout is on `master`, while the existing workflow triggers pushes to `main`. Before adding release automation, either rename the default branch to `main` (recommended) or explicitly support both branches. Do not leave a release workflow that silently runs on the wrong branch.

### CI validation

Extend `/home/rakzo/Development/Playground/TapTalk/.github/workflows/ci.yml` to run, from a clean `npm ci` install:

```sh
npm run lint
npm run typecheck
npm test
npm run build:production
```

Keep Playwright as a separate job. The current Playwright configuration shares a throwaway SQLite database, so browser invocations must remain sequential when they share the database.

Add a Docker validation job that builds both image targets, validates the Compose configuration, starts the stack, waits for `/ready`, checks the SPA fallback, sends `SIGTERM`, and verifies clean shutdown.

### Release workflow

Add a protected `production` GitHub environment and a release workflow that:

1. Runs on a version tag or an explicitly approved manual trigger.
2. Requires the normal quality, typecheck, unit/integration, and production-build checks.
3. Optionally runs the browser suite according to release policy.
4. Builds API and web images with immutable commit-SHA tags.
5. Authenticates to GHCR using the repository `GITHUB_TOKEN` with least-privilege permissions.
6. Pushes the images to GHCR.
7. Uses SSH or a provider-native authenticated mechanism to connect to the VM.
8. Pulls the exact approved image tags.
9. Backs up SQLite before changing application versions.
10. Runs migrations using the new image.
11. Updates the Compose deployment.
12. Verifies `/ready` and a real application smoke path.
13. Records the deployed commit, image digests, timestamp, and deployment actor.

Use a GitHub-hosted runner initially. Do not install a self-hosted runner on the production VM until repository trust, runner isolation, ephemeral cleanup, and secret exposure risks have been reviewed.

### Rollback

Before production deployment automation is enabled, document and test:

- the previous known-good image tag or digest;
- whether the previous application version is compatible with the new schema;
- how to stop the deployment safely;
- how to restore the database backup if a migration or release fails;
- how to verify recovery through `/ready` and an authenticated smoke test.

For schema changes, prefer expand/contract migrations: deploy code that can operate with both schemas, migrate, then remove old schema support in a later release. Never assume that replacing a container alone rolls back a database migration.

## Acceptance and validation matrix

| Requirement                              | Verification                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Clean production build                   | Fresh checkout, `npm ci`, and `npm run build:production`                                   |
| Missing configuration fails clearly      | Start the built API with incomplete production variables and assert the named error        |
| Development/test/production separation   | Unit tests for environment loading, config parsing, and mode-specific behavior             |
| Health checks are documented             | Operations guide and integration tests for `/health` and `/ready`                          |
| Secrets are injected safely              | Image inspection, CI secret checks, VM file permissions, and no committed secrets          |
| No development credentials in production | Production configuration tests and image/content review                                    |
| Production logging                       | Structured output, configured level, and redaction tests                                   |
| Graceful shutdown                        | `SIGTERM`/`SIGINT` integration test with SQLite closed cleanly                             |
| Migrations                               | Fresh, pending, repeated, and rollback-path tests                                          |
| HTTPS and SPA routing                    | Caddy smoke tests for deep links, security headers, and API proxying                       |
| Persistent SQLite                        | Compose restart test proving user data remains                                             |
| Backup and restore                       | Documented restore exercise into a clean location                                          |
| CI artifact quality                      | Lint, typecheck, unit/integration tests, browser tests, and production build               |
| Release safety                           | Protected environment, approval, immutable image, recorded deployment, and tested rollback |

A final local validation sequence should be:

```sh
cd /home/rakzo/Development/Playground/TapTalk
npm ci
npm run lint
npm run typecheck
npm test
npm run build:production
```

If Docker is available:

```sh
docker build --target api -t taptalk-api:local .
docker build --target web -t taptalk-web:local .
docker compose -f compose.production.yml config
```

Do not run the production Compose stack against a developer database or a real user database. Use a disposable data path for local container validation.

## Implementation order and completion gates

### Gate A — Prompt 034

1. Add central configuration validation and tests.
2. Separate API construction from process startup.
3. Add explicit migration execution and tests.
4. Add readiness, logging, and graceful shutdown.
5. Add a clean production build that excludes test artifacts.
6. Update environment and operations documentation.
7. Run the full quality gate and a production-mode smoke test.

### Gate B — Prompt 035

1. Add the multi-stage Dockerfile and `.dockerignore`.
2. Add the production Compose topology and named SQLite volume.
3. Add Caddy static hosting, reverse proxying, HTTPS, and security headers.
4. Document Google Cloud VM setup and environment injection.
5. Test persistence across restarts.
6. Test backup and restore.

### Gate C — Prompt 036

1. Normalize the GitHub branch trigger.
2. Add production Docker validation to CI.
3. Add GHCR publishing with immutable tags.
4. Configure protected production approval.
5. Add VM deployment, health verification, version recording, and rollback.
6. Run a complete release rehearsal from a clean checkout.

## Open decisions to resolve during implementation

- The exact Google Cloud free-tier machine type, region, disk size, and quota must be confirmed at provisioning time.
- The production DNS name and whether an existing domain is available must be decided before Caddy configuration.
- The exact GitHub owner/repository path and GHCR image names must be confirmed before writing the release workflow.
- The SSH deployment mechanism and secret names must be agreed before enabling automated deployment.
- The backup destination, encryption method, retention period, and restore test environment must be selected.
- The production version tag and release approval policy must be recorded.
- The untracked `/home/rakzo/Development/Playground/TapTalk/database/dataset.json` must remain untracked and must not be accidentally included in an image or commit.

## Final decision record

The selected production direction is:

> **Google Cloud Free Tier VM + Docker Compose + Caddy + GitHub Actions/GHCR + persistent SQLite volume**

GitHub Pages and Render's free web-service tier are explicitly rejected as the primary deployment target. The same-origin security model, HttpOnly session cookie, CSRF origin guard, PWA navigation fallback, and SQLite persistence requirements are all better served by the small persistent VM deployment described above.
