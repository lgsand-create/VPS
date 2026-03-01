/**
 * E2E – Forum (/portal/forum)
 *
 * Forumgrupper, trådar, sök.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Portal Forum', () => {
  test('forumgrupper laddar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/forum`);
    await assertNo500(page);
  });

  test('grupper visas', async ({ page }) => {
    await page.goto(`${baseURL}/portal/forum`);

    const groups = page.locator('.forum-group-card, a[href*="/portal/forum/"]');
    const count = await groups.count();
    expect(count, 'Inga forumgrupper hittades').toBeGreaterThan(0);
  });

  test('trådar i grupp laddar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/forum`);

    const groupLink = page.locator('a[href*="/portal/forum/"]').first();
    if (await groupLink.isVisible().catch(() => false)) {
      await groupLink.click();
      await page.waitForLoadState('domcontentloaded');
      await assertNo500(page);
    }
  });

  test('sök i forum', async ({ page }) => {
    await page.goto(`${baseURL}/portal/forum/search`);
    await assertNo500(page);

    const searchInput = page.locator('input[type="search"], input[name="q"], input[name="search"], .search-input');
    if (await searchInput.count() > 0) {
      await expect(searchInput.first()).toBeVisible();
    }
  });

  test('skapa ny tråd', async ({ page }) => {
    await page.goto(`${baseURL}/portal/forum`);

    // Hitta "ny tråd"-knapp
    const newThread = page.locator('a:has-text("Ny"), a:has-text("Skapa"), button:has-text("Ny tråd")');
    if (await newThread.count() > 0) {
      await newThread.first().click();
      await page.waitForLoadState('domcontentloaded');
      await assertNo500(page);

      // Formulär bör finnas
      const form = page.locator('form');
      if (await form.count() > 0) {
        await expect(form.first()).toBeVisible();
      }
    }
  });
});
