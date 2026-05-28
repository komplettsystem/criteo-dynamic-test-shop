import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://komplettsystem.github.io/criteo-dynamic-test-shop';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'automapper/reports/playwright-results.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    headless: true,
    // Don't block network — pages need GTM and catalog.csv
  },
  // Single worker so the shared gap report accumulates correctly across all tests
  workers: 1,
});
