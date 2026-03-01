/**
 * E2E – Admin Login (/login)
 *
 * Testar inloggning, felhantering, CSRF-validering.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { getCsrfToken } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

// Dessa tester kör utan sparad session
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Admin Login', () => {
  test('login-sidan laddar korrekt', async ({ page }) => {
    await page.goto(`${baseURL}/login`);
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('CSRF-token finns i formuläret', async ({ page }) => {
    await page.goto(`${baseURL}/login`);
    const token = await getCsrfToken(page);
    expect(token, 'CSRF-token saknas').toBeTruthy();
    expect(token.length).toBeGreaterThan(10);
  });

  test('association_id select finns', async ({ page }) => {
    await page.goto(`${baseURL}/login`);
    const select = page.locator('#association_id');
    if (await select.isVisible()) {
      const options = await select.locator('option').count();
      expect(options).toBeGreaterThan(0);
    }
  });

  test('lyckad inloggning → redirect till /admin', async ({ page }) => {
    await page.goto(`${baseURL}/login`);

    const assocSelect = page.locator('#association_id');
    if (await assocSelect.isVisible()) {
      await assocSelect.selectOption('1');
    }

    await page.fill('#username', site.adminAuth.credentials.username);
    await page.fill('#password', site.adminAuth.credentials.password);
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/admin/, { timeout: 10_000 });
    expect(page.url()).toContain('/admin');
  });

  test('felaktigt lösenord → felmeddelande', async ({ page }) => {
    await page.goto(`${baseURL}/login`);

    const assocSelect = page.locator('#association_id');
    if (await assocSelect.isVisible()) {
      await assocSelect.selectOption('1');
    }

    await page.fill('#username', 'admin');
    await page.fill('#password', 'fel_lösenord_123');
    await page.click('button[type="submit"]');

    // Antingen felmeddelande eller kvar på login-sidan
    const errorVisible = await page.locator('.alert-error, .alert-danger').isVisible().catch(() => false);
    const stillOnLogin = page.url().includes('/login');
    expect(errorVisible || stillOnLogin, 'Borde visa fel eller stanna på login').toBe(true);
  });

  test('tomt formulär → validering förhindrar submit', async ({ page }) => {
    await page.goto(`${baseURL}/login`);

    // Klicka submit utan att fylla i
    await page.click('button[type="submit"]');

    // HTML5-validering eller fortfarande på login
    const stillOnLogin = page.url().includes('/login');
    expect(stillOnLogin).toBe(true);
  });
});
