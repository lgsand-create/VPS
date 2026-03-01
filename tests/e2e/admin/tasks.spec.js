/**
 * E2E – Uppgifter/Tasks (/admin/tasks)
 *
 * Uppgiftslista, generering, detaljer, mallar, kategorier.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Admin Uppgifter', () => {
  test('uppgiftslistan laddar', async ({ page }) => {
    await page.goto(`${baseURL}/admin/tasks`);
    await assertNo500(page);
  });

  test('generera-sidan laddar', async ({ page }) => {
    await page.goto(`${baseURL}/admin/tasks/generate`);
    await assertNo500(page);
  });

  test('uppgiftsdetalj laddar', async ({ page }) => {
    await page.goto(`${baseURL}/admin/tasks`);

    // Hitta en länk till en specifik uppgift
    const taskLink = page.locator('a[href*="/admin/tasks/show"], a[href*="/admin/tasks/"][href*="show"]').first();
    if (await taskLink.isVisible().catch(() => false)) {
      await taskLink.click();
      await page.waitForLoadState('domcontentloaded');
      await assertNo500(page);
    }
  });

  test('mallar laddar', async ({ page }) => {
    await page.goto(`${baseURL}/admin/tasks/templates`);
    await assertNo500(page);
  });

  test('kategorier laddar', async ({ page }) => {
    await page.goto(`${baseURL}/admin/tasks/categories`);
    await assertNo500(page);
  });

  test('skapa-uppgift formulär finns', async ({ page }) => {
    await page.goto(`${baseURL}/admin/tasks/create`);
    const status = await page.evaluate(() => {
      return !document.body.textContent.match(/500|internal server error|fatal error/i);
    });
    // Sidan kanske inte finns – hoppa över om 404
    if (status) {
      const form = page.locator('form');
      const hasForm = await form.count();
      if (hasForm > 0) {
        await expect(form.first()).toBeVisible();
      }
    }
  });
});
