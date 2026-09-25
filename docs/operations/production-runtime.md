# Production runtime

This guide covers the API runtime delivered in Prompt 034. Docker Compose, Caddy, persistent-volume operations, HTTPS provisioning, and backup/restore are implemented in Prompt 035.

## Build the artifact

Use Node.js 22 or newer and npm 10 or newer. From the repository root:

```sh
npm ci
npm run build:production
```

The command cleans `packages/shared/dist`, `apps/api/dist`, and `apps/web/dist`, builds shared contracts before the API, excludes TypeScript test files from production output, copies SQL migrations into `apps/api/dist/migrations`, builds the Vite PWA, and verifies the required runtime and migration files. It does not require production secrets to compile. `npm run build` remains the developer build and may include test output in `dist`.

The production API entry point is `apps/api/dist/main.js`. Run migrations explicitly when the deployment process uses a separate migration job:

```sh
NODE_ENV=production \
DATABASE_PATH=/data/taptalk.db \
WEB_ORIGIN=https://taptalk.example \
node apps/api/dist/cli/migrate.js
```

The normal API entry point also applies pending migrations before it listens. A migration failure prevents readiness and causes startup to fail.

## Configuration

Production configuration is supplied by the process environment, VM secret management, or the container environment. The API never loads a repository `.env` file when `NODE_ENV=production`.

| Variable              | Production requirement                                            | Purpose                                                           |
| --------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| `NODE_ENV`            | Exactly `production`                                              | Enables secure cookies and strict origin behavior                 |
| `API_HOST`            | `0.0.0.0` in a container                                          | Fastify bind address                                              |
| `API_PORT`            | Integer from `1` to `65535`, normally `3000`                      | Internal listener port                                            |
| `DATABASE_PATH`       | Absolute, persistent SQLite file, such as `/data/taptalk.db`      | Durable application data                                          |
| `WEB_ORIGIN`          | Required exact HTTPS origin, such as `https://taptalk.example`    | Allowed browser origin and same-origin CSRF guard                 |
| `TRUST_PROXY`         | `true` behind the single Caddy proxy, or an explicit IP/CIDR list | Correct client IP rate limiting                                   |
| `AUTH_RATE_LIMIT_MAX` | Positive integer                                                  | Login and registration attempts per client address per 15 minutes |
| `LOG_LEVEL`           | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`   | Structured log severity                                           |
| `SHUTDOWN_TIMEOUT_MS` | Integer from `1000` to `120000`                                   | Maximum graceful drain time                                       |

`WEB_ORIGIN` accepts a comma-separated list of origins when more than one browser origin is intentionally allowed, but each value must be a non-wildcard origin without a path, query, fragment, or credentials. Production CORS remains disabled. A value such as `*`, `http://taptalk.example`, or `https://taptalk.example/app` stops startup with a configuration error.

Do not commit `.env` files, database files, passwords, session values, SSH keys, or cloud credentials. Keep the production environment file readable only by the service account and inject it through the deployment mechanism.

## Startup order

1. Load the environment (the repository `.env` loader is skipped in production).
2. Parse and validate the complete configuration.
3. Open SQLite without migrating implicitly.
4. Apply pending SQL migrations transactionally.
5. Bind Fastify to `API_HOST:API_PORT`.
6. Mark `/ready` successful and log the listening address.

Startup errors are written to stderr and the process exits unsuccessfully. A missing or unsuitable production database path is always a startup error.

## Health and readiness

Both endpoints are public and return no database path, SQL detail, environment value, or stack trace:

| Endpoint      | Success                     | Unavailable                                         | Use                                                                   |
| ------------- | --------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| `GET /health` | `200 { "status": "ok" }`    | Connection failure means the process is not serving | Liveness/restart probe                                                |
| `GET /ready`  | `200 { "status": "ready" }` | `503 { "status": "not_ready" }`                     | Deployment gate, container health check, and Caddy upstream readiness |

`/health` proves only that the process can serve HTTP. `/ready` is database-backed: it returns `200` only after migrations and startup complete, and returns `503` while the readiness flag is false or the database query fails. A reverse proxy should proxy `/api/*`, `/health`, and `/ready` to the API before applying its web fallback.

Example readiness check without adding a runtime dependency:

```sh
node --input-type=module -e "const r = await fetch('http://127.0.0.1:3000/ready'); if (r.status !== 200) process.exit(1)"
```

## Logging and shutdown

Fastify/Pino writes structured JSON to stdout at `LOG_LEVEL`. The redaction list covers cookies, authorization headers, set-cookie values, passwords, password hashes, and tokens. Application errors use a generic client response; details remain in logs only.

Send `SIGTERM` for an orchestrated container stop or `SIGINT` for a local process stop. The entry point handles each signal once, marks readiness false, stops accepting new connections, lets Fastify finish in-flight requests, closes SQLite, and logs completion. If graceful closing exceeds `SHUTDOWN_TIMEOUT_MS`, the process exits with status `1`. Repeated signals are ignored while shutdown is already in progress.

## Operations checklist

- Run `npm run db:migrate` or the compiled migration command against a disposable/staging database first.
- Verify `/ready` through the same origin users use, not only from inside the VM.
- Confirm `TRUST_PROXY` matches the actual Caddy network path; never enable it for an untrusted direct network.
- Keep SQLite and backups outside the web root. The named volume, backup/restore exercise, and Compose restart test are documented in [production container deployment](production-deployment.md).
- Inspect production logs for structured startup, readiness, and shutdown messages without logging secrets.
