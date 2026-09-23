# Progressive web app

- **Status:** Implemented with `vite-plugin-pwa` (Workbox `generateSW`) in `apps/web/vite.config.ts`. This covers the caching and update parts of OPEN DECISION 010. The supported browser matrix is still open.
- **Requirements:** PR-028, PR-029

## Installability

- **Manifest:** `id`, `name`, `short_name`, `description`, `lang`, `start_url: /practice`, `scope: /`, `display: standalone`, theme and background colours.
- **Icons:** `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (glyph inside the 80 % safe zone), `icon.svg`, and `apple-touch-icon.png` (iOS ignores SVG touch icons).
- **Regenerating icons:** icons are rendered from `public/icon.svg` with `npm run icons --workspace @taptalk/web`, which uses Playwright's Chromium, so no image tool is needed.
- **Verification:** `e2e/pwa.spec.ts` asks Chrome itself through DevTools (`Page.getInstallabilityErrors`) and expects no errors.

## Cache policy

| Content                                                 | Strategy                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| App shell: `index.html`, hashed JS/CSS, icons, manifest | Precached at install; outdated precaches are removed                      |
| Navigations (for example `/settings`)                   | Served from the cached `index.html`, so deep links and offline start work |
| `/api/*`                                                | `NetworkOnly`, never cached, and excluded from the navigation fallback    |

- **Server side:** every `/api` response, including errors, sends `Cache-Control: no-store`, so browsers, the service worker and any proxy never store personal data.
- **Browser side:** session state lives only in the `HttpOnly` cookie (ADR-005), never in `localStorage`, IndexedDB or Cache Storage.
- **Verification:** the e2e test uses the API and then inspects Cache Storage to assert that no `/api/` entry exists.

## Updates

`registerType: 'prompt'`: when a new version is installed, it waits, and the **UpdateBanner** says "A new version of TapTalk is ready." with **Reload to update** and **Later**. A running practice session is therefore never reloaded unexpectedly. Reloading activates the new service worker. Stale versions are also replaced on the next visit, once all tabs have closed.

## Offline

The app shell starts offline, and a banner says: "You are offline. Practice and account data need a connection." Practice, progress and settings are **not** available offline. There is no offline storage or synchronization, and the app does not claim otherwise (PR-029).

## Testing

- Unit tests: `apps/web/src/pwa.test.ts` (update prompt, postpone, offline-ready).
- Browser tests: the Playwright `pwa` project runs `e2e/pwa.spec.ts` against a production build (`vite build` + `vite preview` on port 5176). The dev server has no service worker, which is why this separate project exists.
