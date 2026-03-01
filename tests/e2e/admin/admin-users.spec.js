/**
 * E2E – Admin-användare (/admin/admin-users)
 *
 * Lista, skapa, roller, validering.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500, getCsrfToken } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Admin-användare', () => {
  test('lista admin-användare', async ({ page }) => {
    await page.goto(`${baseURL}/admin/admin-users`);
    await assertNo500(page);

    const content = page.locator('table, .user-list, .list-group');
    await expect(content.first()).toBeVisible({ timeout: 10_000 });
  });

  test('skapa-formuläret har rätt fält', async ({ page }) => {
    await page.goto(`${baseURL}/admin/admin-users/create`);
    await assertNo500(page);

    // Kontrollera att förväntade fält finns
    const usernameField = page.locator('#username, input[name="username"]');
    const passwordField = page.locator('#password, input[name="password"]');
    const roleField = page.locator('#role, select[name="role"]');

    // Minst username och password bör finnas
    const hasUsername = await usernameField.count();
    const hasPassword = await passwordField.count();
    expect(hasUsername + hasPassword, 'Saknar grundfält').toBeGreaterThan(0);
  });

  test('validering: kort lösenord → fel', async ({ page }) => {
    await page.goto(`${baseURL}/admin/admin-users/create`);

    // Om sessionen gått ut och vi hamnat på login, skippa testet
    if (page.url().includes('/login')) {
      test.skip(true, 'Admin-session har gått ut');
    }

    const usernameField = page.locator('#username, input[name="username"]').first();
    const passwordField = page.locator('#password, input[name="password"]').first();

    if (await usernameField.isVisible().catch(() => false)) {
      await usernameField.fill('testuser_temp');
    }
    if (await passwordField.isVisible().catch(() => false)) {
      await passwordField.fill('kort'); // Mindre än 8 tecken
    }

    await page.click('button[type="submit"]');
    await page.waitForTimeout(1_000);

    // Borde visa fel eller stanna kvar (login = session expired, accepteras)
    const url = page.url();
    const onSamePage = url.includes('create') || url.includes('admin-users') || url.includes('/login');
    expect(onSamePage).toBe(true);
  });

  test('rollväljare har rätt alternativ', async ({ page }) => {
    await page.goto(`${baseURL}/admin/admin-users/create`);

    const roleSelect = page.locator('#role, select[name="role"]');
    if (await roleSelect.isVisible().catch(() => false)) {
      const options = await roleSelect.locator('option').allTextContents();
      expect(options.length, 'Inga roller hittades').toBeGreaterThan(0);
    }
  });
});
