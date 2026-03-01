/**
 * E2E – Fakturor (/portal/invoices)
 *
 * Fakturalista, visa faktura, PDF.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Portal Fakturor', () => {
  test('fakturasidan laddar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/invoices`);
    await assertNo500(page);
  });

  test('fakturalista visas', async ({ page }) => {
    await page.goto(`${baseURL}/portal/invoices`);

    const body = await page.textContent('body');
    // Sidan ska visa fakturor eller ett "inga fakturor"-meddelande
    expect(body.length).toBeGreaterThan(50);
  });

  test('fakturadetalj kan öppnas', async ({ page }) => {
    await page.goto(`${baseURL}/portal/invoices`);

    const invoiceLink = page.locator('a[href*="/portal/invoices/"]').first();
    if (await invoiceLink.isVisible().catch(() => false)) {
      await invoiceLink.click();
      await page.waitForLoadState('domcontentloaded');
      await assertNo500(page);
    }
  });
});
