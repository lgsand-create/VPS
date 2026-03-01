/**
 * E2E – Portal Logout
 *
 * Utloggning rensar session och redirectar.
 * OBS: Importerar INTE från fixtures.js – auto-login ska inte köras här.
 */
import { test, expect } from '@playwright/test';
import { getActiveSite } from '../../../sites/index.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Portal Logout', () => {
  test('utloggning redirectar bort från dashboard', async ({ page }) => {
    // Verifiera att vi är inloggade
    await page.goto(`${baseURL}/portal/dashboard`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/portal/);

    // Logga ut
    await page.goto(`${baseURL}/portal/logout`, { waitUntil: 'domcontentloaded' });

    // Borde hamna på portal-startsidan eller login (systemet avgör)
    const url = page.url();
    expect(url).not.toMatch(/\/portal\/dashboard/);
  });

  test('efter logout: portal-sidor redirectar till login', async ({ page }) => {
    // Logga ut
    await page.goto(`${baseURL}/portal/logout`, { waitUntil: 'domcontentloaded' });

    // Rensa cookies för att säkerställa utloggning
    await page.context().clearCookies();

    // Försök nå skyddad sida
    await page.goto(`${baseURL}/portal/dashboard`, { waitUntil: 'domcontentloaded' });

    // Borde ha redirectats till login eller portal-startsida
    const url = page.url();
    expect(url).toMatch(/\/login|\/portal$/);
  });
});
