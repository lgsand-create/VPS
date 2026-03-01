import { createAuthenticatedPage } from './helpers/browser.js';
import { saveJson } from './helpers/storage.js';
import { withRetry, createRateLimiter } from './helpers/retry.js';

const siteId = process.argv[2] || 'backatorpif';

async function scrapeMembers() {
  console.log(`🔍 Scrapar medlemmar från ${siteId}...`);

  const { browser, page, site } = await createAuthenticatedPage(siteId);
  const rateLimit = createRateLimiter(500);

  try {
    await rateLimit();
    await page.goto(`${site.baseURL}/admin/members`);

    const members = await withRetry(async () => {
      await page.waitForSelector('table tbody tr', { timeout: 10_000 });

      return page.$$eval('table tbody tr', (rows) =>
        rows.map((row) => {
          const cells = row.querySelectorAll('td');
          return {
            name: cells[0]?.textContent?.trim() || '',
            email: cells[1]?.textContent?.trim() || '',
            team: cells[2]?.textContent?.trim() || '',
          };
        })
      );
    });

    console.log(`✅ Hittade ${members.length} medlemmar`);
    saveJson(siteId, 'members', members);

    return members;
  } finally {
    await browser.close();
  }
}

scrapeMembers().catch(console.error);
