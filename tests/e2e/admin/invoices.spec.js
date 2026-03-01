/**
 * E2E – Fakturering (/admin/invoices)
 *
 * Fakturalista, skapa, visa, inställningar.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Admin Fakturering', () => {
  test('fakturalistan laddar', async ({ page }) => {
    await page.goto(`${baseURL}/admin/invoices`);
    await assertNo500(page);
  });

  test('skapa faktura-sida laddar', async ({ page }) => {
    await page.goto(`${baseURL}/admin/invoices/create`);
    await assertNo500(page);

    const form = page.locator('form');
    if (await form.count() > 0) {
      await expect(form.first()).toBeVisible();
    }
  });

  test('fakturainställningar laddar', async ({ page }) => {
    await page.goto(`${baseURL}/admin/invoices/settings`);
    await assertNo500(page);
  });

  test('visa faktura', async ({ page }) => {
    await page.goto(`${baseURL}/admin/invoices`);

    // Hitta en faktura-länk
    const invoiceLink = page.locator('a[href*="/admin/invoices/"]').first();
    if (await invoiceLink.isVisible().catch(() => false)) {
      const href = await invoiceLink.getAttribute('href');
      // Undvik create/settings-länkar
      if (href && !href.includes('create') && !href.includes('settings')) {
        await invoiceLink.click();
        await page.waitForLoadState('domcontentloaded');
        await assertNo500(page);
      }
    }
  });

  test('avgifter-sidan laddar', async ({ page }) => {
    await page.goto(`${baseURL}/admin/invoices/fees`);
    await assertNo500(page);
  });
});
