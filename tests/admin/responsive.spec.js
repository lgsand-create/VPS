import { test, expect } from '@playwright/test';
import { assertPageLoads, assertNoHorizontalOverflow } from '../helpers/assertions.js';
import { getActiveSite } from '../../sites/index.js';

const site = getActiveSite();

test.describe(`[${site.name}] Responsiv mobilvy`, () => {
  for (const { path, name } of site.responsivePages || []) {
    test(`${name} (${path}) – ingen horisontell scrollning`, async ({ page }) => {
      const { skipped } = await assertPageLoads(page, `${site.baseURL}${path}`);
      if (skipped) { test.skip(); return; }

      const { hasOverflow, overflowing } = await assertNoHorizontalOverflow(page);

      await page.screenshot({
        path: `./test-results/responsive-${site.id}-${name.toLowerCase()}.png`,
        fullPage: false,
      });

      if (overflowing.length > 0) {
        console.warn(`⚠️  Utflödande element på ${path}:`, overflowing);
      }

      expect(hasOverflow, `${path} har horisontell scrollning`).toBe(false);
    });

    test(`${name} (${path}) – synligt innehåll`, async ({ page }) => {
      const { skipped } = await assertPageLoads(page, `${site.baseURL}${path}`);
      if (skipped) { test.skip(); return; }

      const bodyText = await page.textContent('body');
      expect(bodyText.trim().length).toBeGreaterThan(50);
    });
  }
});
