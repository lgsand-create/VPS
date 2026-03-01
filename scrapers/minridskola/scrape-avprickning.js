/**
 * MinRidskola Avprickning Scraper
 * Scrapar veckoöversikt: alla dagar, alla lektioner, deltagare + hästar
 * OBS: BARA LÄSNING – ÄNDRAR INGET
 * Kör: node scrapers/minridskola/scrape-avprickning.js
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';
import { createStealthContext, randomDelay } from '../helpers/stealth.js';
dotenv.config();

const BASE_URL = process.env.MRS_BASE_URL || 'https://www.minridskola.se';
const LICNR = process.env.MRS_LICNR || '7678-5850-0915';
const SCREENSHOT_DIR = join(import.meta.dirname, '../../data/minridskola/screenshots/avprickning');
const DATA_DIR = join(import.meta.dirname, '../../data/minridskola');

mkdirSync(SCREENSHOT_DIR, { recursive: true });

let screenshotCounter = 0;

async function screenshot(page, name) {
  screenshotCounter++;
  const num = String(screenshotCounter).padStart(2, '0');
  const path = join(SCREENSHOT_DIR, `${num}_${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`    [screenshot] ${num}_${name}.png`);
  return path;
}

/**
 * Väntar tills "Läser..."-overlay försvinner
 */
async function waitForOverlay(page) {
  try {
    await page.waitForFunction(() => {
      const dialog = document.getElementById('dialogWait');
      return !dialog || dialog.style.display === 'none';
    }, { timeout: 15000 });
  } catch {
    // Timeout = overlay stack, fortsätt ändå
    console.log('    [varning] Overlay-timeout, fortsätter...');
  }
  await page.waitForLoadState('networkidle');
}

/**
 * 5-stegs ASP.NET login
 */
async function login(page) {
  console.log('\n== LOGGAR IN SOM ADMIN ==');

  // Steg 1: Sätt licensnummer
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

  // Steg 2-3: Fyll i login
  await page.goto(`${BASE_URL}/Init_LoggaIn.aspx`);
  await page.waitForLoadState('networkidle');
  await page.locator('[name="ctl00$ContentPlaceHolder1$txbUserName"]').fill(process.env.MRS_ADMIN_USERNAME);
  await page.locator('[name="ctl00$ContentPlaceHolder1$txbUserPasswd"]').fill(process.env.MRS_ADMIN_PASSWORD);
  await page.locator('[name="ctl00$ContentPlaceHolder1$butSubmit"]').click();
  await page.waitForLoadState('networkidle');

  // Steg 4: Main_Init
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

  // Steg 5: Gå till avprickning
  await page.goto(`${BASE_URL}/Xenophon/Avprickning/Avprick00_LektLista.aspx`);
  await page.waitForLoadState('networkidle');
  await waitForOverlay(page);

  const content = await page.content();
  const ok = content.includes('Logga ut') || content.includes('Avprickning');
  console.log(ok ? '  INLOGGAD!' : '  LOGIN MISSLYCKADES');
  return ok;
}

/**
 * Hämta lektionslista från aktuell dag
 */
async function extractLessons(page) {
  return page.evaluate(() => {
    const lessons = [];
    // Lektionsrader har onclick="GoToLektion('XXX')"
    document.querySelectorAll('tr[onclick*="GoToLektion"]').forEach(row => {
      const onclick = row.getAttribute('onclick') || '';
      const match = onclick.match(/GoToLektion\('([^']+)'\)/);
      const lnummer = match ? match[1] : '';

      const cells = Array.from(row.querySelectorAll('td'));
      // Tabellformat: Kursnamn | Tid | Plats | Ridlärare | Info
      // eller mobilformat: Kursnamn | Starttid | Ridlärare
      if (cells.length >= 3) {
        lessons.push({
          lnummer,
          kursnamn: cells[0]?.innerText?.trim() || '',
          tid: cells[1]?.innerText?.trim() || '',
          plats: cells[2]?.innerText?.trim() || '',
          ridlarare: cells[3]?.innerText?.trim() || '',
          info: cells[4]?.innerText?.trim() || '',
        });
      }
    });

    // Deduplicera (sidan har desktop + mobil-tabell)
    const seen = new Set();
    return lessons.filter(l => {
      if (seen.has(l.lnummer)) return false;
      seen.add(l.lnummer);
      return true;
    });
  });
}

/**
 * Hämta detaljinfo för en lektion (deltagare + hästar)
 */
async function extractLessonDetail(page, lnummer) {
  const url = `${BASE_URL}/Xenophon/Avprickning/Avprick10_LasaLektion.aspx?LNummer=${lnummer}`;
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await waitForOverlay(page);

  return page.evaluate(() => {
    const result = {
      header: '',
      datum: '',
      tid: '',
      kursnamn: '',
      plats: '',
      deltagare: [],
    };

    // Headerinfo - t.ex. "Söndagen den 8 februari 2026"
    const tables = document.querySelectorAll('table');
    if (tables.length > 0) {
      const firstRow = tables[0]?.querySelector('td');
      if (firstRow) result.datum = firstRow.innerText?.trim() || '';
    }

    // Lektionsinfo - t.ex. "14:30-15:30 - Nybörjare + - Stora stallet"
    const allText = document.body?.innerText || '';
    const lektMatch = allText.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*-\s*(.+?)(?:\n|$)/);
    if (lektMatch) {
      result.tid = `${lektMatch[1]}-${lektMatch[2]}`;
      const rest = lektMatch[3].split(' - ');
      result.kursnamn = rest[0]?.trim() || '';
      result.plats = rest[1]?.trim() || '';
    }

    // Deltagardata - hitta tabellen med Ryttare/Häst
    for (const table of tables) {
      const headerRow = table.querySelector('tr');
      const headerText = headerRow?.innerText || '';
      if (headerText.includes('Ryttare') || headerText.includes('Häst')) {
        const rows = table.querySelectorAll('tr');
        for (let i = 1; i < rows.length; i++) {
          const cells = Array.from(rows[i].querySelectorAll('td'));
          if (cells.length >= 2) {
            const ryttareText = cells[0]?.innerText?.trim() || '';
            const hastText = cells[1]?.innerText?.trim() || '';

            // Parsa ut ID-nummer: "(1647) Alva Lundberg"
            const idMatch = ryttareText.match(/\((\d+)\)\s*(.*)/);
            result.deltagare.push({
              id: idMatch ? idMatch[1] : '',
              namn: idMatch ? idMatch[2].trim() : ryttareText,
              hast: hastText,
              avbokad: hastText === 'AVBOKAD' || hastText === 'LÅST AVBOKNING',
            });
          }
        }
        break; // Hittade rätt tabell
      }
    }

    // Sök efter "Stäng"-knapp (bekräftar att det är en detaljsida)
    result.header = allText.includes('Stäng') ? 'detail-page' : 'unknown';

    return result;
  });
}

/**
 * Klicka på en dagknapp (Måndag=1 ... Söndag=7) via ASP.NET postback
 */
async function clickDay(page, dayNum) {
  const buttonId = `ContentPlaceHolder1_butVdag${dayNum}`;
  const button = page.locator(`#${buttonId}`);

  if (await button.count() === 0) {
    console.log(`    Knapp ${buttonId} hittades inte`);
    return false;
  }

  await button.click();
  await waitForOverlay(page);
  await randomDelay(1000, 0.5); // Randomiserad väntetid
  return true;
}

// === DAGNAMN ===
const DAGNAMN = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];

// === MAIN ===

// Slumpmässig startfördröjning (0-90s) så att trafiken inte alltid börjar exakt på :00/:15/:30/:45
const startDelaySec = Math.floor(Math.random() * 90);
console.log(`  [stealth] Väntar ${startDelaySec}s före start...`);
await randomDelay(startDelaySec * 1000, 0.1);

console.log('==========================================');
console.log('  MinRidskola Avprickning Scraper');
console.log('  OBS: BARA LÄSNING – ÄNDRAR INGET');
console.log('==========================================');

const browser = await chromium.launch({ headless: true });
const context = await createStealthContext(browser, {
  viewport: { width: 1400, height: 900 },
});
const page = await context.newPage();

try {
  if (!await login(page)) {
    throw new Error('Kunde inte logga in');
  }

  await screenshot(page, 'start');

  // Samla data för hela veckan
  const weekData = {
    scraped: new Date().toISOString(),
    vecka: '',
    dagar: [],
  };

  // Läs veckonummer
  const veckoText = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    for (const inp of inputs) {
      if (inp.value?.includes('Vecka')) return inp.value;
    }
    return '';
  });
  weekData.vecka = veckoText || 'okänd';
  console.log(`\n  Vecka: ${weekData.vecka}`);

  // Gå igenom alla 7 dagar
  for (let day = 1; day <= 7; day++) {
    const dagnamn = DAGNAMN[day - 1];
    console.log(`\n== ${dagnamn.toUpperCase()} (dag ${day}/7) ==`);

    // Gå till avprickning-sidan (start om)
    await page.goto(`${BASE_URL}/Xenophon/Avprickning/Avprick00_LektLista.aspx`);
    await page.waitForLoadState('networkidle');
    await waitForOverlay(page);

    // Klicka på rätt dag
    const clicked = await clickDay(page, day);
    if (!clicked) {
      console.log(`  Hoppar över ${dagnamn}`);
      continue;
    }

    await screenshot(page, dagnamn.toLowerCase());

    // Hämta lektioner
    const lessons = await extractLessons(page);
    console.log(`  Hittade ${lessons.length} lektioner`);

    const dagData = {
      dag: dagnamn,
      dagNummer: day,
      lektioner: [],
    };

    // Klicka in i varje lektion
    for (const lesson of lessons) {
      console.log(`  → ${lesson.kursnamn} (${lesson.tid}) [${lesson.lnummer}]`);

      const detail = await extractLessonDetail(page, lesson.lnummer);

      dagData.lektioner.push({
        lnummer: lesson.lnummer,
        kursnamn: lesson.kursnamn || detail.kursnamn,
        tid: lesson.tid || detail.tid,
        plats: lesson.plats || detail.plats,
        ridlarare: lesson.ridlarare,
        info: lesson.info,
        datum: detail.datum,
        deltagare: detail.deltagare,
      });

      const aktiva = detail.deltagare.filter(d => !d.avbokad).length;
      const avbokade = detail.deltagare.filter(d => d.avbokad).length;
      console.log(`    ${detail.deltagare.length} deltagare (${aktiva} aktiva, ${avbokade} avbokade)`);

      // Visa deltagarlista
      detail.deltagare.forEach(d => {
        const status = d.avbokad ? ' [AVBOKAD]' : '';
        console.log(`      ${d.namn} → ${d.hast}${status}`);
      });
    }

    weekData.dagar.push(dagData);
  }

  // Spara all data
  const filename = `avprickning_${new Date().toISOString().slice(0, 10)}.json`;
  const filepath = join(DATA_DIR, filename);
  writeFileSync(filepath, JSON.stringify(weekData, null, 2), 'utf-8');
  console.log(`\n  Sparade: ${filepath}`);

  // Skriv sammanfattning
  console.log('\n==========================================');
  console.log('  SAMMANFATTNING');
  console.log('==========================================');
  console.log(`  Vecka: ${weekData.vecka}`);
  let totalLektioner = 0;
  let totalDeltagare = 0;
  let unikaHastar = new Set();
  let unikaRyttare = new Set();

  for (const dag of weekData.dagar) {
    console.log(`  ${dag.dag}: ${dag.lektioner.length} lektioner`);
    for (const lek of dag.lektioner) {
      totalLektioner++;
      for (const d of lek.deltagare) {
        totalDeltagare++;
        if (d.hast && !d.avbokad) unikaHastar.add(d.hast);
        if (d.namn) unikaRyttare.add(d.namn);
      }
    }
  }

  console.log(`\n  Totalt: ${totalLektioner} lektioner, ${totalDeltagare} deltagarplatser`);
  console.log(`  Unika ryttare: ${unikaRyttare.size}`);
  console.log(`  Unika hästar: ${unikaHastar.size}`);

  await screenshot(page, 'klar');

  console.log('\n==========================================');
  console.log('  KLART!');
  console.log(`  Data: ${filepath}`);
  console.log(`  Screenshots: ${SCREENSHOT_DIR}`);
  console.log('==========================================');

} catch (e) {
  console.error('\nFEL:', e.message);
  console.error(e.stack?.split('\n').slice(0, 5).join('\n'));
} finally {
  await browser.close();
}
