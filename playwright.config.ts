/// <reference types="node" />

import { defineConfig, devices } from '@playwright/test';
import { apiPort, databasePath, previewPort, webPort } from './e2e/support/environment';

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  reporter: isCi
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['github']]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'pwa',
      dependencies: ['setup'],
      testMatch: /pwa\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${previewPort}` },
    },
    {
      name: 'mobile',
      dependencies: ['setup'],
      testIgnore: /pwa\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'tablet',
      dependencies: ['setup'],
      testIgnore: /pwa\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 820, height: 1180 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: 'npx tsx e2e/support/start-api.mts',
      url: `http://localhost:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'development',
        API_PORT: String(apiPort),
        DATABASE_PATH: databasePath,
        // Every test registers its own learner from localhost, so the per-IP limit is raised.
        AUTH_RATE_LIMIT_MAX: '100000',
        // WEB_ORIGIN is deliberately unset, as in `npm run dev`; development CORS is permissive,
        // while the API security tests separately exercise the strict origin fallback.
      },
    },
    {
      command: `npm run dev --workspace @taptalk/web -- --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_PROXY_TARGET: `http://localhost:${apiPort}` },
    },
    {
      // Only a production build has the service worker; `vite preview` reuses the /api proxy.
      command: `npm run build --workspace @taptalk/web && npm run preview --workspace @taptalk/web -- --port ${previewPort} --strictPort`,
      url: `http://localhost:${previewPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_PROXY_TARGET: `http://localhost:${apiPort}` },
    },
  ],
});
