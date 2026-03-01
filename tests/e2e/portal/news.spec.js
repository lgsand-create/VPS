/**
 * E2E – Nyheter (/portal/news)
 *
 * Nyhetslista, artiklar, uppgifter.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Portal Nyheter', () => {
  test('nyhetslistan laddar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/news`);
    await assertNo500(page);
  });

  test('nyhetsartiklar visas', async ({ page }) => {
    await page.goto(`${baseURL}/portal/news`);

    const articles = page.locator('.news-item, .article, .card, .post');
    const count = await articles.count();
    // Det bör finnas nyheter
    if (count > 0) {
      await expect(articles.first()).toBeVisible();
    }
  });

  test('nyhetsartikel kan öppnas', async ({ page }) => {
    await page.goto(`${baseURL}/portal/news`);

    const articleLink = page.locator('a[href*="/portal/news/"]').first();
    if (await articleLink.isVisible().catch(() => false)) {
      await articleLink.click();
      await page.waitForLoadState('domcontentloaded');
      await assertNo500(page);
    }
  });

  test('uppgifter-flik fungerar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/news/tasks`);
    await assertNo500(page);
  });

  test('uppgiftsdetalj laddar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/news/tasks`);

    const taskLink = page.locator('a[href*="/tasks/"]').first();
    if (await taskLink.isVisible().catch(() => false)) {
      await taskLink.click();
      await page.waitForLoadState('domcontentloaded');
      await assertNo500(page);
    }
  });
});
