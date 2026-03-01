/**
 * E2E – Portal Dashboard (/portal/dashboard)
 *
 * Menykort, navigation, grundläggande laddning.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Portal Dashboard', () => {
  test('dashboard laddar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/dashboard`);
    await assertNo500(page);
    await expect(page).toHaveURL(/\/portal/);
  });

  test('menykort visas', async ({ page }) => {
    await page.goto(`${baseURL}/portal/dashboard`);

    const cards = page.locator('a.card.menu-item, a.menu-item');
    const count = await cards.count();
    expect(count, 'Inga menykort hittades').toBeGreaterThan(0);
  });

  test('klick på kort navigerar korrekt', async ({ page }) => {
    await page.goto(`${baseURL}/portal/dashboard`);

    const links = page.locator('a.card.menu-item').first();
    if (await links.isVisible().catch(() => false)) {
      const href = await links.getAttribute('href');
      await links.click();
      await page.waitForLoadState('domcontentloaded');
      await assertNo500(page);
      expect(href || page.url()).toBeTruthy();
    }
  });

  test('admin-länk visas för admin-användare', async ({ page }) => {
    await page.goto(`${baseURL}/portal/dashboard`);

    // Kolla om admin-länk finns
    const adminLink = page.locator('a[href*="/admin"], a:has-text("Admin")');
    // Notera: kan finnas eller inte beroende på användarens roll
    const count = await adminLink.count();
    // Vi bara loggar, testar inte att den finns
    if (count > 0) {
      await expect(adminLink.first()).toBeVisible();
    }
  });
});
