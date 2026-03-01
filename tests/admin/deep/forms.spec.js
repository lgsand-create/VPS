/**
 * Deep Click – Formulärvalidering
 *
 * Stöder två lägen:
 * - Statiska routes: testar form-routes från site.routes
 * - Portal-crawl: upptäcker formulär dynamiskt på alla portal-sidor
 *
 * Körning:
 *   npm run test:deep:forms
 */

import { test, expect } from '@playwright/test';
import { getActiveSite } from '../../../sites/index.js';
import { assertPageLoads } from '../../helpers/assertions.js';
import {
  isFormRoute,
  discoverForms,
  discoverLinks,
  startJsErrorCollection,
  shouldSkipHref,
  isDownloadRoute,
} from '../../helpers/deep.js';

const site = getActiveSite();
const hasStaticRoutes = Object.keys(site.routes).length > 0;

test.setTimeout(60_000);

async function testFormsOnPage(page, pageLabel) {
  const forms = await discoverForms(page);
  const testable = forms.filter(
    (f) => f.hasSubmit && f.fieldCount > 0 && f.method === 'POST'
  );

  if (testable.length === 0) return { skipped: true, results: [] };

  const results = [];

  for (let i = 0; i < testable.length; i++) {
    const form = testable[i];
    const formIndex = forms.indexOf(form);

    // Rensa textfält men behåll CSRF och hidden fields
    await page.evaluate((idx) => {
      const formEl = document.querySelectorAll('form')[idx];
      if (!formEl) return;
      const clearTypes = ['text', 'email', 'tel', 'number', 'url', 'search'];
      for (const input of formEl.querySelectorAll('input, textarea')) {
        if (input.type === 'hidden') continue;
        if (input.name === 'csrf_token') continue;
        if (clearTypes.includes(input.type) || input.tagName === 'TEXTAREA') {
          input.value = '';
        }
      }
    }, formIndex);

    try {
      const submitBtn = page.locator('form').nth(formIndex)
        .locator('button[type="submit"], input[type="submit"]').first();
      await submitBtn.click({ timeout: 5_000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });

      const result = await page.evaluate(() => {
        const body = document.body?.textContent || '';
        return {
          url: window.location.href,
          hasError500: body.includes('500') && (body.includes('Server Error') || body.includes('Internal Server')),
          hasValidation: !!document.querySelector(
            '.alert-danger, .alert-warning, .error, .is-invalid, .has-error, .validation-error, .invalid-feedback, .field-error, .form-error'
          ),
        };
      });

      results.push({ formIndex, page: pageLabel, ...result });
    } catch (err) {
      results.push({ formIndex, page: pageLabel, error: err.message.substring(0, 150) });
    }
  }

  return { skipped: false, results };
}

if (hasStaticRoutes) {
  // --- Statiska routes ---
  const formRoutes = Object.entries(site.routes).flatMap(([category, routes]) =>
    routes.filter((r) => isFormRoute(r) && !isDownloadRoute(r)).map((r) => ({ category, route: r }))
  );

  test.describe(`[Deep Forms] ${site.name}`, () => {
    for (const { category, route } of formRoutes) {
      test(`${route} – tom submission ger validering`, async ({ page }, testInfo) => {
        page.on('dialog', (dialog) => dialog.dismiss());
        const jsCollector = startJsErrorCollection(page);
        const { skipped } = await assertPageLoads(page, `${site.baseURL}${route}`);
        if (skipped) { jsCollector.cleanup(); test.skip(); return; }

        const { skipped: noForms, results } = await testFormsOnPage(page, route);
        const jsErrors = jsCollector.getCritical();
        jsCollector.cleanup();

        if (noForms) { test.skip(); return; }

        testInfo.annotations.push({
          type: 'forms',
          description: results.map((r) =>
            r.error ? `#${r.formIndex}: FEL` : `#${r.formIndex}: ${r.hasValidation ? 'validering' : 'ok'}`
          ).join(', '),
        });

        for (const result of results) {
          if (result.hasError500) {
            expect.soft(result.hasError500, `500-fel på ${route} form #${result.formIndex}`).toBeFalsy();
          }
        }

        expect(jsErrors, `JS-fel efter submission på ${route}`).toHaveLength(0);
      });
    }
  });
} else {
  // --- Portal-crawl ---
  test.describe('[Deep Forms] Portal', () => {
    test('Testa formulär på alla portal-sidor', async ({ page, context }, testInfo) => {
      test.setTimeout(180_000);
      page.on('dialog', (dialog) => dialog.dismiss());
      const jsCollector = startJsErrorCollection(page);

      const startPath = site.portalStart || '/portal';
      await page.goto(`${site.baseURL}${startPath}`, { waitUntil: 'domcontentloaded' });

      // Samla alla interna länkar
      const links = await discoverLinks(page, site.baseURL);
      const pageUrls = links
        .filter((l) => l.isInternal && !shouldSkipHref(l.href, site.baseURL))
        .map((l) => l.fullUrl);
      const uniqueUrls = [...new Set(pageUrls)];

      const allResults = [];
      let pagesWithForms = 0;

      // Testa formulär på varje upptäckt sida
      for (const url of uniqueUrls) {
        let testPage;
        try {
          testPage = await context.newPage();
          testPage.on('dialog', (dialog) => dialog.dismiss());
          const resp = await testPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
          if (resp?.status() === 200) {
            const { skipped, results } = await testFormsOnPage(testPage, url);
            if (!skipped) {
              pagesWithForms++;
              allResults.push(...results);
            }
          }
        } catch {
          // Sidan kunde inte laddas
        } finally {
          if (testPage) await testPage.close().catch(() => {});
        }
      }

      const jsErrors = jsCollector.getCritical();
      jsCollector.cleanup();

      testInfo.annotations.push({
        type: 'forms-result',
        description: `${pagesWithForms} sidor med formulär, ${allResults.length} formulär testade`,
      });

      console.log(`\nFormulär-resultat:`);
      console.log(`  Sidor med formulär: ${pagesWithForms}`);
      console.log(`  Formulär testade: ${allResults.length}`);
      console.log(`  JS-fel: ${jsErrors.length}`);

      // Inga 500-fel
      for (const result of allResults) {
        if (result.hasError500) {
          expect.soft(result.hasError500, `500-fel på ${result.page}`).toBeFalsy();
        }
      }

      expect(jsErrors, `JS-fel vid formulär-tester`).toHaveLength(0);
    });
  });
}
