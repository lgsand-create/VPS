/**
 * Deep Click – Tillgänglighet (a11y)
 *
 * Grundläggande tillgänglighetskontroller på varje portal-sida:
 * - Bilder utan alt-text
 * - Knappar utan text/aria-label
 * - Formulärfält utan labels
 * - Sidor utan rubrik (h1/h2/h3)
 *
 * Körning:
 *   npm run test:deep:a11y
 */

import { test, expect } from '@playwright/test';
import { getActiveSite } from '../../../sites/index.js';
import {
  checkAccessibility,
  crawlPortal,
} from '../../helpers/deep.js';

const site = getActiveSite();

test.setTimeout(300_000);

test.describe('[Deep A11y] Tillgänglighet', () => {
  test('Kontrollera tillgänglighet på alla portal-sidor', async ({ page, context }, testInfo) => {
    page.on('dialog', (d) => d.dismiss());

    const { visited } = await crawlPortal(page, context, site, {
      maxDepth: 2,
      maxPages: 100,
    });

    const allIssues = [];
    let pagesChecked = 0;

    for (const [url, data] of visited) {
      if (data.status !== 200) continue;

      let testPage;
      try {
        testPage = await context.newPage();
        testPage.on('dialog', (d) => d.dismiss());
        await testPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });

        const issues = await checkAccessibility(testPage);
        if (issues.length > 0) {
          allIssues.push({ url, issues });
        }
        pagesChecked++;
      } catch {
        // Hoppa över sidor som inte laddar
      } finally {
        if (testPage) await testPage.close().catch(() => {});
      }
    }

    // Sammanställning
    const totalIssues = allIssues.reduce((sum, p) => sum + p.issues.length, 0);
    const issueTypes = {};
    for (const { issues } of allIssues) {
      for (const issue of issues) {
        if (!issueTypes[issue.type]) issueTypes[issue.type] = 0;
        issueTypes[issue.type] += issue.count;
      }
    }

    testInfo.annotations.push({
      type: 'a11y-summary',
      description: `${pagesChecked} sidor, ${allIssues.length} med problem, ${totalIssues} issues totalt`,
    });

    console.log(`\n═══ TILLGÄNGLIGHET ═══`);
    console.log(`  Sidor kontrollerade: ${pagesChecked}`);
    console.log(`  Sidor med problem: ${allIssues.length}`);
    console.log(`  Totala issues: ${totalIssues}`);

    if (Object.keys(issueTypes).length > 0) {
      console.log(`\n  Per typ:`);
      for (const [type, count] of Object.entries(issueTypes)) {
        console.log(`    ${type}: ${count}`);
      }
    }

    if (allIssues.length > 0) {
      console.log(`\n  Detaljer:`);
      for (const { url, issues } of allIssues) {
        console.log(`\n    ${url}`);
        for (const issue of issues) {
          console.log(`      ${issue.description}`);
          if (issue.elements) {
            console.log(`        → ${issue.elements.join(', ')}`);
          }
        }
      }
    }

    // Soft asserts: rapportera men faila inte
    for (const { url, issues } of allIssues) {
      for (const issue of issues) {
        expect.soft(
          issue.count,
          `${issue.description} på ${new URL(url).pathname}`
        ).toBe(0);
      }
    }
  });
});
