import { defineConfig, devices } from '@playwright/test';
import { apiPort, databasePath, webPort } from './e2e/support/environment';

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
      name: 'mobile',
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'tablet',
      dependencies: ['setup'],
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
      command: 'npm run build --workspace @taptalk/shared && npx tsx e2e/support/start-api.mts',
      url: `http://localhost:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'development',
        API_PORT: String(apiPort),
        DATABASE_PATH: databasePath,
        // Every test registers its own learner from localhost, so the per-IP limit is raised.
        AUTH_RATE_LIMIT_MAX: '100000',
      },
    },
    {
      command: `npm run dev --workspace @taptalk/web -- --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_PROXY_TARGET: `http://localhost:${apiPort}` },
    },
  ],
});
