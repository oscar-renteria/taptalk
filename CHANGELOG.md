# Changelog

## 0.2.0 - 2026-09-26

### Changed

- The web UI was rebuilt to the redesign in `.roadmap/redesign.md`: a full-width
  header with brand, underline tabs and an account chip; a two-column dashboard
  with a segmented direction control; a centred practice card with an in-card
  feedback band; a matching summary card; and a phone bottom navigation.
- Newsreader and Instrument Sans are bundled from `@fontsource-variable` and
  served from the app's own origin, so `font-src 'self'` is unchanged. The IPA
  family is not bundled and uses the text font.
- `POST /api/v1/practice/answer` accepts an optional `retry` flag for a second
  attempt. It is checked with the normal matching policy but not recorded, so it
  earns no points and does not affect the session, accuracy, or history.

## Unreleased

### Added

- The Practice vocabulary list in Settings was rebuilt around a single sticky
  toolbar: a three-state master checkbox that says how many rows it will change,
  the search box with the matched text highlighted in each row, All / Selected /
  Not selected filter chips, an English or German A–Z sort, and a Comfortable or
  Compact density. The two bulk buttons are gone, replaced by the master
  checkbox.
- Undo for a bulk action in Settings, with the message kept until it is used,
  dismissed, or the learner leaves: a message that disappears on a timer takes
  the only way back with it. One level, and a single-row toggle does not create
  one.
- The visible set is frozen when the search or filter changes rather than on
  every tick, so unticking a row under "Selected" does not make it vanish from
  under the pointer.
- The remembered Comfortable or Compact density, stored under
  `taptalk.vocabularyDensity` and read in a `try`/`catch`, so a browser that
  blocks storage still gets a usable list.

### Changed

- Vocabulary rows are now two lines, English above German, both starting at the
  same edge instead of pushed to opposite sides, so a pair is read downwards
  rather than across the width of the screen. Several accepted answers are shown
  as separate pills instead of one long string joined with semicolons. Nothing in
  the stored vocabulary is changed: the split is for display only, and the search
  box still matches the original text.
- The checkbox draws a 22px mark inside its 44px target instead of a 44px tick,
  and a selected row is tinted and barred, so the state is readable down the
  list rather than only on the control. The control, its tap target, its focus
  ring and the hidden "selected for practice" text are unchanged, so state is
  still never carried by colour alone.
- The list is sorted in the browser with an `Intl.Collator`, ignoring leading
  punctuation and case, so "(inline) skating" files under I instead of sorting
  ahead of every letter. This is a display sort only: the server's order is
  untouched.
- `LoadingState` was used in the Settings template without being imported, so
  the list rendered nothing at all while the vocabulary was being fetched.
- **An exam no longer reveals correctness while it runs.** The answer endpoint
  returned `{ result: { correct } }` on every submission and the card showed a
  verdict band, a `data-state` of `correct`/`miss`, and a `role="alert"`, so a
  learner was told after every question whether they were right. The response is
  now position and progress only, the store holds no correctness at all, and the
  card has no verdict, no state, and no alert. The evaluation happens after the
  final answer and is the first place correctness appears. This is the
  difference between an exam and a practice round, and it is now enforced by the
  server rather than left to the UI.
- An exam's questions are now drawn and stored when the exam starts, in a new
  `exam_questions` table, instead of being re-selected on every question from the
  learner's live settings. A question set could shift mid-exam if the learner
  opened Settings, and the same entry could be asked twice; a unique index now
  makes a duplicate impossible rather than merely unlikely.
- The exam length is 5, 10, or 20 questions, chosen on the exam start screen,
  instead of being taken from the Practice "questions per session" setting. An
  exam is a test, not a practice round, and a practice preference should not
  decide how long a test is. The start screen states the real number of
  questions, which is capped by the enabled vocabulary: asking for 20 with 12
  words enabled produces 12 questions.
- `POST /api/v1/exams/:id/answer` takes a question `position` rather than a
  vocabulary entry id, so the server resolves which question was actually asked.
  A client can no longer skip ahead, replay a position, or score an entry the
  exam never used.
- An exam completes on its last answer, on the server, instead of when the client
  next asks for the result. A finished exam could otherwise sit in `active`,
  where no statistic can see it.
- Leaving an exam now calls `POST /api/v1/exams/:id/abandon`, so an unfinished
  exam is recorded as `abandoned` rather than left to be discovered later.
- `GET /api/v1/exams/:id/question` serves the frozen question at the current
  position. The exam no longer reuses the live `/api/v1/practice/question`
  selector.

### Fixed

- Clicking a past exam in the Progress history did nothing useful. The row links
  to `/exams?result=<id>`, but the exam screen never read that query, so it
  opened the start screen and a stored result was unreachable from anywhere in
  the app. The screen now reads the id, shows that result, and drops the query
  so a reload does not re-open it. The endpoint already refused an exam that is
  still running, so this cannot be used to read a result early.
- Tapping another tab straight after confirming "Leave exam" bounced the learner
  back to the exam screen. The exam was navigated away from only after the
  abandon request returned, so a tap made in between was undone when that late
  navigation landed. The learner is now taken back immediately and the abandon
  request is left to finish on its own.
- Abandoned exams were counted in the exam history and the exam statistics.
  Both queries excluded only `active` sessions, so an exam the learner left
  part-way appeared as a result. They now count completed exams only, as the
  statistics are defined to.
- `totalQuestionsAnswered` reported the number of answers marked _correct_, not
  the number of questions answered. The old fixture made the two the same number
  by coincidence, so the test passed and the figure was wrong.
- An exam that answered every question was recorded as `abandoned`, because the
  session was read before the final answer was counted.

- Exam mode now looks like the Practice mode it is modelled on. The start screen uses the dashboard hero, segmented direction control and action row; the running exam rebuilds the header in the same Exit → progress → meta order, and the question card uses the same prompt and answer sections, card states, action row and in-card verdict band. The screens referenced `.practice-dashboard*` and `.practice-card__head`, which do not exist, so most of their styling never applied.
- The exam's question card and loading row are now centred like the practice card, rather than sitting in the left margin on a wide screen.
- "N questions left" in the exam header is pluralised. `exam.remaining` and `examStats.examsWithScore` used the `_one`/`_other` key suffixes, which vue-i18n 9 and later ignore, so the raw key was shown on screen.
- The exam's question counter is now the progress bar's description, and the bar's `aria-valuetext` is that same counter, so assistive technology reads the number sighted users read.
- The running exam had no `h1` for its `aria-labelledby`, because the hero only rendered before the exam started. It now keeps a visually hidden heading for the duration.
- The loading state between exam questions rendered nothing, because `LoadingState` was used in the template without being imported, leaving an unexplained gap on the card's line.
- The exit button in the practice and exam bars wrapped its label under its icon on a tablet-width screen. The bar's side columns now hold the button's own width, and the bar, rather than the button, is what reflows.

- "Try again" could not be submitted: the retry was blocked because the question was already marked as answered. A retry is now sent with `retry: true`, which the API checks with the normal matching policy but does not record, so it earns no points, keeps the question slot, and does not change accuracy. It also works after a miss on the last question.
- The legacy button row under the practice card rendered a second "Next question" and a second "End session" after every answer, and took focus away from the card's primary action. It is removed; focus now lands on the single primary action, so Enter after a miss triggers "Try again" rather than skipping.
- The practice header advanced to the next question number as soon as an answer was checked, while the card still showed the current question.
- The session summary had no `h1`, because the hero only rendered before a session. It now keeps a visually hidden top-level heading.
- The practice screens now look like the redesign canvas rather than the old framed panel: a full-width header with the brand, underline tabs and an account chip; a two-column dashboard with a segmented direction control and icon cards; a centred practice card with an in-card feedback band; and a summary card. The fonts from the design (Newsreader, Instrument Sans) are bundled and served from the app's origin, so the CSP stays `font-src 'self'`.
- The question number and card state no longer switch to the next question before it has loaded; until then the previous card stays as it was, with its actions disabled.
- The primary action no longer shows "Checking..." while the session ends or the next question loads.
- At 320px with text enlarged to 200%, the dashboard, header, bottom navigation and practice bar reflow instead of scrolling horizontally.
- The end-to-end suite still used the pre-redesign copy ("Practice direction", "Submit answer", "Ready when you are.") and navigated through tabs that focused mode hides, so 32 browser tests failed before reaching their assertions. They now follow the redesigned flow.
- Phonetics are stored for the English side of a phrase, so rendering them under a German prompt showed English IPA as though it were German. They are now shown only when the prompt is the English one.
- Signing out stays reachable during a live session, so focused mode never removes the only sign-out route.
- Caddy now wraps the API proxy and the SPA fallback in separate `handle` blocks. Previously the loose top-level `try_files`/`file_server` directives were ordered ahead of `handle @api`, so `/health` and `/ready` returned the SPA `index.html` instead of proxying to the API.
- Caddyfile comments use `#`; `//` is not a valid Caddyfile comment and prevented the config from loading.
- Caddy sets response headers with the `>` replace operator. Caddy appends by default, so a proxied API response carried two `Content-Security-Policy` values. Browsers enforce the intersection of multiple CSP headers, which silently applied the stricter API policy to the whole site.
- The immutable `Cache-Control` for hashed assets moved to the site level. A matcher-scoped `header @assets` inside the SPA `handle` block is ordered before the site-level header block, so assets shipped with `no-store`.
- Requests for `/.env`, `/database/*`, and `/backups/*` now return 404 instead of being rewritten to the SPA shell with a 200.
- `package-lock.json` now resolves against the public npm registry so GitHub-hosted runners can run `npm ci` without access to the private corporate registry.
- Production smoke test reports the failing status, content type, and body when a JSON endpoint returns HTML, instead of a bare JSON parse error.

### Added

- Redesigned practice screen following `.roadmap/redesign.md`: a focused mode where one exercise owns the screen, the site tabs step aside during a session, the hero is removed to free vertical space, and a single primary action drives the loop through Enter/Return or the sticky bottom button.
- Stateful answer feedback. The card carries a `data-state` and moves between answering, correct, miss, and retry, presenting the outcome in place rather than appending another message.
- "Try again" clears the input and hides the expected answer, so a second attempt tests recall instead of letting the learner copy the answer.
- A pronunciation control backed by the browser's `speechSynthesis`, with an active state while audio plays and a 48px target.
- A streak counter for the current session. A correct second try does not extend it.
- After a miss, "Skip question" (or "Skip to results" on the last question) moves on without a retry. On the last correct answer the primary action reads "See results".
- Interaction states for every control: pointer-only hover, press feedback for all pointers, and distinct disabled styling for inputs and selects.
- Motion tokens (`--motion-fast`, `--motion-base`, `--ease-out`), elevation tokens, and safe-area insets on the shell.
- Purposeful progress empty states that distinguish a new learner from one with no repeated mistakes, present tricky words as chips, and offer a next action.
- An explanation on the login screen when a session ended, so the return is not silent.
- Automated deployment input checklist covering GitHub/GHCR, VM, DNS/TLS, runtime configuration, secret destinations, backups, monitoring, rollback, and final acceptance.
- Production build and runtime controls (Prompt 034): typed configuration validation, explicit SQLite migration execution, `/health` and database-backed `/ready` endpoints, structured configurable logging, `SIGTERM`/`SIGINT` graceful shutdown, and a verifier-backed `npm run build:production` command that excludes test artifacts.
- Container deployment configuration (Prompt 035): digest-pinned multi-stage API/Caddy images, private API Compose networking, named SQLite/Caddy volumes, HTTPS/SPA/security routing, verified SQLite backup/restore, process-restart persistence coverage, and a VM operations runbook.
- `GET /api/v1/auth/session` answers `200 { user }` or `200 { user: null }`; the web app uses it for the startup session check, so signed-out visits no longer log a 401 in the browser console.
- Development CORS: when `NODE_ENV=development`, the API registers `@fastify/cors` with `origin: true` and credentials enabled, and allows cross-origin state-changing requests for local tooling. Production ignores this override and continues to enforce `WEB_ORIGIN`/same-host checks; focused API tests cover both paths.
- Responsive review (`e2e/responsive.spec.ts`, `docs/engineering/responsive-review.md`): API-backed mobile and tablet journeys check reflow, 44px touch targets, keyboard-sized and rotated viewports, focused-input visibility, long prompts/errors/file names, navigation, and tablet dashboard layout (Prompt 033).
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

- Responsive review (Prompt 033, `docs/engineering/responsive-review.md`): unbroken status messages and selected import file names wrap within the layout; the shell follows the dynamic viewport with a `100vh` fallback; focus scrolling leaves room around controls after keyboard-size and orientation changes.
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
