import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './integration-tests',
  timeout: 10 * 60 * 1000,
  globalTimeout: 30 * 60 * 1000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
