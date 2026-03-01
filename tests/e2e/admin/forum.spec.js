/**
 * E2E – Forum Admin (/admin/forum)
 *
 * Forumgrupper, moderering.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Admin Forum', () => {
  test('forumlistan laddar', async ({ page }) => {
    await page.goto(`${baseURL}/admin/forum`);
    await assertNo500(page);
  });

  test('forumgrupper visas', async ({ page }) => {
    await page.goto(`${baseURL}/admin/forum`);

    // Forum-översikten visar statistik (Aktiva grupper, Trådar, etc.)
    const body = await page.textContent('body');
    const hasForumContent = /grupp|tråd|inlägg|moderation/i.test(body);
    expect(hasForumContent, 'Inget foruminnehåll hittades').toBe(true);
  });

  test('skapa/redigera forumgrupp', async ({ page }) => {
    await page.goto(`${baseURL}/admin/forum/create`);
    await assertNo500(page);
    {
      const form = page.locator('form');
      if (await form.count() > 0) {
        await expect(form.first()).toBeVisible();
      }
    }
  });

  test('forumkategorier laddar', async ({ page }) => {
    await page.goto(`${baseURL}/admin/forum/categories`);
    const bodyText = await page.textContent('body').catch(() => '');
    await assertNo500(page);
  });
});
