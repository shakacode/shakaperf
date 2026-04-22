import { defineConfig, devices } from '@playwright/test';

// Standalone Playwright config for accessibility exploration tests.
// Separate from the repo's `playwright.integration.config.ts` on purpose:
// the a11y suite is pure Playwright + @axe-core/playwright, no twin-servers
// fixtures, no global setup/teardown. You run the demo-ecommerce server
// yourself at http://localhost:3030 before invoking these tests.
export default defineConfig({
  testDir: './a11y-tests',
  testMatch: /07.*\.spec\.ts/,
  timeout: 60 * 1000,
  fullyParallel: true,
  retries: 0,
  reporter: [
    ['list'],
    // HTML reporter is what makes `testInfo.attach(...)` visible in
    // `07-multipage-and-report.spec.ts` — attachments show up as clickable
    // entries on the test's page.
    ['html', { outputFolder: 'a11y-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:3030',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
