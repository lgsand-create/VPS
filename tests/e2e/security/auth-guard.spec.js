/**
 * E2E – Obehörig åtkomst (Auth Guard)
 *
 * Verifierar att skyddade sidor kräver inloggning.
 * OBS: Importerar INTE från fixtures.js – auto-login ska inte köras här.
 */
import { test, expect } from '@playwright/test';
import { getActiveSite } from '../../../sites/index.js';

const site = getActiveSite();
const baseURL = site.baseURL;

// Utan session
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Auth Guard', () => {
  test('/portal/dashboard utan login → redirect till /login', async ({ page }) => {
    await page.goto(`${baseURL}/portal/dashboard`, { waitUntil: 'domcontentloaded' });

    expect(page.url()).toMatch(/\/login/);
  });

  test('/portal/profile utan login → redirect till /login', async ({ page }) => {
    await page.goto(`${baseURL}/portal/profile`, { waitUntil: 'domcontentloaded' });

    expect(page.url()).toMatch(/\/login/);
  });

  test('/portal/my-teams utan login → redirect till /login', async ({ page }) => {
    await page.goto(`${baseURL}/portal/my-teams`, { waitUntil: 'domcontentloaded' });

    expect(page.url()).toMatch(/\/login/);
  });

  test('/portal/profile/edit utan login → redirect till /login', async ({ page }) => {
    await page.goto(`${baseURL}/portal/profile/edit`, { waitUntil: 'domcontentloaded' });

    expect(page.url()).toMatch(/\/login/);
  });

  // Admin-sidor – dev-miljön kanske inte kräver auth, testar med soft assert
  test('/admin utan login → bör redirecta', async ({ page }) => {
    await page.goto(`${baseURL}/admin`, { waitUntil: 'domcontentloaded' });

    const url = page.url();
    const redirectedToLogin = url.includes('/login');
    expect.soft(redirectedToLogin,
      `Admin dashboard borde kräva login, men URL var: ${url}`
    ).toBe(true);
  });

  test('/admin/members utan login → bör redirecta', async ({ page }) => {
    await page.goto(`${baseURL}/admin/members`, { waitUntil: 'domcontentloaded' });

    const url = page.url();
    const redirectedToLogin = url.includes('/login');
    expect.soft(redirectedToLogin,
      `Admin members borde kräva login, men URL var: ${url}`
    ).toBe(true);
  });

  test('/admin/settings utan login → bör redirecta', async ({ page }) => {
    await page.goto(`${baseURL}/admin/settings`, { waitUntil: 'domcontentloaded' });

    const url = page.url();
    const redirectedToLogin = url.includes('/login');
    expect.soft(redirectedToLogin,
      `Admin settings borde kräva login, men URL var: ${url}`
    ).toBe(true);
  });
});
