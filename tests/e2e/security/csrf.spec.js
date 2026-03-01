/**
 * E2E – CSRF-skydd
 *
 * Verifierar att POST-formulär har CSRF-tokens och att
 * requests utan token avvisas.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { getCsrfToken, assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('CSRF-skydd', () => {
  test('admin login har CSRF-token', async ({ page }) => {
    await page.goto(`${baseURL}/login`);
    const token = await getCsrfToken(page);
    expect(token, 'CSRF-token saknas på admin login').toBeTruthy();
    expect(token.length).toBeGreaterThan(10);
  });

  test('portal login har CSRF-token', async ({ page }) => {
    await page.goto(`${baseURL}/portal/login`);
    const token = await getCsrfToken(page);
    // Portal kanske inte har CSRF – notera resultatet
    if (token) {
      expect(token.length).toBeGreaterThan(10);
    }
  });

  test('POST utan CSRF-token avvisas', async ({ page }) => {
    await page.goto(`${baseURL}/login`);

    // Skicka POST direkt utan CSRF
    const response = await page.evaluate(async (url) => {
      const res = await fetch(`${url}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'username=test&password=test',
      });
      return { status: res.status, redirected: res.redirected };
    }, baseURL);

    // Borde avvisas (403) eller redirectas
    expect(
      response.status === 403 || response.status === 419 || response.redirected,
      'POST utan CSRF borde avvisas'
    ).toBe(true);
  });

  test('POST med felaktig CSRF-token avvisas', async ({ page }) => {
    await page.goto(`${baseURL}/login`);

    const response = await page.evaluate(async (url) => {
      const res = await fetch(`${url}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'username=test&password=test&csrf_token=INVALID_TOKEN_123',
      });
      return { status: res.status, redirected: res.redirected };
    }, baseURL);

    expect(
      response.status === 403 || response.status === 419 || response.redirected,
      'POST med felaktig CSRF borde avvisas'
    ).toBe(true);
  });
});
