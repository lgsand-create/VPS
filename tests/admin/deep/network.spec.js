/**
 * Deep Click – Nätverksfel
 *
 * Besöker varje portal-sida och samlar trasiga resurser:
 * 404-bilder, felande CSS/JS, misslyckade API-anrop.
 *
 * Körning:
 *   npm run test:deep:network
 */

import { test, expect } from '@playwright/test';
import { getActiveSite } from '../../../sites/index.js';
import {
  discoverLinks,
  startNetworkMonitor,
  shouldSkipHref,
  crawlPortal,
} from '../../helpers/deep.js';

const site = getActiveSite();
const hasStaticRoutes = Object.keys(site.routes).length > 0;

test.setTimeout(300_000);

test.describe('[Deep Network] Trasiga resurser', () => {
  test('Hitta alla 404/500 resurser på portalen', async ({ page, context }, testInfo) => {
    page.on('dialog', (d) => d.dismiss());

    // Använd crawlern för att besöka alla sidor (den samlar nätverksfel per sida)
    const { visited } = await crawlPortal(page, context, site, {
      maxDepth: 3,
      maxPages: 200,
    });

    // Samla alla nätverksfel
    const allNetFailures = [];
    for (const [url, data] of visited) {
      if (data.networkFailures?.length > 0) {
        for (const f of data.networkFailures) {
          allNetFailures.push({ page: url, ...f });
        }
      }
    }

    // Gruppera per typ
    const byType = {};
    for (const f of allNetFailures) {
      const type = f.type || 'other';
      if (!byType[type]) byType[type] = [];
      byType[type].push(f);
    }

    testInfo.annotations.push({
      type: 'network-summary',
      description: Object.entries(byType)
        .map(([type, items]) => `${type}: ${items.length}`)
        .join(', ') || 'inga fel',
    });

    console.log(`\n═══ NÄTVERKSFEL ═══`);
    console.log(`  Totalt: ${allNetFailures.length} trasiga resurser`);

    for (const [type, items] of Object.entries(byType)) {
      console.log(`\n  ${type.toUpperCase()} (${items.length}):`);
      // Deduplicera på resurs-URL
      const unique = [...new Map(items.map(i => [i.url, i])).values()];
      for (const f of unique) {
        console.log(`    [${f.status}] ${f.url.substring(0, 100)}`);
        console.log(`      ← ${f.page.substring(0, 80)}`);
      }
    }

    // Soft assert per typ
    const jsFailures = byType.js || [];
    const cssFailures = byType.css || [];
    expect.soft(jsFailures.length, `${jsFailures.length} JS-filer ger 404/500`).toBe(0);
    expect.soft(cssFailures.length, `${cssFailures.length} CSS-filer ger 404/500`).toBe(0);

    // Hård assert: inga trasiga JS/CSS (bilder kan vara acceptabelt)
    const criticalFailures = allNetFailures.filter(f => f.type === 'js' || f.type === 'css');
    expect(
      criticalFailures,
      `${criticalFailures.length} kritiska resurser (JS/CSS) trasiga:\n` +
        criticalFailures.map(f => `  [${f.status}] ${f.url}`).join('\n')
    ).toHaveLength(0);
  });
});
