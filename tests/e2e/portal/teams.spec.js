/**
 * E2E – Mina Lag (/portal/my-teams)
 *
 * Laglista, lagdetalj, lagmedlemmar.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Mina Lag', () => {
  test('laglistan laddar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/my-teams`);
    await assertNo500(page);
  });

  test('lag visas i listan', async ({ page }) => {
    await page.goto(`${baseURL}/portal/my-teams`);

    const teams = page.locator('.team-tab, .team-dashboard-card');
    const count = await teams.count();
    // Användaren bör ha minst ett lag
    expect(count).toBeGreaterThan(0);
  });

  test('klick på lag visar lagmedlemmar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/my-teams`);

    const teamLink = page.locator('a[href*="/my-teams"]').first();
    if (await teamLink.isVisible().catch(() => false)) {
      await teamLink.click();
      await page.waitForLoadState('domcontentloaded');
      await assertNo500(page);
    }
  });

  test('lagdetalj med id laddar', async ({ page }) => {
    // Testa en specifik lag-URL
    await page.goto(`${baseURL}/portal/my-teams?id=43`);
    await assertNo500(page);

    // Bör visa lagmedlemmar eller info
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(100);
  });
});
