# Development Tooling

## Local quality checks

Run these commands from the repository root:

```sh
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run build:production
```

`npm run lint` runs ESLint with zero allowed warnings and then checks project-owned files with Prettier. `npm run typecheck` checks shared contracts before the API and web workspaces. `npm test` runs all workspace Vitest suites. `npm run test:coverage` writes text output and HTML reports under each workspace's `coverage/` directory. `npm run build` builds shared contracts, the API, and the PWA in dependency order. `npm run build:production` cleans all output directories, excludes TypeScript test files from API/shared production output, copies SQL migrations into the API artifact, builds the same runtime artifact, and verifies required files with no `*.test.js` or `*.test.d.ts` artifacts.

## Test conventions

- Pure domain and shared-contract behavior uses focused unit tests.
- API and SQLite boundaries use isolated in-memory integration tests.
- Vue interaction tests use `@vue/test-utils` with `happy-dom` and stable semantic selectors.
- Tests must cover successful behavior, invalid input, authorization, user isolation, failure paths, and relevant boundaries.
- Test data is deterministic and never uses production resources or credentials.

## CI parity

The workflow at `.github/workflows/ci.yml` runs `npm ci`, lint, strict typechecking, coverage-enabled tests, and the verifier-backed `npm run build:production` command. It uses Node.js 22 and npm's lockfile so the essential CI checks match the documented local gate.

## Verification evidence

On 2026-09-23, a scoring assertion was intentionally changed to an incorrect expected value. `npm test --workspace @taptalk/api` detected the failure in `apps/api/src/learning.test.ts`; the expectation was immediately restored and the full quality gate passed afterward.
