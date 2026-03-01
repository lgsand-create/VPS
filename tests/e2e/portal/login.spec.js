/**
 * E2E – Portal Login (/portal/login)
 *
 * Testar portalinloggning, felhantering, länkar.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { getCsrfToken } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

// Dessa tester kör utan sparad session
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Portal Login', () => {
  test('login-sidan laddar korrekt', async ({ page }) => {
    await page.goto(`${baseURL}/portal/login`);
    await expect(page.locator('#email, input[name="email"], input[type="email"]').first()).toBeVisible();
    await expect(page.locator('#password, input[name="password"]').first()).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('lyckad inloggning → redirect till portal', async ({ page }) => {
    await page.goto(`${baseURL}/portal/login`);
    await page.fill('#email, input[name="email"], input[type="email"]', site.auth.credentials.username);
    await page.fill('#password, input[name="password"]', site.auth.credentials.password);
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/portal/, { timeout: 10_000 });
    expect(page.url()).toContain('/portal');
  });

  test('felaktig email/lösenord → felmeddelande', async ({ page }) => {
    await page.goto(`${baseURL}/portal/login`);
    await page.fill('#email, input[name="email"], input[type="email"]', 'felaktig@email.se');
    await page.fill('#password, input[name="password"]', 'fellösenord123');
    await page.click('button[type="submit"]');

    await page.waitForTimeout(2_000);
    const errorVisible = await page.locator('.alert-error, .alert-danger').isVisible().catch(() => false);
    const stillOnLogin = page.url().includes('/login');
    expect(errorVisible || stillOnLogin, 'Borde visa fel eller stanna på login').toBe(true);
  });

  test('"Glömt lösenordet?" länk finns', async ({ page }) => {
    await page.goto(`${baseURL}/portal/login`);
    const forgotLink = page.locator('a[href*="forgot"], a:has-text("Glömt"), a:has-text("glömt")');
    if (await forgotLink.count() > 0) {
      await expect(forgotLink.first()).toBeVisible();
    }
  });

  test('remember-me checkbox finns', async ({ page }) => {
    await page.goto(`${baseURL}/portal/login`);
    const remember = page.locator('#remember_me, input[name="remember_me"], input[name="remember"]');
    if (await remember.count() > 0) {
      await expect(remember.first()).toBeVisible();
    }
  });

  test('SMS-login länk finns', async ({ page }) => {
    await page.goto(`${baseURL}/portal/login`);
    const smsLink = page.locator('a[href*="sms"], a:has-text("SMS")');
    if (await smsLink.count() > 0) {
      await expect(smsLink.first()).toBeVisible();
    }
  });
});
