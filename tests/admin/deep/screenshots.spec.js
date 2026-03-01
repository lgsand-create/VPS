/**
 * Deep Click – Screenshots
 *
 * Tar screenshot av varje portal-sida för visuell granskning.
 * Sparar till test-output/screenshots/ med sidnamn.
 * Bifogas som attachments i HTML-rapporten.
 *
 * Körning:
 *   npm run test:deep:screenshots
 */

import { test } from '@playwright/test';
import { getActiveSite } from '../../../sites/index.js';
import {
  discoverLinks,
  shouldSkipHref,
  crawlPortal,
} from '../../helpers/deep.js';

const site = getActiveSite();

test.setTimeout(300_000);

test.describe('[Deep Screenshots] Visuell granskning', () => {
  test('Ta screenshot av alla portal-sidor', async ({ page, context }, testInfo) => {
    page.on('dialog', (d) => d.dismiss());

    const { visited } = await crawlPortal(page, context, site, {
      maxDepth: 2,
      maxPages: 100,
    });

    let screenshotCount = 0;

    for (const [url, data] of visited) {
      if (data.status !== 200) continue;

      let testPage;
      try {
        testPage = await context.newPage();
        testPage.on('dialog', (d) => d.dismiss());
        await testPage.goto(url, { waitUntil: 'networkidle', timeout: 15_000 });

        // Skapa filnamn från URL-path
        const path = new URL(url).pathname.replace(/\//g, '_').replace(/^_/, '') || 'root';
        const screenshot = await testPage.screenshot({ fullPage: true });

        // Bifoga till HTML-rapporten
        await testInfo.attach(`${path}`, {
          body: screenshot,
          contentType: 'image/png',
        });

        screenshotCount++;
      } catch {
        // Hoppa över sidor som inte laddar
      } finally {
        if (testPage) await testPage.close().catch(() => {});
      }
    }

    testInfo.annotations.push({
      type: 'screenshots',
      description: `${screenshotCount} screenshots tagna av ${visited.size} sidor`,
    });

    console.log(`\n═══ SCREENSHOTS ═══`);
    console.log(`  ${screenshotCount} screenshots tagna`);
    console.log(`  Öppna HTML-rapporten för att granska: npm run report`);
  });
});
