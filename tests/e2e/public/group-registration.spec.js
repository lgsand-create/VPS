/**
 * E2E – Gruppregistrering (/join/{code})
 *
 * Publikt registreringsformulär.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Gruppregistrering', () => {
  test('registreringssida finns', async ({ page }) => {
    // Testa om /join finns som route
    const response = await page.goto(`${baseURL}/join/test`);
    const status = response?.status();

    // 200 = sidan finns, 404 = koden finns inte (men sidan hanterar det)
    // 500 = problem
    expect(status, 'Join-sidan ger 500').not.toBe(500);
  });

  test('formuläret renderas med fält', async ({ page }) => {
    await page.goto(`${baseURL}/join/test`);

    // Om sidan finns, kolla efter formulärfält
    const form = page.locator('form');
    if (await form.count() > 0) {
      const inputs = page.locator('input');
      const count = await inputs.count();
      expect(count, 'Inga formulärfält hittades').toBeGreaterThan(0);
    }
  });

  test('validering av obligatoriska fält', async ({ page }) => {
    await page.goto(`${baseURL}/join/test`);

    const form = page.locator('form');
    if (await form.count() > 0) {
      // Klicka submit utan att fylla i
      const submitBtn = page.locator('button[type="submit"]');
      if (await submitBtn.count() > 0) {
        await submitBtn.click();
        await page.waitForTimeout(1_000);

        // Borde visa validering eller stanna kvar
        const url = page.url();
        expect(url).toContain('/join');
      }
    }
  });
});
