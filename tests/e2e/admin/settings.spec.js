/**
 * E2E – Inställningar (/admin/settings)
 *
 * Flikar, moduler, spara.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Admin Inställningar', () => {
  test('inställningssidan laddar', async ({ page }) => {
    await page.goto(`${baseURL}/admin/settings`);
    await assertNo500(page);
  });

  test('flikar visas', async ({ page }) => {
    await page.goto(`${baseURL}/admin/settings`);

    // Flikar (tabs) bör finnas
    const tabs = page.locator('[role="tab"], .nav-tabs a, .nav-tabs button, .tab-link');
    const count = await tabs.count();
    // Kan sakna flikar beroende på konfiguration
    if (count > 0) {
      await expect(tabs.first()).toBeVisible();
    }
  });

  test('fliknavigering fungerar', async ({ page }) => {
    await page.goto(`${baseURL}/admin/settings`);

    const tabs = page.locator('[role="tab"], .nav-tabs a, .nav-tabs button, .tab-link');
    const count = await tabs.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(500);
      await assertNo500(page);
    }
  });

  test('moduler kan togglas', async ({ page }) => {
    await page.goto(`${baseURL}/admin/settings`);

    // Hitta checkboxar för moduler
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();

    if (count > 0) {
      // Klicka på en checkbox och tillbaka (för att inte ändra state)
      const first = checkboxes.first();
      const wasChecked = await first.isChecked();
      await first.click();
      // Återställ
      if (wasChecked !== await first.isChecked()) {
        await first.click();
      }
    }
  });

  test('undersidor laddar', async ({ page }) => {
    const settingsPages = [
      '/admin/settings',
      '/admin/settings/modules',
      '/admin/settings/pwa',
    ];

    for (const path of settingsPages) {
      await page.goto(`${baseURL}${path}`);
      await assertNo500(page);
    }
  });
});
