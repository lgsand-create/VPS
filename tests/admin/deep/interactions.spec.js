/**
 * Deep Click – Interaktiva element (fördjupad)
 *
 * Klickar ALLT interaktivt på varje sida:
 * - Tabs, accordions, dropdowns, modaler
 * - Alla knappar (ej submit, ej farliga)
 * - Verifierar inga JS-fel efter varje klick
 *
 * Körning:
 *   npm run test:deep:interactions
 */

import { test, expect } from '@playwright/test';
import { getActiveSite } from '../../../sites/index.js';
import { assertPageLoads } from '../../helpers/assertions.js';
import {
  discoverLinks,
  discoverInteractiveElements,
  discoverButtons,
  startJsErrorCollection,
  shouldSkipHref,
  isDownloadRoute,
  crawlPortal,
} from '../../helpers/deep.js';

const site = getActiveSite();
const hasStaticRoutes = Object.keys(site.routes).length > 0;

test.setTimeout(60_000);

async function testInteractionsOnPage(page, pageLabel) {
  const elements = await discoverInteractiveElements(page);
  const buttons = await discoverButtons(page);
  const totalFound =
    elements.tabs.length +
    elements.accordions.length +
    elements.dropdowns.length +
    elements.modals.length +
    buttons.length;

  if (totalFound === 0) return { skipped: true, warnings: [], stats: {} };

  const warnings = [];
  const stats = {
    tabs: elements.tabs.length,
    accordions: elements.accordions.length,
    dropdowns: elements.dropdowns.length,
    modals: elements.modals.length,
    buttons: buttons.length,
    clicked: 0,
  };

  // Tabs
  if (elements.tabs.length > 0) {
    const tabSelector =
      '[role="tab"]:visible, .nav-tabs a:visible, .nav-tabs button:visible, [data-toggle="tab"]:visible, [data-bs-toggle="tab"]:visible';
    const visibleTabs = page.locator(tabSelector);
    const count = await visibleTabs.count();
    for (let i = 0; i < count; i++) {
      try {
        await visibleTabs.nth(i).click({ timeout: 3_000 });
        await page.waitForTimeout(300);
        stats.clicked++;
      } catch (err) {
        warnings.push({ type: 'tab', text: elements.tabs[i]?.text || `#${i}`, error: err.message.substring(0, 80) });
      }
    }
  }

  // Accordions
  if (elements.accordions.length > 0) {
    const accSelector =
      '[data-toggle="collapse"]:visible, [data-bs-toggle="collapse"]:visible, .accordion-button:visible';
    const visibleAcc = page.locator(accSelector);
    const count = await visibleAcc.count();
    for (let i = 0; i < count; i++) {
      try {
        await visibleAcc.nth(i).click({ timeout: 3_000 });
        await page.waitForTimeout(300);
        stats.clicked++;
      } catch (err) {
        warnings.push({ type: 'accordion', text: elements.accordions[i]?.text || `#${i}`, error: err.message.substring(0, 80) });
      }
    }
  }

  // Dropdowns
  if (elements.dropdowns.length > 0) {
    const ddSelector =
      '[data-toggle="dropdown"]:visible, [data-bs-toggle="dropdown"]:visible, .dropdown-toggle:visible';
    const visibleDD = page.locator(ddSelector);
    const count = await visibleDD.count();
    for (let i = 0; i < count; i++) {
      try {
        await visibleDD.nth(i).click({ timeout: 3_000 });
        await page.waitForTimeout(300);
        await page.locator('body').click({ position: { x: 1, y: 1 } });
        await page.waitForTimeout(200);
        stats.clicked++;
      } catch (err) {
        warnings.push({ type: 'dropdown', text: elements.dropdowns[i]?.text || `#${i}`, error: err.message.substring(0, 80) });
      }
    }
  }

  // Modaler
  if (elements.modals.length > 0) {
    const modalSelector = '[data-toggle="modal"]:visible, [data-bs-toggle="modal"]:visible';
    const visibleModals = page.locator(modalSelector);
    const count = await visibleModals.count();
    for (let i = 0; i < count; i++) {
      try {
        const target = elements.modals[i]?.target;
        await visibleModals.nth(i).click({ timeout: 3_000 });
        await page.waitForTimeout(500);
        let closed = false;
        if (target) {
          const closeBtn = page.locator(`${target} .close, ${target} .btn-close, ${target} [data-dismiss="modal"], ${target} [data-bs-dismiss="modal"]`);
          if ((await closeBtn.count()) > 0) {
            await closeBtn.first().click({ timeout: 2_000 });
            closed = true;
          }
        }
        if (!closed) await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        stats.clicked++;
      } catch (err) {
        await page.keyboard.press('Escape').catch(() => {});
        warnings.push({ type: 'modal', text: elements.modals[i]?.text || `#${i}`, error: err.message.substring(0, 80) });
      }
    }
  }

  // Knappar (ej submit, ej farliga)
  if (buttons.length > 0) {
    const btnSelector = 'button:not([type="submit"]):not([type="reset"]):not(.btn-logout):visible, [role="button"]:visible';
    const visibleBtns = page.locator(btnSelector);
    const count = await visibleBtns.count();
    const maxBtns = Math.min(count, 20); // Max 20 knappar per sida

    for (let i = 0; i < maxBtns; i++) {
      try {
        const btnText = await visibleBtns.nth(i).textContent().catch(() => '');
        const lower = (btnText || '').toLowerCase();
        // Extra säkerhetskoll
        if (['radera', 'ta bort', 'delete', 'remove', 'logga ut'].some(d => lower.includes(d))) continue;

        await visibleBtns.nth(i).click({ timeout: 2_000 });
        await page.waitForTimeout(300);
        // Stäng eventuell modal/popup som öppnades
        await page.keyboard.press('Escape').catch(() => {});
        stats.clicked++;
      } catch {
        // Knappar som inte kan klickas – tysta
      }
    }
  }

  return { skipped: false, warnings, stats };
}

if (hasStaticRoutes) {
  for (const [category, routes] of Object.entries(site.routes)) {
    test.describe(`[Deep Interactions] ${category}`, () => {
      for (const route of routes) {
        test(`${route}`, async ({ page }, testInfo) => {
          if (isDownloadRoute(route)) { test.skip(); return; }
          page.on('dialog', (dialog) => dialog.dismiss());
          const jsCollector = startJsErrorCollection(page);
          const { skipped } = await assertPageLoads(page, `${site.baseURL}${route}`);
          if (skipped) { jsCollector.cleanup(); test.skip(); return; }

          const result = await testInteractionsOnPage(page, route);
          const jsErrors = jsCollector.getCritical();
          jsCollector.cleanup();

          if (result.skipped) { test.skip(); return; }

          testInfo.annotations.push({
            type: 'stats',
            description: `${result.stats.clicked} klick av ${Object.values(result.stats).reduce((a, b) => a + b, 0) - result.stats.clicked} element`,
          });

          expect(jsErrors, `JS-fel på ${route}`).toHaveLength(0);
        });
      }
    });
  }
} else {
  test.describe('[Deep Interactions] Portal', () => {
    test('Klicka allt interaktivt på alla portal-sidor', async ({ page, context }, testInfo) => {
      test.setTimeout(300_000);
      page.on('dialog', (dialog) => dialog.dismiss());

      const { visited } = await crawlPortal(page, context, site, {
        maxDepth: 2,
        maxPages: 100,
      });

      let totalClicked = 0;
      let totalWarnings = 0;
      let pagesWithInteractions = 0;

      for (const [url, data] of visited) {
        if (data.status !== 200) continue;

        let testPage;
        try {
          testPage = await context.newPage();
          testPage.on('dialog', (d) => d.dismiss());

          const jsCollector = startJsErrorCollection(testPage);
          await testPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });

          const result = await testInteractionsOnPage(testPage, url);
          const jsErrors = jsCollector.getCritical();
          jsCollector.cleanup();

          if (!result.skipped) {
            pagesWithInteractions++;
            totalClicked += result.stats.clicked;
            totalWarnings += result.warnings.length;
          }

          if (jsErrors.length > 0) {
            expect.soft(jsErrors.length, `JS-fel efter klick på ${url}: ${jsErrors[0].text}`).toBe(0);
          }
        } catch {
          // Sidan kunde inte laddas
        } finally {
          if (testPage) await testPage.close().catch(() => {});
        }
      }

      testInfo.annotations.push({
        type: 'interaction-summary',
        description: `${pagesWithInteractions} sidor, ${totalClicked} klick, ${totalWarnings} varningar`,
      });

      console.log(`\n═══ INTERAKTIONER ═══`);
      console.log(`  Sidor med interaktioner: ${pagesWithInteractions}`);
      console.log(`  Totalt klickade element: ${totalClicked}`);
      console.log(`  Varningar: ${totalWarnings}`);
    });
  });
}
