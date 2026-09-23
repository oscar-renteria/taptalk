import { expect, test, type Page } from '@playwright/test';
import { logIn, registerLearner } from './support/app';

// Runs against the production build (`pwa` project), the only build with a service worker.

async function serviceWorkerReady(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The first load is not yet controlled; after a reload the service worker serves the page.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test.describe('progressive web app', () => {
  test('meets Chrome installability requirements with a complete manifest', async ({ page }) => {
    await serviceWorkerReady(page);
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifest = await (await page.request.get(href ?? '')).json();
    expect(manifest).toMatchObject({
      name: 'TapTalk language practice',
      short_name: 'TapTalk',
      display: 'standalone',
      start_url: '/practice',
      scope: '/',
      lang: 'en',
    });
    const sizes = manifest.icons.map((icon: { sizes: string; purpose: string }) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(
      true,
    );
    for (const icon of [...manifest.icons, { src: '/apple-touch-icon.png' }]) {
      const response = await page.request.get(icon.src);
      expect(response.status(), icon.src).toBe(200);
      expect(response.headers()['content-type']).toMatch(/^image\//);
    }

    const cdp = await page.context().newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    expect(installabilityErrors).toEqual([]);
  });

  test('caches only the app shell, never API responses', async ({ page, request }, testInfo) => {
    await serviceWorkerReady(page);
    await logIn(page, await registerLearner(request, testInfo, 'pwa-cache'));
    await page.getByRole('link', { name: 'Progress' }).click();
    await expect(page.getByTestId('stat-points')).toBeVisible();

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        urls.push(...(await cache.keys()).map((entry) => new URL(entry.url).pathname));
      }
      return urls;
    });
    expect(cached).toEqual(expect.arrayContaining(['/index.html', '/manifest.webmanifest']));
    expect(cached.some((path) => path.startsWith('/assets/') && path.endsWith('.js'))).toBe(true);
    expect(cached.filter((path) => path.startsWith('/api/'))).toEqual([]);

    const api = await page.request.get('/api/v1/dashboard');
    expect(api.headers()['cache-control']).toBe('no-store');
  });

  test('starts offline from the cache and says that practice needs a connection', async ({
    page,
    context,
  }) => {
    await serviceWorkerReady(page);
    await context.setOffline(true);
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Small steps. Stronger words.' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'You are offline.' })).toHaveText(
      'You are offline. Practice and account data need a connection.',
    );
    await context.setOffline(false);
  });

  test('runs the production bundle under the Content-Security-Policy without violations', async ({
    page,
    request,
  }, testInfo) => {
    await page.addInitScript(() => {
      (window as unknown as { cspViolations: string[] }).cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { cspViolations: string[] }).cspViolations.push(
          `${event.violatedDirective} ${event.blockedURI}`,
        );
      });
    });
    const response = await page.goto('/login');
    expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
    expect(response?.headers()['x-frame-options']).toBe('DENY');

    await logIn(page, await registerLearner(request, testInfo, 'pwa-csp'));
    await page.getByLabel('Practice direction').selectOption('english-to-german');
    await page.getByRole('button', { name: 'Start practice' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await page.getByRole('link', { name: 'Progress' }).click();
    await expect(page.getByTestId('stat-points')).toBeVisible();

    const violations = await page.evaluate(
      () => (window as unknown as { cspViolations: string[] }).cspViolations,
    );
    expect(violations).toEqual([]);
  });
});
