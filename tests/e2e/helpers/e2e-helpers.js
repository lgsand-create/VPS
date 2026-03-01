/**
 * E2E-specifika hjälpfunktioner.
 *
 * Gemensamma utilities för CRUD-tester, formulär och assertions.
 * Importeras av alla E2E spec-filer.
 */
import { expect } from '@playwright/test';
import { getActiveSite } from '../../../sites/index.js';

/**
 * Generera unikt test-ID för testdata.
 * Alla testdata skapas med detta prefix för enkel cleanup.
 */
export function generateTestId() {
  return `__TEST_${Date.now()}`;
}

/**
 * Hämta CSRF-token från aktuell sida.
 */
export async function getCsrfToken(page) {
  return page.evaluate(() => {
    const input = document.querySelector(
      'input[name="csrf_token"], input[name="_token"], meta[name="csrf-token"]'
    );
    if (!input) return null;
    return input.getAttribute('value') || input.getAttribute('content');
  });
}

/**
 * Verifiera att ett success-meddelande visas.
 */
export async function expectSuccess(page, timeout = 5_000) {
  const selector = '.alert-success, .toast-success, .flash-success, .notification-success';
  await expect(page.locator(selector).first()).toBeVisible({ timeout });
}

/**
 * Verifiera att ett felmeddelande visas.
 */
export async function expectError(page, timeout = 5_000) {
  const selector = '.alert-danger, .alert-error, .toast-error, .text-danger, .invalid-feedback:visible';
  await expect(page.locator(selector).first()).toBeVisible({ timeout });
}

/**
 * Fyll i formulärfält generiskt.
 * @param {import('@playwright/test').Page} page
 * @param {Array<{selector: string, value: string, action?: string}>} fields
 */
export async function fillForm(page, fields) {
  for (const field of fields) {
    const action = field.action || 'fill';
    switch (action) {
      case 'fill':
        await page.fill(field.selector, field.value);
        break;
      case 'select':
        await page.selectOption(field.selector, field.value);
        break;
      case 'check':
        await page.check(field.selector);
        break;
      case 'uncheck':
        await page.uncheck(field.selector);
        break;
      default:
        await page.fill(field.selector, field.value);
    }
  }
}

/**
 * Hämta admin site-konfiguration (remappar adminAuth till auth).
 */
export function getAdminSiteConfig() {
  const site = getActiveSite();
  if (!site.adminAuth) {
    throw new Error(`Site "${site.id}" saknar adminAuth-konfiguration`);
  }
  return { ...site, auth: site.adminAuth };
}

/**
 * Vänta på att sidan laddats klart efter navigation.
 */
export async function waitForPage(page, timeout = 10_000) {
  await page.waitForLoadState('domcontentloaded', { timeout });
}

/**
 * Kontrollera att sidan INTE visar ett 500-fel.
 * Matchar specifika felmönster – inte bara "500" i löpande text.
 */
export async function assertNo500(page) {
  const title = await page.title().catch(() => '');
  const bodyText = await page.textContent('body').catch(() => '');
  const hasServerError =
    /internal server error|fatal error|server error/i.test(bodyText) ||
    /500 internal/i.test(bodyText) ||
    /error 500|http 500/i.test(title) ||
    /^500$/m.test(title);
  expect(hasServerError, 'Sidan visar 500-fel').toBe(false);
}
