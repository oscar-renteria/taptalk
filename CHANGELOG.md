# Changelog

## Unreleased

### Added

- `GET /api/v1/auth/session` answers `200 { user }` or `200 { user: null }`; the web app uses it for the startup session check, so signed-out visits no longer log a 401 in the browser console.
- Automated accessibility suite (`e2e/accessibility.spec.ts`): axe-core WCAG 2.2 AA scans of 12 screen states, a keyboard-only journey, touch-target, reflow, reduced-motion, non-colour feedback and language checks (Prompt 031).
- PWA: PNG and maskable icons, a complete manifest, an update prompt instead of automatic reloads, `Cache-Control: no-store` on API responses, and a Playwright `pwa` project that checks installability, cache contents and offline start against the production build (Prompt 028).
- Practice screen tests for success, wrong-answer, loading, failure and error states, single submission and retry; documented in `docs/engineering/practice-screen.md` (Prompt 023).
- Login and registration screens with shared client-side validation, field-level server errors, focus on the first invalid field, a password visibility toggle and double-submit protection (Prompt 017).
- URL routing with `vue-router`: `/login`, `/register`, `/practice`, `/progress`, `/settings`, `/admin/import`, a not-found page, guarded redirects with safe return paths, session-expiry handling, and an error boundary (Prompt 016).
- Design system: CSS tokens and reusable components (`AppButton`, `TextField`, `SelectField`, `AppCard`, `StatusMessage`, `ProgressIndicator`, `LoadingState`, `ErrorState`, `StatTile`, `AppNav`) with component tests and `docs/engineering/design-system.md` (Prompt 015).
- Weighted, explainable question selection (`docs/architecture/question-selection.md`): new and error-prone words are favoured, the previous word is not repeated, `random` direction is resolved per question, and questions carry a `selectionReason` (Prompt 019).
- Answer matching policy v1 (`apps/api/src/matching.ts`, `docs/architecture/answer-matching.md`): whitespace, punctuation, quote, ellipsis and case normalization, optional parenthesized parts, and `exact-match` / `normalized-match` / `empty-answer` / `invalid-answer` / `incorrect` classification (Prompt 018).
- Centralized role policy (`authorize`) with non-downgradable `administrator` access for `/api/v1/admin/*` (Prompt 011).
- Central deny-by-default authentication guard for `/api` routes, `Secure` cookies in production, expired-session cleanup and timing-safe login for unknown usernames (Prompt 010).
- Shared credential policy (`registrationSchema`, ADR-006) with field-level registration errors; per-IP rate limiting of login and registration (`AUTH_RATE_LIMIT_MAX`); transactional registration with safe `500 INTERNAL_ERROR` mapping (Prompt 009).
- Practice sessions: `POST /api/v1/practice/sessions`, `POST /api/v1/practice/sessions/:id/end` and `GET /api/v1/practice/sessions/:id`, with migration `002_practice_sessions.sql` (Prompts 022, 024).
- Practice screen shows session progress, a next-question action, an end-session action and a completion summary with practice-again and progress actions (Prompts 023, 024).
- `npm run set-role --workspace @taptalk/api -- <username> <role>` for administrator provisioning (Prompt 011).
- "Questions per session" setting.

- Playwright end-to-end suite (`npm run test:e2e`) covering registration, login, settings, practice feedback, dashboard, administrator import and unauthorized access at mobile and tablet viewports (Prompt 030).
- CI `e2e` job that uploads the Playwright report and failure traces as artifacts.
- `API_PROXY_TARGET` environment variable for the Vite dev proxy (defaults to `http://localhost:3000`).

### Changed

- Answers typed with umlaut or ß transliterations (`ae`, `oe`, `ue`, `ss`) now count as correct (`spelling-variant-match`). The credential, matching and scoring policies are accepted, and vocabulary filters are deferred to OPEN DECISION 004 (product decisions 2026-09-23).
- `App.vue` is now a shell; each screen is a routed view in `apps/web/src/views/`. Navigation items are links (Prompt 016).
- Scoring applies the documented per-word penalty for earlier errors in the same session (`docs/architecture/scoring.md`); previously the penalty input was always 0 (Prompt 020).
- Import merges alternatives that are equal after normalization and rejects German values with no answerable content (Prompt 018).

### Fixed

- `npm run dev` ignored `.env` and used an in-memory database, so data was lost on every restart and `set-role` could not reach the running database. The API and CLI now load the repository's `.env` in development, and relative `DATABASE_PATH` values resolve from the repository root.
- Login and registration returned 403 in development after the CSRF origin check was added, because the Vite proxy rewrote the `Host` header; the proxy now keeps it (`changeOrigin: false`).
- Security review (Prompt 032, `docs/security/security-review.md`): dependency advisories removed (vitest 5, CI audit gate); OWASP-strength async scrypt with automatic re-hash; `TRUST_PROXY` for correct per-client rate limiting; security headers and a strict CSP; JSON-only bodies plus an `Origin` check against CSRF; server-derived attempt prompts; body and field length limits; the API refuses to start in production without a persistent database; uniform 404; log redaction.
- Accessibility review (Prompt 031, `docs/engineering/accessibility-review.md`): the progress bar got an accessible name; reflow at 200 % text on 320 px screens; persistent live regions for status messages; `lang="de"` on German prompts and answers; the answer field is described by its question; focus moves to the page heading after navigation.
- The service worker's API rule never matched (the regex was tested against the full URL), and navigations to `/api/` could receive the offline fallback (Prompt 028).
- Fresh checkouts (including CI) failed `npm run typecheck` and `npm test` because `packages/shared/dist` was only built by `npm run build`; the root scripts now build the shared contracts first.
- Correct answers are no longer shown in error red; feedback tone is conveyed by icon and text. Focus ring contrast raised from 2.1:1 to 4.8:1. Text buttons meet the 44px touch target. Stat tiles read as "42 points" instead of "42points" (Prompt 015).
- Practice no longer asks the same first vocabulary entry every time, and `random` direction no longer always means English to German (Prompt 019).
- Login survives a page reload.
- The settings form is locked while loading, and saving no longer resets the session length and repetition preference.
- The vocabulary import success message stays visible, and the preview cannot be committed twice.
- Logging out clears the previous user's practice, dashboard and admin state.
