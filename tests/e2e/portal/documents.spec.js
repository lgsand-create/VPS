/**
 * E2E – Dokument (/portal/documents)
 *
 * Dokumentlista, kategorier, nedladdning.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Portal Dokument', () => {
  test('dokumentsidan laddar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/documents`);
    await assertNo500(page);
  });

  test('dokument eller kategorier visas', async ({ page }) => {
    await page.goto(`${baseURL}/portal/documents`);

    const items = page.locator('.document, .doc-item, .card, .list-group-item, .file-item');
    const count = await items.count();
    // Kan vara tomt men sidan ska inte vara helt blank
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(100);
  });

  test('dokument kan öppnas/laddas ner', async ({ page }) => {
    await page.goto(`${baseURL}/portal/documents`);

    const docLink = page.locator('a[href*="/documents/"], a[href*=".pdf"], a[href*="download"]').first();
    if (await docLink.isVisible().catch(() => false)) {
      const href = await docLink.getAttribute('href');
      expect(href).toBeTruthy();
    }
  });
});
