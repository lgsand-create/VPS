/**
 * E2E – Glömt lösenord (/portal/forgot-password)
 *
 * Formulär, validering, submit.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

// Körs utan session
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Glömt lösenord', () => {
  test('formuläret laddar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/forgot-password`);
    await assertNo500(page);

    const emailField = page.locator('#email, input[name="email"], input[type="email"]').first();
    await expect(emailField).toBeVisible();
  });

  test('submit med giltig email → success-meddelande', async ({ page }) => {
    await page.goto(`${baseURL}/portal/forgot-password`);

    const emailField = page.locator('#email, input[name="email"], input[type="email"]').first();
    await emailField.fill('js@vda.se');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2_000);
    await assertNo500(page);

    // Borde visa bekräftelse
    const body = await page.textContent('body');
    const hasConfirmation = /skickat|email|länk|success|bekräftelse/i.test(body);
    const hasAlert = await page.locator('.alert-success, .alert-info').count();
    expect(hasConfirmation || hasAlert > 0, 'Borde visa bekräftelse').toBe(true);
  });

  test('submit med ogiltig email → felmeddelande', async ({ page }) => {
    await page.goto(`${baseURL}/portal/forgot-password`);

    const emailField = page.locator('#email, input[name="email"], input[type="email"]').first();
    await emailField.fill('inteenemail');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1_000);

    // HTML5-validering eller server-validering
    const stillOnPage = page.url().includes('forgot');
    expect(stillOnPage).toBe(true);
  });
});
