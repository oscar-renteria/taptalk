# TapTalk

TapTalk is a responsive Vue 3 PWA with a Node.js TypeScript API and SQLite persistence for language practice. The current responsive review covers phone, tablet, narrow, reduced-height, and landscape states; see [responsive review](docs/engineering/responsive-review.md).

## Current status

The workspace foundation, authentication, vocabulary ingestion, practice loop, dashboard, settings, administrator import workflow, PWA build, and backend integration suite are implemented. Remaining roadmap work is tracked in `.roadmap/taptalk_atomic_copilot_prompts.md`.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer

## Development

```sh
cp .env.example .env
npm install
npm run dev
```

`.env` is loaded automatically in development (existing environment variables win), so accounts and vocabulary persist in `database/taptalk.db`. Development mode also enables credentialed CORS from any origin for local tooling; production ignores that override and uses the configured `WEB_ORIGIN`. To import vocabulary, register an account in the app and promote it:

```sh
npm run set-role --workspace @taptalk/api -- <username> administrator
```

Then reload the page and open **Import vocabulary**. The file format is described in [docs/operations/vocabulary-import.md](docs/operations/vocabulary-import.md).

The web app runs at `http://localhost:5173`; the API liveness endpoint is `http://localhost:3000/health` and its readiness endpoint is `http://localhost:3000/ready`.

## Production runtime

The production API entry point is `apps/api/src/main.ts`. It loads the environment, validates configuration, applies pending SQLite migrations, starts Fastify, and handles `SIGTERM`/`SIGINT`. The production artifact command is:

```sh
npm ci
npm run build:production
```

Run migrations independently with `npm run db:migrate` when an operator or deployment job needs a separate migration step. In production, `NODE_ENV=production`, `DATABASE_PATH` must be an absolute persistent path, `WEB_ORIGIN` must be an exact HTTPS origin, and `API_HOST=0.0.0.0` is required when the API runs in a container. The runtime procedure is documented in [production runtime](docs/operations/production-runtime.md); the container, Caddy, persistence, and backup procedure is documented in [production container deployment](docs/operations/production-deployment.md). Before enabling automatic deployment, complete the safe [deployment input checklist](docs/operations/deployment-input-checklist.md).

## Checks

```sh
npm run build
npm run build:production
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run db:migrate
```

## End-to-end tests

```sh
npm run test:e2e:install   # once: downloads Chromium for Playwright
npm run test:e2e
```

The suite starts its own API (port 3100) and web server (port 5174) against a throwaway SQLite database and covers mobile and tablet viewports. See [docs/engineering/e2e-testing.md](docs/engineering/e2e-testing.md).

Follow the atomic roadmap prompts in `.roadmap/taptalk_atomic_copilot_prompts.md` and do not move to a later phase before its gate passes.

CI runs linting, formatting, strict typechecking, coverage-enabled tests, deployment contract tests, and production builds with the same workspace commands, followed by the Playwright suite. The Playwright report is uploaded when it fails.

See [development tooling](docs/engineering/development-tooling.md) for the quality gate, coverage reports, test conventions, and CI parity.
