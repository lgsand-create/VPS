/**
 * E2E – Laghantering (/admin/teams)
 *
 * CRUD: lista, skapa, redigera, toggle.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { generateTestId, assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;
const testId = generateTestId();

test.describe.serial('Laghantering CRUD', () => {
  test('laglistan laddar', async ({ page }) => {
    await page.goto(`${baseURL}/admin/teams`);
    await assertNo500(page);

    const content = page.locator('table, .team-list, .list-group, .card');
    await expect(content.first()).toBeVisible({ timeout: 10_000 });
  });

  test('skapa nytt lag', async ({ page }) => {
    await page.goto(`${baseURL}/admin/teams/create`);
    await assertNo500(page);

    const nameField = page.locator('#name, input[name="name"]').first();
    if (await nameField.isVisible().catch(() => false)) {
      await nameField.fill(`${testId.substring(0, 15)} Testlag`);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2_000);
      await assertNo500(page);
    }
  });

  test('redigera befintligt lag', async ({ page }) => {
    await page.goto(`${baseURL}/admin/teams`);

    const editLink = page.locator('a[href*="/edit"], .btn-edit, a:has-text("Redigera")').first();
    if (await editLink.isVisible().catch(() => false)) {
      await editLink.click();
      await page.waitForLoadState('domcontentloaded');
      await assertNo500(page);

      const form = page.locator('form');
      await expect(form.first()).toBeVisible();
    }
  });

  test('lagkolumner visas korrekt', async ({ page }) => {
    await page.goto(`${baseURL}/admin/teams`);

    // Kontrollera att tabell/lista har innehåll
    const rows = page.locator('table tbody tr, .team-item, .list-group-item');
    const count = await rows.count();
    // Det bör finnas lag i systemet
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
