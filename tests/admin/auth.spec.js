import { test, expect } from '@playwright/test';
import { login, logout } from '../helpers/auth.js';
import { getActiveSite } from '../../sites/index.js';

const site = getActiveSite();
const { auth, baseURL } = site;

test.describe(`[${site.name}] Login-sida`, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login-sidan laddas korrekt', async ({ page }) => {
    const response = await page.goto(`${baseURL}${auth.loginPath}`);
    expect(response.status()).toBe(200);

    await expect(page.locator(auth.selectors.username)).toBeVisible();
    await expect(page.locator(auth.selectors.password)).toBeVisible();

    if (auth.selectors.csrf) {
      await expect(page.locator(auth.selectors.csrf)).toBeAttached();
    }
  });

  if (auth.selectors.csrf) {
    test('CSRF-token finns och är ifylld', async ({ page }) => {
      await page.goto(`${baseURL}${auth.loginPath}`);
      const csrf = await page.locator(auth.selectors.csrf).getAttribute('value');
      expect(csrf).toBeTruthy();
      expect(csrf.length).toBeGreaterThan(10);
    });
  }

  test('felaktigt lösenord → stannar på login', async ({ page }) => {
    await page.goto(`${baseURL}${auth.loginPath}`);
    await page.fill(auth.selectors.username, 'admin');
    await page.fill(auth.selectors.password, 'definitivt_fel_lösenord');

    for (const field of auth.extraFields || []) {
      if (field.action === 'select') await page.selectOption(field.selector, field.value);
    }

    await page.click(auth.selectors.submit);
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(auth.loginRedirectPattern);
  });
});

test.describe(`[${site.name}] Autentiseringsskydd`, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const allRoutes = Object.values(site.routes).flat();
  const sample = allRoutes.filter((_, i) => i % 15 === 0).slice(0, 8);

  for (const route of sample) {
    test(`${route} → redirect utan session`, async ({ page }) => {
      await page.goto(`${baseURL}${route}`);
      await expect(page).toHaveURL(auth.loginRedirectPattern);
    });
  }
});

test.describe(`[${site.name}] Utloggning`, () => {
  test('utloggning avslutar sessionen', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page, site);
    await expect(page).not.toHaveURL(auth.loginRedirectPattern);

    await logout(page, site);
    await expect(page).toHaveURL(auth.loginRedirectPattern);

    const firstRoute = Object.values(site.routes).flat()[0];
    if (firstRoute) {
      await page.goto(`${baseURL}${firstRoute}`);
      await expect(page).toHaveURL(auth.loginRedirectPattern);
    }

    await context.close();
  });
});
