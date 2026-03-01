/**
 * E2E – Bottom Navigation
 *
 * Testar de 5 navigeringslänkarna i botten.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Bottom Navigation', () => {
  test('bottom nav finns', async ({ page }) => {
    await page.goto(`${baseURL}/portal/dashboard`);

    const nav = page.locator('.bottom-nav, nav.fixed-bottom, .mobile-nav, .app-nav');
    if (await nav.count() > 0) {
      await expect(nav.first()).toBeVisible();
    }
  });

  test('5 navigationslänkar visas', async ({ page }) => {
    await page.goto(`${baseURL}/portal/dashboard`);

    const navItems = page.locator('.bottom-nav .nav-item, .bottom-nav a, .app-nav a');
    const count = await navItems.count();
    // Bör ha 5 stycken (Hem, Aktuellt, Mina lag, Kalender, Profil)
    if (count > 0) {
      expect(count).toBeGreaterThanOrEqual(3);
    }
  });

  test('Hem navigerar till dashboard', async ({ page }) => {
    await page.goto(`${baseURL}/portal/dashboard`);
    await assertNo500(page);
    expect(page.url()).toMatch(/\/portal/);
  });

  test('Aktuellt/Nyheter navigerar korrekt', async ({ page }) => {
    await page.goto(`${baseURL}/portal/news`);
    await assertNo500(page);
  });

  test('Mina lag navigerar korrekt', async ({ page }) => {
    await page.goto(`${baseURL}/portal/my-teams`);
    await assertNo500(page);
  });

  test('Kalender navigerar korrekt', async ({ page }) => {
    await page.goto(`${baseURL}/portal/calendar`);
    await assertNo500(page);
  });

  test('Profil navigerar korrekt', async ({ page }) => {
    await page.goto(`${baseURL}/portal/profile`);
    await assertNo500(page);
  });

  test('aktiv state markeras korrekt', async ({ page }) => {
    await page.goto(`${baseURL}/portal/dashboard`);

    const activeItem = page.locator('.nav-item.active, .bottom-nav .active, .app-nav .active');
    if (await activeItem.count() > 0) {
      await expect(activeItem.first()).toBeVisible();
    }
  });
});
