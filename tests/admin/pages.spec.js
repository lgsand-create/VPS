import { test, expect } from '@playwright/test';
import { assertPageLoads } from '../helpers/assertions.js';
import { getActiveSite } from '../../sites/index.js';

const site = getActiveSite();

let consoleErrors = [];

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
});

test.afterEach(async ({}, testInfo) => {
  if (consoleErrors.length > 0) {
    testInfo.annotations.push({
      type: 'js-console-errors',
      description: consoleErrors.join('\n'),
    });
    console.warn(`⚠️  JS-fel: ${testInfo.title}\n  ${consoleErrors.join('\n  ')}`);
  }
});

const DOWNLOAD_ROUTES = ['/export', '/download', '/csv', '/pdf'];

function isDownloadRoute(route) {
  return DOWNLOAD_ROUTES.some((d) => route.endsWith(d));
}

for (const [category, routes] of Object.entries(site.routes)) {
  test.describe(`[${site.name}] ${category}`, () => {
    for (const route of routes) {
      test(`${route}`, async ({ page }) => {
        if (isDownloadRoute(route)) {
          test.skip();
          return;
        }

        const { status } = await assertPageLoads(page, `${site.baseURL}${route}`);

        if (status === 200) {
          const bodyText = await page.textContent('body');
          expect(bodyText.length).toBeGreaterThan(0);
        }
      });
    }
  });
}
