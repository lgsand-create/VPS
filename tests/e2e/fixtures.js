/**
 * E2E Fixtures – Delade test-fixtures för alla E2E-tester.
 *
 * Alla E2E spec-filer importerar { test, expect } härifrån
 * istället för direkt från @playwright/test.
 *
 * Fixar:
 * - page.goto använder 'domcontentloaded' (PWA/SW gör 'load' långsam)
 * - Auto-login: om sidan redirectar till login, loggar in automatiskt
 */
import { test as base, expect } from '@playwright/test';
import { getActiveSite } from '../../sites/index.js';

const site = getActiveSite();

/**
 * Detekterar om sidan är en login-sida.
 */
function isLoginPage(url) {
  return /\/login(\?|$|#)/.test(url);
}

/**
 * Loggar in automatiskt baserat på vilken login-sida vi hamnade på.
 */
async function autoLogin(page, url) {
  const isAdminLogin = url.includes('/login') && !url.includes('/portal/login');
  const isPortalLogin = url.includes('/portal/login');

  if (isAdminLogin && site.adminAuth) {
    const auth = site.adminAuth;
    await page.waitForSelector(auth.selectors.username, { timeout: 5_000 }).catch(() => {});
    for (const field of auth.extraFields || []) {
      if (field.action === 'select') {
        await page.selectOption(field.selector, field.value).catch(() => {});
      }
    }
    await page.fill(auth.selectors.username, auth.credentials.username).catch(() => {});
    await page.fill(auth.selectors.password, auth.credentials.password).catch(() => {});
    await page.click(auth.selectors.submit).catch(() => {});
    await page.waitForURL(auth.postLoginPattern, { timeout: 10_000, waitUntil: 'domcontentloaded' }).catch(() => {});
  } else if (isPortalLogin && site.auth) {
    const auth = site.auth;
    await page.waitForSelector(auth.selectors.username, { timeout: 5_000 }).catch(() => {});
    await page.fill(auth.selectors.username, auth.credentials.username).catch(() => {});
    await page.fill(auth.selectors.password, auth.credentials.password).catch(() => {});
    await page.click(auth.selectors.submit).catch(() => {});
    await page.waitForURL(auth.postLoginPattern, { timeout: 10_000, waitUntil: 'domcontentloaded' }).catch(() => {});
  }
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const originalGoto = page.goto.bind(page);

    page.goto = async (url, options = {}) => {
      const response = await originalGoto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
        ...options,
      });

      // Om vi hamnade på en login-sida (session expirerat), logga in automatiskt
      const currentUrl = page.url();
      if (isLoginPage(currentUrl) && !isLoginPage(url)) {
        await autoLogin(page, currentUrl);
        // Navigera tillbaka till ursprunglig URL
        return originalGoto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
          ...options,
        });
      }

      return response;
    };

    await use(page);
  },
});

export { expect };
