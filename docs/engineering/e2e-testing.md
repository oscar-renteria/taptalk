# End-to-end browser tests

TapTalk uses [Playwright](https://playwright.dev) to test the principal user journeys in a real browser. Playwright was chosen because it emulates mobile and tablet viewports, waits for elements to be ready without fixed delays, and records traces, screenshots and videos when a test fails.

## Running the suite

```sh
npm install
npm run test:e2e:install   # once per machine: downloads Chromium
npm run test:e2e
npx playwright show-report # opens the HTML report
```

`npm run test:e2e` starts its own servers, so a running `npm run dev` is not reused and not disturbed:

| Process    | Port | Notes                                                                     |
| ---------- | ---- | ------------------------------------------------------------------------- |
| API        | 3100 | Started by `e2e/support/start-api.mts` against `e2e/.data/taptalk-e2e.db` |
| Web (Vite) | 5174 | Proxies `/api` to port 3100 through `API_PROXY_TARGET`                    |

The e2e database file is deleted and recreated on every run. The start script refuses any `DATABASE_PATH` that does not contain `taptalk-e2e`, so the suite cannot touch a development or production database.

## Test data

- The `setup` project (`e2e/global.setup.ts`) registers the administrator `e2e-admin`, promotes it with the documented `set-role` command ([administrator provisioning](../operations/administrator-provisioning.md)) and imports `seedVocabulary` from `e2e/fixtures/vocabulary.ts`.
- Every other test creates its own learner with a unique username. Tests therefore run in parallel and do not depend on each other.
- All credentials in `e2e/support/environment.ts` are test-only values for the throwaway database.

## Projects and viewports

| Project  | Device                             |
| -------- | ---------------------------------- |
| `setup`  | Provisioning only, runs first      |
| `mobile` | Pixel 7 (Chromium, 412×915, touch) |
| `tablet` | Chromium, 820×1180, touch          |

Only Chromium is installed to keep CI fast. WebKit (iOS Safari) coverage is a known gap.

## Selectors and timing

Locators use accessible roles and labels (`getByRole`, `getByLabel`), so the tests also catch accessibility regressions. `data-testid` is used only where no accessible name exists: `practice-prompt`, `session-progress`, and the `stat-*` and `summary-*` tiles. There are no `waitForTimeout` calls; assertions rely on Playwright's automatic waiting.

## Journey coverage

| #   | Journey                         | Spec                     | Status                       |
| --- | ------------------------------- | ------------------------ | ---------------------------- |
| 1   | Registration                    | `auth.spec.ts`           | Covered                      |
| 2   | Login                           | `auth.spec.ts`           | Covered (including reload)   |
| 3   | Choosing settings               | `practice.spec.ts`       | Covered                      |
| 4   | Completing a practice question  | `practice.spec.ts`       | Covered                      |
| 5   | Receiving feedback              | `practice.spec.ts`       | Covered (right and wrong)    |
| 6   | Completing a session            | `practice.spec.ts`       | Covered (full and early end) |
| 7   | Viewing the dashboard           | `practice.spec.ts`       | Covered                      |
| 8   | Administrator vocabulary import | `admin-import.spec.ts`   | Covered                      |
| 9   | Unauthorized access behavior    | `access-control.spec.ts` | Covered (UI and API)         |

## Failure artifacts

On failure Playwright keeps a screenshot, a video and a trace (`npx playwright show-trace <trace.zip>`) under `test-results/`, and writes the HTML report to `playwright-report/`. CI uploads both as the `playwright-report` artifact. CI retries a failing test once and reports it as flaky if the retry passes.

## Defects found by the suite

Fixed on 2026-09-23. Each fix has a regression test.

| Defect                                                                               | Fix                                                                          | Regression test                                              |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| No session boundary or completion summary                                            | Practice session lifecycle API plus summary UI                               | `practice.spec.ts`, `practice-session.test.ts` (API and web) |
| Settings dropdown editable while loading; the response overwrote the user's change   | Form fieldset disabled while loading                                         | `settings.test.ts`, `practice.spec.ts`                       |
| Saving settings reset `sessionLength` and `repetitionPreference` to hardcoded values | Loaded values are kept, and session length is editable                       | `settings.test.ts`                                           |
| Import success message cleared by the history reload; confirm button stayed active   | History reload no longer clears the message; the preview resets after commit | `admin-import.spec.ts`, `practice-session.test.ts` (web)     |
| Session lost on page reload                                                          | `/api/v1/auth/me` is checked on startup                                      | `auth.spec.ts`, `practice-session.test.ts` (web)             |
| Previous user's state visible after logout                                           | State reset on logout                                                        | `practice-session.test.ts` (web)                             |
| Summary tiles overflowed horizontally on phones                                      | Summary reuses the dashboard's bounded grid                                  | `practice.spec.ts` checks `scrollWidth`                      |

## Known limitations

- Question selection still always returns the first vocabulary entry (Prompt 019). A session therefore repeats one word.
- Only Chromium runs, so there is no WebKit (iOS Safari) coverage.
- The suite runs against the Vite dev server, not the production build with its service worker (Prompt 028).
