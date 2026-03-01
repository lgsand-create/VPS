/**
 * MinRidskola Hästindex — Scrapar alla hästar med alla flikar.
 *
 * Navigerar till hästlistan, samlar alla hästar, och för varje häst:
 *   1. Data (grundinfo)
 *   2. Foder (fodertyp × 5 fodringstillfällen/dag)
 *   3. Journaler (vaccinationer, avmaskningar, dagbok)
 *   4. Sjukskrivningar
 *   5. Skoningar
 *
 * OBS: BARA LÄSNING – ÄNDRAR INGET PÅ SIDAN.
 *
 * Kör: node scrapers/minridskola/scrape-hastar.js
 * Output: data/minridskola/hastar_{datum}.json
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';
import { createStealthContext, randomDelay } from '../helpers/stealth.js';
dotenv.config();

const BASE_URL = process.env.MRS_BASE_URL || 'https://www.minridskola.se';
const LICNR = process.env.MRS_LICNR || '7678-5850-0915';
const DATA_DIR = join(import.meta.dirname, '../../data/minridskola');
mkdirSync(DATA_DIR, { recursive: true });

// --- Helpers ---

async function waitForOverlay(page) {
  try {
    await page.waitForFunction(() => {
      const d = document.getElementById('dialogWait');
      return !d || d.style.display === 'none';
    }, { timeout: 15000 });
  } catch {}
  await page.waitForLoadState('networkidle');
}

async function login(page) {
  await page.goto(`${BASE_URL}/Default2.aspx?LicNr=&Target=`);
  await page.evaluate((licnr) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/Default2.aspx?LicNr=&Target=';
    ['SavedLicNr', 'SavedUserPersNr', 'SavedUserPasswd'].forEach((name, i) => {
      const inp = document.createElement('input');
      inp.name = name;
      inp.value = i === 0 ? licnr : '';
      form.appendChild(inp);
    });
    document.body.appendChild(form);
    form.submit();
  }, LICNR);
  await page.waitForLoadState('networkidle');

  await page.goto(`${BASE_URL}/Init_LoggaIn.aspx`);
  await page.waitForLoadState('networkidle');
  await page.locator('[name="ctl00$ContentPlaceHolder1$txbUserName"]').fill(process.env.MRS_ADMIN_USERNAME);
  await page.locator('[name="ctl00$ContentPlaceHolder1$txbUserPasswd"]').fill(process.env.MRS_ADMIN_PASSWORD);
  await page.locator('[name="ctl00$ContentPlaceHolder1$butSubmit"]').click();
  await page.waitForLoadState('networkidle');

  await page.evaluate((licnr) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/XenoWebb/Main_Init.aspx';
    const input = document.createElement('input');
    input.name = 'LicNr';
    input.value = licnr;
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
  }, LICNR);
  await page.waitForLoadState('load');
  await randomDelay(3000, 0.4);
  await page.waitForLoadState('networkidle');
}

/**
 * Hämta alla hästar från listan (alla kategorier: Hästar + Ponnyer)
 */
async function getHorseList(page) {
  await page.goto(`${BASE_URL}/Xenophon/Hastar/Hast00_HastLista.aspx`);
  await page.waitForLoadState('networkidle');
  await waitForOverlay(page);

  return page.evaluate(() => {
    const horses = [];
    const table = document.querySelector('table.w3-table');
    if (!table) return horses;

    table.querySelectorAll('tr').forEach(tr => {
      // Hitta GoToHast-anrop
      const clickable = tr.querySelector('[onclick*="GoToHast"]');
      if (!clickable) return;
      const m = clickable.getAttribute('onclick').match(/GoToHast\('(\d+)'\)/);
      if (!m) return;

      const cells = Array.from(tr.querySelectorAll('td'));
      const nameCell = cells[1]?.innerText?.trim() || '';
      const nameMatch = nameCell.match(/\((\d+)\)\s*(.*)/);

      horses.push({
        hnummer: m[1],
        namn: nameMatch ? nameMatch[2].trim() : nameCell,
        typ: cells[2]?.innerText?.trim() || '',
        info: cells[3]?.innerText?.trim() || '',
      });
    });

    return horses;
  });
}

/**
 * Scrapa Data-fliken (grundinfo)
 */
async function scrapeData(page, hnummer) {
  await page.goto(`${BASE_URL}/Xenophon/Hastar/Hast10_VisaHast.aspx?HNummer=${hnummer}`);
  await page.waitForLoadState('networkidle');
  await waitForOverlay(page);

  return page.evaluate(() => {
    const val = id => document.getElementById(`ContentPlaceHolder1_${id}`)?.value || '';
    const checked = id => document.getElementById(`ContentPlaceHolder1_${id}`)?.checked || false;
    const radio = name => {
      const el = document.querySelector(`input[name="ctl00$ContentPlaceHolder1$${name}"]:checked`);
      return el?.value || '';
    };
    const select = id => {
      const sel = document.getElementById(`ContentPlaceHolder1_${id}`);
      return sel?.options[sel.selectedIndex]?.text || '';
    };

    return {
      hnummer: val('txbHNummer'),
      namn: val('txbNamn'),
      typ: radio('rbListTyp'),
      kon: radio('rbListKon'),
      fodelsear: val('txbFodelsear'),
      ras: val('txbRas'),
      mankhojd: val('txbMankhojd'),
      ponnykategori: select('cmbKategorier'),
      farg: val('txbFarg'),
      tecken: val('txbTecken'),
      harstamning: val('txbHarstamning'),
      uppfodare: val('txbUppfodare'),
      agare: val('txbAgare'),
      bortrest: checked('cbBortrest'),
      privathast: checked('cbPrivatHast'),
      lektionshast: checked('cbLektionsHast'),
      stall: val('txbStall'),
      stallplatsNr: val('txbStallplatsNr'),
      inkopsdatum: val('txbInkopsDatum'),
      avfordDatum: val('txbAvfordDatum'),
    };
  });
}

/**
 * Scrapa Foder-fliken (8 rader × 5 fodringstillfällen)
 */
async function scrapeFoder(page, hnummer) {
  // Navigera direkt till foder-sidan (knappklick triggar sidnavigering)
  await page.goto(`${BASE_URL}/Xenophon/Hastar/Hast12_VisaFoder.aspx`);
  await page.waitForLoadState('networkidle');
  await waitForOverlay(page);

  return page.evaluate(() => {
    const rows = [];
    for (let r = 1; r <= 8; r++) {
      const select = document.getElementById(`ContentPlaceHolder1_cmbFodersort${r}`);
      const fodersort = select?.options[select.selectedIndex]?.text || '';
      if (fodersort === '-- Inget --' || !fodersort) continue;

      const fodringar = [];
      for (let k = 1; k <= 5; k++) {
        fodringar.push(document.getElementById(`ContentPlaceHolder1_txbRad${r}Kol${k}`)?.value || '');
      }
      rows.push({ radNr: r, fodersort, fodringar });
    }
    return rows;
  });
}

/**
 * Scrapa Journaler-fliken (vaccination, avmaskning, dagbok)
 */
async function scrapeJournaler(page) {
  await page.goto(`${BASE_URL}/Xenophon/Hastar/Hast14_VisaJournaler.aspx`);
  await page.waitForLoadState('networkidle');
  await waitForOverlay(page);

  return page.evaluate(() => {
    const journals = [];
    // Desktop-tabell (den med 4 kolumner: Typ, Datum, Till datum, Beskrivning)
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const header = table.querySelector('tr');
      if (!header?.innerText?.includes('Typ')) continue;
      if (!header?.innerText?.includes('Datum')) continue;

      const rows = table.querySelectorAll('tr');
      for (let i = 1; i < rows.length; i++) {
        const cells = Array.from(rows[i].querySelectorAll('td'));
        if (cells.length < 3) continue;

        const typ = cells[0]?.innerText?.trim() || '';
        const datum = cells[1]?.innerText?.trim() || '';
        // Om 4 kolumner: Till datum finns
        const tillDatum = cells.length >= 4 ? cells[2]?.innerText?.trim() || '' : '';
        const beskrivning = cells.length >= 4
          ? cells[3]?.innerText?.trim() || ''
          : cells[2]?.innerText?.trim() || '';

        if (typ && datum) {
          journals.push({ typ, datum, tillDatum, beskrivning });
        }
      }
      break; // Bara första matchande tabellen
    }
    return journals;
  });
}

/**
 * Scrapa Sjukskrivningar-fliken
 */
async function scrapeSjukskrivningar(page) {
  await page.goto(`${BASE_URL}/Xenophon/Hastar/Hast16_VisaSjukskrivningar.aspx`);
  await page.waitForLoadState('networkidle');
  await waitForOverlay(page);

  return page.evaluate(() => {
    const entries = [];
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const header = table.querySelector('tr');
      if (!header?.innerText?.includes('Datum')) continue;
      if (!header?.innerText?.includes('Orsak')) continue;

      const rows = table.querySelectorAll('tr');
      for (let i = 1; i < rows.length; i++) {
        const cells = Array.from(rows[i].querySelectorAll('td'));
        if (cells.length < 2) continue;

        const datumText = cells[0]?.innerText?.trim() || '';
        const orsak = cells[1]?.innerText?.trim() || '';

        // Datum kan vara "2019-03-29 - 2019-04-25" eller bara "2019-03-29"
        const datumMatch = datumText.match(/(\d{4}-\d{2}-\d{2})\s*(?:-\s*(\d{4}-\d{2}-\d{2}))?/);
        if (datumMatch) {
          entries.push({
            datumFrom: datumMatch[1],
            datumTo: datumMatch[2] || '',
            orsak,
          });
        }
      }
      break;
    }
    return entries;
  });
}

/**
 * Scrapa Skoningar-fliken
 */
async function scrapeSkoningar(page) {
  await page.goto(`${BASE_URL}/Xenophon/Hastar/Hast18_VisaSkoningar.aspx`);
  await page.waitForLoadState('networkidle');
  await waitForOverlay(page);

  return page.evaluate(() => {
    const entries = [];
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const header = table.querySelector('tr');
      if (!header?.innerText?.includes('Datum')) continue;

      const rows = table.querySelectorAll('tr');
      for (let i = 1; i < rows.length; i++) {
        const cells = Array.from(rows[i].querySelectorAll('td'));
        if (cells.length < 1) continue;

        const datum = cells[0]?.innerText?.trim() || '';
        const notering = cells[1]?.innerText?.trim() || '';

        if (datum && /\d{4}-\d{2}-\d{2}/.test(datum)) {
          entries.push({ datum, notering });
        }
      }
      break;
    }
    return entries;
  });
}

// === MAIN ===

// Slumpmässig startfördröjning (0-30s)
const startDelaySec = Math.floor(Math.random() * 30);
console.log(`  [stealth] Väntar ${startDelaySec}s före start...`);
await randomDelay(startDelaySec * 1000, 0.1);

console.log('==========================================');
console.log('  MinRidskola Hästindex — Scraper');
console.log('  OBS: BARA LÄSNING');
console.log('==========================================\n');

const browser = await chromium.launch({ headless: true });
const context = await createStealthContext(browser, {
  viewport: { width: 1400, height: 900 },
});
const page = await context.newPage();

try {
  console.log('  Loggar in...');
  await login(page);
  console.log('  OK!\n');

  // Hämta hästlista
  console.log('== HÄMTAR HÄSTLISTA ==');
  const horseList = await getHorseList(page);
  console.log(`  ${horseList.length} hästar hittade\n`);

  const hastar = [];

  for (let i = 0; i < horseList.length; i++) {
    const h = horseList[i];
    console.log(`[${i + 1}/${horseList.length}] (${h.hnummer}) ${h.namn} — ${h.typ}`);

    try {
      // 1. Data-fliken
      const data = await scrapeData(page, h.hnummer);
      await randomDelay(800, 0.5);

      // 2. Foder-fliken
      const foder = await scrapeFoder(page, h.hnummer);
      await randomDelay(800, 0.5);

      // 3. Journaler
      const journaler = await scrapeJournaler(page);
      await randomDelay(800, 0.5);

      // 4. Sjukskrivningar
      const sjukskrivningar = await scrapeSjukskrivningar(page);
      await randomDelay(800, 0.5);

      // 5. Skoningar
      const skoningar = await scrapeSkoningar(page);
      await randomDelay(800, 0.5);

      hastar.push({
        ...data,
        foder,
        journaler,
        sjukskrivningar,
        skoningar,
      });

      const stats = [
        foder.length > 0 ? `${foder.length} foder` : '',
        journaler.length > 0 ? `${journaler.length} journal` : '',
        sjukskrivningar.length > 0 ? `${sjukskrivningar.length} sjukskr` : '',
        skoningar.length > 0 ? `${skoningar.length} skoningar` : '',
      ].filter(Boolean).join(', ');
      console.log(`  OK${stats ? ` (${stats})` : ''}`);

    } catch (err) {
      console.log(`  FEL: ${err.message}`);
      // Fortsätt med nästa häst
      hastar.push({
        hnummer: h.hnummer,
        namn: h.namn,
        typ: h.typ === 'Ridhäst' ? 'Ridhast' : h.typ,
        _error: err.message,
        foder: [],
        journaler: [],
        sjukskrivningar: [],
        skoningar: [],
      });
    }
  }

  // Bygg output
  const output = {
    meta: {
      scraped: new Date().toISOString(),
      antalHastar: hastar.length,
    },
    hastar,
  };

  const dateSuffix = new Date().toISOString().slice(0, 10);
  const filepath = join(DATA_DIR, `hastar_${dateSuffix}.json`);
  writeFileSync(filepath, JSON.stringify(output, null, 2), 'utf-8');

  // Sammanfattning
  console.log('\n==========================================');
  console.log('  RESULTAT');
  console.log('==========================================');
  console.log(`  Hästar:         ${hastar.length}`);
  console.log(`  Med foder:      ${hastar.filter(h => h.foder?.length > 0).length}`);
  console.log(`  Med journaler:  ${hastar.filter(h => h.journaler?.length > 0).length}`);
  console.log(`  Med sjukskr:    ${hastar.filter(h => h.sjukskrivningar?.length > 0).length}`);
  console.log(`  Med skoningar:  ${hastar.filter(h => h.skoningar?.length > 0).length}`);
  console.log(`  Fel:            ${hastar.filter(h => h._error).length}`);
  console.log(`\n  → ${filepath}`);
  console.log('==========================================');

} catch (e) {
  console.error('\nFEL:', e.message);
  console.error(e.stack?.split('\n').slice(0, 5).join('\n'));
} finally {
  await browser.close();
}
