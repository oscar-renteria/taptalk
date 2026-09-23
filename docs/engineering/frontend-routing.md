# Frontend routing

TapTalk uses `vue-router` (history mode) in `apps/web/src/router.ts`. Views live in `apps/web/src/views/`; the shell in `App.vue` renders the offline banner, the session check, the signed-in header and navigation, an error boundary, and `<RouterView>`.

## Routes

| Path | View | Access |
| --- | --- | --- |
| `/` | redirects to `/practice` | – |
| `/login`, `/register` | `AuthView` | guests only (signed-in users go to the return path or `/practice`) |
| `/practice` | `PracticeView` | signed in |
| `/progress` | `ProgressView` | signed in |
| `/settings` | `SettingsView` | signed in |
| `/admin/import` | `AdminImportView` | administrators; others are redirected to `/practice` |
| anything else | `NotFoundView` | anyone |

## Behaviour

- **Session check:** the guard waits for `GET /api/v1/auth/me` once (`session.ts`) before the first route renders. Until then the shell shows "Checking your session...". Refreshing any page therefore keeps the user on it.
- **Unauthorized routes:** signed-out visitors are sent to `/login?redirect=<path>`, and after login they return to that path. `safeRedirect` accepts only same-origin paths (`/…` but not `//…`), so the parameter cannot be used as an open redirect.
- **Expired sessions:** views call the API through `apiFetch`. A `401` signs the user out and redirects to login with the current path as the return path.
- **Authorization:** route guards only decide what to *show*. The API authorizes every request on its own (ADR-005, administrator provisioning guide).
- **Safe error state:** `onErrorCaptured` in the shell replaces a failing view with an error message and a "Reload" action, instead of leaving a blank page. The error resets on the next navigation.
- **Titles:** each route sets `document.title` (for example "Settings · TapTalk").
- **Hosting:** history mode needs the server to answer unknown paths with `index.html`. The Vite dev server does this already; production hosting must configure the same fallback (Prompt 034).

## Tests

- `apps/web/src/router.test.ts` covers the redirects for each protected route, the return after login, guests-only routes, the admin redirect, not-found, session expiry, the loading state and `safeRedirect`.
- `e2e/access-control.spec.ts` checks deep links, reload on a deep route, the admin redirect and not-found in a real browser.
