import { defineConfig } from '@playwright/test';
import { getActiveSite } from './sites/index.js';
import dotenv from 'dotenv';

dotenv.config();

const site = getActiveSite();
const authFile = `./tests/.auth/${site.id}.json`;
const adminAuthFile = `./tests/.auth/${site.id}-admin.json`;

export default defineConfig({
  testDir: './tests',
  outputDir: './test-output',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 3,
  retries: 1,
  reporter: [
    ['html', { open: 'never', outputFolder: './test-results' }],
    ['list'],
  ],
  use: {
    baseURL: site.baseURL,
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    trace: 'on-first-retry',
    ignoreHTTPSErrors: true,
  },
  projects: [
    // --- Befintliga projekt ---
    {
      name: 'setup',
      testMatch: /global-setup\.js/,
    },
    {
      name: 'desktop',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
        storageState: authFile,
      },
      dependencies: ['setup'],
      testIgnore: [/global-setup\.js/, /responsive\.spec\.js/, /deep\//, /e2e\//],
    },
    {
      name: 'deep',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
        storageState: authFile,
      },
      dependencies: ['setup'],
      testMatch: /deep\//,
      timeout: 120_000,
    },
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 812 },
        storageState: authFile,
        isMobile: true,
      },
      dependencies: ['setup'],
      testMatch: /responsive\.spec\.js/,
    },

    // --- E2E Setup (sekventiellt – dev-servern klarar inte parallella logins) ---
    {
      name: 'e2e-setup-admin',
      testMatch: /e2e\/setup-admin\.js/,
    },
    {
      name: 'e2e-setup-portal',
      testMatch: /e2e\/setup-portal\.js/,
      dependencies: ['e2e-setup-admin'],
    },

    // --- E2E Test-sviter ---
    {
      name: 'e2e-admin',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
        storageState: adminAuthFile,
      },
      dependencies: ['e2e-setup-admin'],
      testMatch: /e2e\/admin\//,
      timeout: 60_000,
    },
    {
      name: 'e2e-portal',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
        storageState: authFile,
      },
      dependencies: ['e2e-setup-portal'],
      testMatch: /e2e\/portal\//,
      timeout: 60_000,
    },
    {
      name: 'e2e-public',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /e2e\/public\//,
      timeout: 30_000,
    },
    {
      name: 'e2e-security',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
      },
      dependencies: ['e2e-setup-admin', 'e2e-setup-portal'],
      testMatch: /e2e\/security\//,
      timeout: 30_000,
    },
  ],
});
