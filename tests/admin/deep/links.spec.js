/**
 * Deep Click – Länkcrawler (fördjupad)
 *
 * Crawlar portalen 3 nivåer djupt (max 200 sidor).
 * Per sida: samlar JS-fel, nätverksfel, laddtider.
 * Flaggar: trasiga sidor, långsamma sidor (>3s), JS-fel per sida.
 *
 * Körning:
 *   npm run test:deep:links
 */

import { test, expect } from '@playwright/test';
import { getActiveSite } from '../../../sites/index.js';
import { assertPageLoads } from '../../helpers/assertions.js';
import {
  discoverLinks,
  startJsErrorCollection,
  startNetworkMonitor,
  shouldSkipHref,
  isDownloadRoute,
  crawlPortal,
} from '../../helpers/deep.js';

const site = getActiveSite();
const hasStaticRoutes = Object.keys(site.routes).length > 0;

test.setTimeout(300_000);

if (hasStaticRoutes) {
  // --- Statiska routes (admin-panelen) ---
  for (const [category, routes] of Object.entries(site.routes)) {
    test.describe(`[Deep Links] ${category}`, () => {
      for (const route of routes) {
        test(`${route}`, async ({ page, context }, testInfo) => {
          if (isDownloadRoute(route)) { test.skip(); return; }

          page.on('dialog', (dialog) => dialog.dismiss());
          const jsCollector = startJsErrorCollection(page);
          const netMonitor = startNetworkMonitor(page);
          const { skipped } = await assertPageLoads(page, `${site.baseURL}${route}`);

          if (skipped) { jsCollector.cleanup(); netMonitor.cleanup(); test.skip(); return; }

          const links = await discoverLinks(page, site.baseURL);
          const safeLinks = links.filter(
            (l) => l.isInternal && !shouldSkipHref(l.href, site.baseURL)
          );

          testInfo.annotations.push({
            type: 'links',
            description: `${safeLinks.length} klickbara av ${links.length} totalt`,
          });

          const failures = [];
          for (const link of safeLinks) {
            let newPage;
            try {
              newPage = await context.newPage();
              newPage.on('dialog', (dialog) => dialog.dismiss());
              const resp = await newPage.goto(link.fullUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 15_000,
              });
              const status = resp?.status() || 0;
              if (![200, 302, 303, 403].includes(status)) {
                failures.push({ href: link.href, text: link.text, status });
              }
            } catch (err) {
              failures.push({ href: link.href, text: link.text, error: err.message.substring(0, 120) });
            } finally {
              if (newPage) await newPage.close().catch(() => {});
            }
          }

          const jsErrors = jsCollector.getCritical();
          const netFailures = netMonitor.getFailures();
          jsCollector.cleanup();
          netMonitor.cleanup();

          if (jsErrors.length > 0) {
            testInfo.annotations.push({ type: 'js-errors', description: jsErrors.map((e) => e.text).join('\n') });
          }
          if (netFailures.length > 0) {
            testInfo.annotations.push({ type: 'net-errors', description: netFailures.map((f) => `${f.type}: ${f.url} → ${f.status}`).join('\n') });
          }

          expect(
            failures,
            `${failures.length} länkar på ${route} misslyckades:\n` +
              failures.map((f) => `  ${f.href} → ${f.status || f.error}`).join('\n')
          ).toHaveLength(0);
        });
      }
    });
  }
} else {
  // --- Dynamisk crawling (ledarportalen) – 3 nivåer ---
  test.describe('[Deep Links] Portal-crawl', () => {
    test('Crawla alla sidor (3 nivåer, max 200)', async ({ page, context }, testInfo) => {
      page.on('dialog', (dialog) => dialog.dismiss());

      const { visited, failures } = await crawlPortal(page, context, site, {
        maxDepth: 3,
        maxPages: 200,
      });

      const pages = [...visited.entries()];
      const slowPages = pages.filter(([, d]) => d.loadTime > 3000);
      const pagesWithJsErrors = pages.filter(([, d]) => d.jsErrors?.length > 0);
      const pagesWithNetErrors = pages.filter(([, d]) => d.networkFailures?.length > 0);

      testInfo.annotations.push({
        type: 'crawl-summary',
        description: [
          `${visited.size} sidor`,
          `${failures.length} misslyckade`,
          `${slowPages.length} långsamma (>3s)`,
          `${pagesWithJsErrors.length} med JS-fel`,
          `${pagesWithNetErrors.length} med nätverksfel`,
        ].join(' | '),
      });

      console.log(`\n═══ CRAWL-RESULTAT ═══`);
      console.log(`  Sidor besökta: ${visited.size}`);
      console.log(`  Misslyckade: ${failures.length}`);
      console.log(`  Långsamma (>3s): ${slowPages.length}`);
      console.log(`  Med JS-fel: ${pagesWithJsErrors.length}`);
      console.log(`  Med nätverksfel: ${pagesWithNetErrors.length}`);

      if (slowPages.length > 0) {
        console.log(`\n  Långsamma sidor:`);
        for (const [url, data] of slowPages) {
          console.log(`    ${data.loadTime}ms – ${url}`);
        }
      }
      if (pagesWithJsErrors.length > 0) {
        console.log(`\n  Sidor med JS-fel:`);
        for (const [url, data] of pagesWithJsErrors) {
          for (const err of data.jsErrors) console.log(`    ${url} → ${err.substring(0, 100)}`);
        }
      }
      if (pagesWithNetErrors.length > 0) {
        console.log(`\n  Sidor med nätverksfel:`);
        for (const [url, data] of pagesWithNetErrors) {
          for (const f of data.networkFailures) console.log(`    ${f.type} ${f.status}: ${f.url.substring(0, 80)}`);
        }
      }

      console.log(`\n  Alla besökta URLer:`);
      for (const [url, data] of pages) {
        const flags = [
          data.loadTime > 3000 ? `SLOW ${data.loadTime}ms` : '',
          data.jsErrors?.length ? `JS(${data.jsErrors.length})` : '',
          data.networkFailures?.length ? `NET(${data.networkFailures.length})` : '',
        ].filter(Boolean).join(' ');
        console.log(`    [${data.status}] ${url}${flags ? ` ⚠ ${flags}` : ''}`);
      }

      // Soft asserts: JS-fel varnar men failar inte
      for (const [url, data] of pagesWithJsErrors) {
        expect.soft(data.jsErrors.length, `JS-fel på ${url}: ${data.jsErrors[0]}`).toBe(0);
      }

      // Hård assert: inga trasiga sidor
      expect(
        failures,
        `${failures.length} sidor misslyckades:\n` +
          failures.map((f) => `  ${f.url} → ${f.status || f.error}`).join('\n')
      ).toHaveLength(0);
    });
  });
}
