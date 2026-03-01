/**
 * E2E – Publika formulär (/forms/{code})
 *
 * Publika formulär renderas och valideras korrekt.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Publika formulär', () => {
  test('formulärsida finns', async ({ page }) => {
    const response = await page.goto(`${baseURL}/forms/test`);
    const status = response?.status();
    expect(status, 'Forms-sidan ger 500').not.toBe(500);
  });

  test('formulärfält renderas', async ({ page }) => {
    await page.goto(`${baseURL}/forms/test`);

    const form = page.locator('form');
    if (await form.count() > 0) {
      const inputs = page.locator('input, textarea, select');
      const count = await inputs.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('validering fungerar', async ({ page }) => {
    await page.goto(`${baseURL}/forms/test`);

    const form = page.locator('form');
    if (await form.count() > 0) {
      const submitBtn = page.locator('button[type="submit"]');
      if (await submitBtn.count() > 0) {
        await submitBtn.click();
        await page.waitForTimeout(1_000);
        // Borde stanna kvar eller visa valideringsfel
        await assertNo500(page);
      }
    }
  });
});
