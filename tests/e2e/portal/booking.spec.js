/**
 * E2E – Boka & Beställ (/portal/booking)
 *
 * Kategorier, produkter, varukorg.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Boka & Beställ', () => {
  test('kategorilistan laddar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/booking`);
    await assertNo500(page);
  });

  test('kategorier visas', async ({ page }) => {
    await page.goto(`${baseURL}/portal/booking`);

    const categories = page.locator('a.card.menu-item, .booking-category');
    const count = await categories.count();
    expect(count, 'Inga bokningskategorier hittades').toBeGreaterThan(0);
  });

  test('klick på kategori visar produkter', async ({ page }) => {
    await page.goto(`${baseURL}/portal/booking`);

    const catLink = page.locator('a[href*="/portal/booking/category/"]').first();
    if (await catLink.isVisible().catch(() => false)) {
      await catLink.click();
      await page.waitForLoadState('domcontentloaded');
      await assertNo500(page);
    }
  });

  test('specifik kategori laddar', async ({ page }) => {
    // Testa en känd kategori
    await page.goto(`${baseURL}/portal/booking/category/1`);
    await assertNo500(page);

    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(100);
  });

  test('flera kategorier fungerar', async ({ page }) => {
    // Hämta faktiska kategorilänkar från sidan
    await page.goto(`${baseURL}/portal/booking`);
    const catLinks = page.locator('a[href*="/portal/booking/category/"]');
    const count = await catLinks.count();
    const maxToTest = Math.min(count, 5);

    // Samla alla href:ar FÖRST (innan vi navigerar bort från sidan)
    const hrefs = [];
    for (let i = 0; i < maxToTest; i++) {
      const href = await catLinks.nth(i).getAttribute('href');
      hrefs.push(href.startsWith('http') ? href : `${baseURL}${href}`);
    }

    // Navigera till varje kategori
    for (const url of hrefs) {
      await page.goto(url);
      await assertNo500(page);
    }
  });

  test('varukorgs-funktionalitet', async ({ page }) => {
    await page.goto(`${baseURL}/portal/booking/cart`);
    await assertNo500(page);
  });
});
