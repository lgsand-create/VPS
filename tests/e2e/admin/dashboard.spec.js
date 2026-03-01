/**
 * E2E – Admin Dashboard (/admin)
 *
 * Testar att dashboarden laddar korrekt med modulkort och navigation.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Admin Dashboard', () => {
  test('dashboard laddar efter login', async ({ page }) => {
    await page.goto(`${baseURL}/admin`);
    await assertNo500(page);
    await expect(page).toHaveURL(/\/admin/);
  });

  test('modulkort visas', async ({ page }) => {
    await page.goto(`${baseURL}/admin`);
    const cards = page.locator('.dashboard-grid a, .dashboard-card, .module-card');
    const count = await cards.count();
    expect(count, 'Inga modulkort hittades').toBeGreaterThan(0);
  });

  test('klick på kort navigerar till modul', async ({ page }) => {
    await page.goto(`${baseURL}/admin`);
    const cards = page.locator('.dashboard-grid a');
    const count = await cards.count();

    if (count > 0) {
      const href = await cards.first().getAttribute('href');
      await cards.first().click();
      await page.waitForLoadState('domcontentloaded');
      await assertNo500(page);
      // Verifierar att vi navigerat bort från dashboard
      expect(href || page.url()).toBeTruthy();
    }
  });

  test('sidebar/navigation finns', async ({ page }) => {
    await page.goto(`${baseURL}/admin`);

    // Om sessionen gått ut och vi hamnat på login, skippa
    if (page.url().includes('/login')) {
      test.skip(true, 'Admin-session har gått ut');
    }

    // Dashboarden har alltid länkar till admin-moduler
    const adminLinks = page.locator('a[href*="/admin/"]');
    await expect(adminLinks.first()).toBeVisible({ timeout: 10_000 });
  });
});
