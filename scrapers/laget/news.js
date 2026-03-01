import { createBrowser } from '../helpers/browser.js';
import { saveJson } from '../helpers/storage.js';
import { sleep, createRateLimiter } from '../helpers/retry.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import https from 'https';

const SITE_URL = 'https://www.backatorpif.se';
const CUTOFF_DATE = new Date('2025-01-01');
const category = 'nyheter';
const DATA_DIR = join(import.meta.dirname, '../../data');
const IMAGE_DIR = join(DATA_DIR, category, 'bilder');

// Svenska månadsnamn → index
const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, maj: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11,
};

function parseSwedishDate(text) {
  if (!text) return null;
  const t = text.trim();

  // "24 sep 2025"
  const fullMatch = t.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  if (fullMatch) {
    const [, day, monthStr, year] = fullMatch;
    const month = MONTHS[monthStr.toLowerCase()];
    if (month !== undefined) return new Date(Number(year), month, Number(day));
  }

  // "7 jan" (utan år)
  const shortMatch = t.match(/^(\d{1,2})\s+(\w{3})$/);
  if (shortMatch) {
    const [, day, monthStr] = shortMatch;
    const month = MONTHS[monthStr.toLowerCase()];
    if (month !== undefined) {
      const now = new Date();
      let year = now.getFullYear();
      const candidate = new Date(year, month, Number(day));
      if (candidate > now) year--;
      return new Date(year, month, Number(day));
    }
  }

  // "för X dagar sedan"
  const daysAgo = t.match(/för\s+(\d+)\s+dag/i);
  if (daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - Number(daysAgo[1]));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // "för X timmar sedan" / "för X minuter sedan" → idag
  if (/för\s+\d+\s+(timm|minut)/i.test(t)) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // "igår"
  if (/igår/i.test(t)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // "idag"
  if (/idag/i.test(t)) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  return null;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// Strippa resize-parametrar från CDN-URL → original
// "https://az729104.cdn.laget.se/11783254.jpg;width=600;..." → "https://az729104.cdn.laget.se/11783254.jpg"
function getOriginalImageUrl(cdnUrl) {
  return cdnUrl.split(';')[0].split('?')[0];
}

// Extrahera filändelse från URL
function getExtension(url) {
  const match = url.match(/\.(\w{3,4})(?:[;?]|$)/);
  return match ? match[1].toLowerCase() : 'jpg';
}

// Ladda ner bild via https
function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Följ redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImage(res.headers.location, filepath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        writeFileSync(filepath, Buffer.concat(chunks));
        resolve();
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function scrapeNews() {
  console.log('📰 Scrapar nyheter från Laget.se (Backatorp IF)...');
  console.log(`   Hämtar nyheter från idag till ${CUTOFF_DATE.toISOString().slice(0, 10)}`);

  const headless = !process.argv.includes('--headed');
  const { browser, page } = await createBrowser({ headless });
  const rateLimit = createRateLimiter(1000);

  // Skapa bildmapp
  mkdirSync(IMAGE_DIR, { recursive: true });

  try {
    // Steg 1: Samla artikellänkar från nyhetslistan
    await page.goto(SITE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const articleLinks = new Map();
    let reachedCutoff = false;
    let iteration = 0;

    while (!reachedCutoff && iteration < 100) {
      iteration++;

      const items = await page.evaluate(() => {
        const results = [];
        const allLinks = document.querySelectorAll('a[href*="/News/"]');

        for (const link of allLinks) {
          const href = link.getAttribute('href') || '';
          if (!/\/News\/\d+\//.test(href)) continue;

          const h4 = link.querySelector('h4');
          if (!h4) continue;

          const title = h4.textContent.trim();
          const fullText = link.textContent.replace(title, '').replace(/\s+/g, ' ').trim();

          results.push({ url: href, title, metaText: fullText });
        }
        return results;
      });

      let newCount = 0;
      for (const item of items) {
        if (!articleLinks.has(item.url)) {
          articleLinks.set(item.url, item);
          newCount++;

          const date = parseSwedishDate(item.metaText);
          if (date && date < CUTOFF_DATE) {
            console.log(`   📅 Nådde cutoff vid: "${item.title}"`);
            reachedCutoff = true;
          }
        }
      }

      console.log(`   Sida ${iteration}: +${newCount} → totalt ${articleLinks.size}`);

      if (reachedCutoff || newCount === 0) break;

      const showMore = page.locator('a:has-text("Visa fler nyheter")');
      if (await showMore.count() > 0) {
        await showMore.click();
        await sleep(2000);
      } else {
        console.log('   Inga fler att ladda.');
        break;
      }
    }

    console.log(`\n📋 ${articleLinks.size} artiklar hittade. Hämtar detaljer + bilder...\n`);

    // Steg 2: Besök varje artikel, extrahera data och ladda ner bild
    const articles = [];
    let skippedCount = 0;
    let imageCount = 0;

    for (const [url, info] of articleLinks) {
      await rateLimit();
      const articleUrl = url.startsWith('http') ? url : `${SITE_URL}${url}`;

      // Extrahera nyhets-ID från URL: /News/7951842/...
      const newsIdMatch = url.match(/\/News\/(\d+)\//);
      const newsId = newsIdMatch ? newsIdMatch[1] : null;

      try {
        await page.goto(articleUrl, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(1000);

        const data = await page.evaluate(() => {
          // Rubrik
          const h3 = document.querySelector('h3');
          const title = h3?.textContent?.trim() || '';

          // Datum – från span.meta__item.tooltip
          const dateSpan = document.querySelector('span.meta__item.tooltip');
          const dateStr = dateSpan?.textContent?.trim() || '';

          // Visningar – span.meta__item som innehåller "visningar"
          const metaItems = document.querySelectorAll('span.meta__item');
          let views = 0;
          let comments = 0;
          for (const item of metaItems) {
            const text = item.textContent.trim();
            const viewMatch = text.match(/([\d\s]+)\s*visning/i);
            if (viewMatch) views = Number(viewMatch[1].replace(/\s/g, ''));
            const commentMatch = text.match(/(\d+)\s*kommentar/i);
            if (commentMatch) comments = Number(commentMatch[1]);
          }

          // Kommentarer kan också finnas som text nära "kommentarer"
          if (comments === 0) {
            const allMeta = document.querySelectorAll('.hidden--mobile');
            for (const el of allMeta) {
              const m = el.textContent.match(/(\d+)\s*kommentar/i);
              if (m) { comments = Number(m[1]); break; }
            }
          }

          // Artikeltext – p.link-color--underline (syskon till h3)
          const bodyP = h3?.parentElement?.querySelector('p.link-color--underline');
          const bodyText = bodyP?.innerText?.trim() || '';

          // Författare
          const authorEl = document.querySelector('.author');
          const author = authorEl?.innerText?.trim() || '';

          // Bild – img.box__image--big (artikelns hero-bild)
          const heroImg = document.querySelector('img.box__image--big');
          const imageUrl = heroImg?.src || '';

          return { title, dateStr, views, comments, bodyText, author, imageUrl };
        });

        const date = parseSwedishDate(data.dateStr);

        if (date && date < CUTOFF_DATE) {
          skippedCount++;
          continue;
        }

        // Ladda ner bilden om den finns
        let bildFilename = null;
        if (data.imageUrl && newsId) {
          const originalUrl = getOriginalImageUrl(data.imageUrl);
          const ext = getExtension(data.imageUrl);
          bildFilename = `${newsId}.${ext}`;
          const filepath = join(IMAGE_DIR, bildFilename);

          try {
            await downloadImage(originalUrl, filepath);
            imageCount++;
          } catch (imgErr) {
            console.warn(`      ⚠️  Bild: ${imgErr.message}`);
            bildFilename = null;
          }
        }

        const article = {
          news_id: newsId,
          rubrik: data.title || info.title,
          datum: date ? formatDate(date) : '',
          kommentarer: data.comments,
          visningar: data.views,
          författare: data.author,
          url: articleUrl,
          bild: bildFilename ? `bilder/${bildFilename}` : null,
          bildUrl: data.imageUrl ? getOriginalImageUrl(data.imageUrl) : null,
          text: data.bodyText,
        };

        articles.push(article);
        const imgStatus = bildFilename ? '🖼️' : '  ';
        console.log(`   ✅ ${imgStatus} ${article.datum} – ${article.rubrik} (${article.visningar} visn.)`);

      } catch (err) {
        console.warn(`   ⚠️  ${articleUrl}: ${err.message}`);
      }
    }

    if (skippedCount > 0) {
      console.log(`   ⏭️  Hoppade över ${skippedCount} artiklar före ${CUTOFF_DATE.toISOString().slice(0, 10)}`);
    }

    articles.sort((a, b) => b.datum.localeCompare(a.datum));

    console.log(`\n📰 Klart! ${articles.length} nyheter, ${imageCount} bilder.`);
    saveJson(category, 'nyheter', articles);

    return articles;

  } finally {
    await browser.close();
  }
}

scrapeNews().catch(console.error);
