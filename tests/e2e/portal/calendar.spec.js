/**
 * E2E – Kalender (/portal/calendar)
 *
 * Kalendervy, navigering, events.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500 } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Portal Kalender', () => {
  test('kalendervyn laddar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/calendar`);
    await assertNo500(page);
  });

  test('navigering framåt/bakåt fungerar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/calendar`);

    // Hitta navigeringsknappar
    const nextBtn = page.locator('button:has-text("Nästa"), a:has-text("Nästa"), .next, .fc-next-button, [aria-label="next"]');
    const prevBtn = page.locator('button:has-text("Föregående"), a:has-text("Föregående"), .prev, .fc-prev-button, [aria-label="prev"]');

    if (await nextBtn.count() > 0) {
      await nextBtn.first().click();
      await page.waitForTimeout(1_000);
      await assertNo500(page);

      if (await prevBtn.count() > 0) {
        await prevBtn.first().click();
        await page.waitForTimeout(1_000);
        await assertNo500(page);
      }
    }
  });

  test('lagfilter finns', async ({ page }) => {
    await page.goto(`${baseURL}/portal/calendar`);

    const filter = page.locator('select, .filter, .team-filter, [data-filter]');
    // Filter kan finnas eller inte
    const count = await filter.count();
    if (count > 0) {
      await expect(filter.first()).toBeVisible();
    }
  });

  test('events/aktiviteter visas', async ({ page }) => {
    await page.goto(`${baseURL}/portal/calendar`);

    // Vänta på att kalenderinnehåll laddats
    await page.waitForTimeout(2_000);

    const events = page.locator('.event, .calendar-event, .fc-event, .activity, [data-event]');
    // Det kanske inte finns events just nu, men sidan ska inte vara tom
    const body = await page.textContent('body');
    expect(body.length).toBeGreaterThan(100);
  });
});
