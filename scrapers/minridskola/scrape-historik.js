/**
 * MinRidskola Historik-Scraper
 * Navigerar bakåt vecka för vecka per lektion för att bygga närvaroöversikt
 * OBS: BARA LÄSNING – ÄNDRAR INGET
 * Kör: node scrapers/minridskola/scrape-historik.js [antal_veckor]
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.MRS_BASE_URL || 'https://www.minridskola.se';
const LICNR = process.env.MRS_LICNR || '7678-5850-0915';
const DATA_DIR = join(import.meta.dirname, '../../data/minridskola');

mkdirSync(DATA_DIR, { recursive: true });

const WEEKS_BACK = parseInt(process.argv[2] || '4', 10);

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
    console.log('    [varning] Overlay-timeout, fortsätter...');
  }
  await page.waitForLoadState('networkidle');
}

/**
 * 5-stegs ASP.NET login
 */
async function login(page) {
  console.log('  Loggar in...');

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
  await page.waitForTimeout(3000);
  await page.waitForLoadState('networkidle');

  console.log('  Inloggad!');
  return true;
}

/**
 * Hämta alla lektioner från avprickningssidan (alla dagar)
 */
async function getAllLessons(page) {
  const DAGNAMN = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];
  const allLessons = [];

  for (let day = 1; day <= 7; day++) {
    await page.goto(`${BASE_URL}/Xenophon/Avprickning/Avprick00_LektLista.aspx`);
    await page.waitForLoadState('networkidle');
    await waitForOverlay(page);

    // Klicka på dagen
    const btn = page.locator(`#ContentPlaceHolder1_butVdag${day}`);
    if (await btn.count() > 0) {
      await btn.click();
      await waitForOverlay(page);
      await page.waitForTimeout(1000);
    }

    // Extrahera lektioner (deduplicera desktop/mobil-tabeller)
    const lessons = await page.evaluate((dagnamn) => {
      const seen = new Set();
      const result = [];
      document.querySelectorAll('tr[onclick*="GoToLektion"]').forEach(row => {
        const match = row.getAttribute('onclick')?.match(/GoToLektion\('([^']+)'\)/);
        const lnummer = match ? match[1] : '';
        if (!lnummer || seen.has(lnummer)) return;
        seen.add(lnummer);

        const cells = Array.from(row.querySelectorAll('td'));
        result.push({
          lnummer,
          kursnamn: cells[0]?.innerText?.trim() || '',
          tid: cells[1]?.innerText?.trim() || '',
          plats: cells.length >= 4 ? cells[2]?.innerText?.trim() || '' : '',
          ridlarare: cells.length >= 4 ? cells[3]?.innerText?.trim() || '' : cells[2]?.innerText?.trim() || '',
          dag: dagnamn,
        });
      });
      return result;
    }, DAGNAMN[day - 1]);

    allLessons.push(...lessons);
    if (lessons.length > 0) {
      console.log(`  ${DAGNAMN[day - 1]}: ${lessons.length} lektioner (${lessons.map(l => l.lnummer).join(', ')})`);
    }
  }

  return allLessons;
}

/**
 * Extrahera deltagardata från lektionsdetaljsidan
 */
async function extractDetail(page) {
  return page.evaluate(() => {
    const result = {
      vecka: '',
      datum: '',
      tid: '',
      kursnamn: '',
      plats: '',
      deltagare: [],
    };

    // Veckonummer från butVeckoNr2
    const veckoBtn = document.querySelector('#ContentPlaceHolder1_butVeckoNr2');
    result.vecka = veckoBtn?.value || '';

    // Datum från första tabellens första cell
    const firstTd = document.querySelector('table td');
    result.datum = firstTd?.innerText?.trim() || '';

    // Lektionsinfo
    const allText = document.body?.innerText || '';
    const lektMatch = allText.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*-\s*(.+?)(?:\n|$)/);
    if (lektMatch) {
      result.tid = `${lektMatch[1]}-${lektMatch[2]}`;
      const parts = lektMatch[3].split(' - ');
      result.kursnamn = parts[0]?.trim() || '';
      result.plats = parts[1]?.trim() || '';
    }

    // Deltagardata
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const headerText = table.querySelector('tr')?.innerText || '';
      if (!headerText.includes('Ryttare')) continue;

      const rows = table.querySelectorAll('tr');
      for (let i = 1; i < rows.length; i++) {
        const cells = Array.from(rows[i].querySelectorAll('td'));
        if (cells.length < 2) continue;

        const ryttareText = cells[0]?.innerText?.trim() || '';
        const hastText = cells[1]?.innerText?.trim() || '';
        const idMatch = ryttareText.match(/\((\d+)\)\s*(.*)/);

        // Kolla checkbox-status (avprickad = närvarande)
        const checkbox = rows[i].querySelector('input[type="checkbox"]');
        const checked = checkbox?.checked || false;

        result.deltagare.push({
          id: idMatch ? idMatch[1] : '',
          namn: idMatch ? idMatch[2].trim() : ryttareText,
          hast: hastText,
          avbokad: hastText === 'AVBOKAD' || hastText === 'LÅST AVBOKNING',
          narvaro: checked,
        });
      }
      break;
    }

    return result;
  });
}

/**
 * Navigera bakåt en vecka inne i lektionsdetaljvyn
 */
async function goBackOneWeek(page) {
  const backBtn = page.locator('#ContentPlaceHolder1_butVeckoNr1');
  if (await backBtn.count() === 0) return false;

  await backBtn.click();
  await waitForOverlay(page);
  await page.waitForTimeout(1500);
  return true;
}

// === MAIN ===

console.log('==========================================');
console.log('  MinRidskola Historik-Scraper');
console.log(`  Antal veckor bakåt: ${WEEKS_BACK}`);
console.log('  OBS: BARA LÄSNING – ÄNDRAR INGET');
console.log('==========================================');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
});
const page = await context.newPage();

try {
  await login(page);

  // Steg 1: Hämta alla lektioner från nuvarande vecka
  console.log('\n== HÄMTAR LEKTIONSLISTA ==');
  const allLessons = await getAllLessons(page);
  console.log(`\n  Totalt: ${allLessons.length} lektioner att scrapa`);

  // Steg 2: För varje lektion, navigera bakåt vecka för vecka
  const historik = [];

  for (const lesson of allLessons) {
    console.log(`\n== ${lesson.kursnamn} (${lesson.dag} ${lesson.tid}) [${lesson.lnummer}] ==`);

    // Gå till lektionen
    await page.goto(`${BASE_URL}/Xenophon/Avprickning/Avprick10_LasaLektion.aspx?LNummer=${lesson.lnummer}`);
    await page.waitForLoadState('networkidle');
    await waitForOverlay(page);

    // Samla nuvarande vecka + navigera bakåt
    for (let w = 0; w <= WEEKS_BACK; w++) {
      if (w > 0) {
        const ok = await goBackOneWeek(page);
        if (!ok) {
          console.log(`    Kunde inte gå längre bakåt`);
          break;
        }
      }

      const detail = await extractDetail(page);

      // Hoppa över om inga deltagare (kursen kanske inte existerade den veckan)
      if (detail.deltagare.length === 0 && w > 0) {
        console.log(`    ${detail.vecka}: (inga deltagare - hoppar över)`);
        continue;
      }

      const aktiva = detail.deltagare.filter(d => !d.avbokad);
      const avbokade = detail.deltagare.filter(d => d.avbokad);
      const narvarande = detail.deltagare.filter(d => d.narvaro);

      console.log(`    ${detail.vecka} | ${detail.datum}`);
      console.log(`      ${aktiva.length} aktiva, ${avbokade.length} avbokade, ${narvarande.length} avprickade`);

      historik.push({
        lnummer: lesson.lnummer,
        kursnamn: lesson.kursnamn || detail.kursnamn,
        dag: lesson.dag,
        tid: lesson.tid || detail.tid,
        plats: lesson.plats || detail.plats,
        ridlarare: lesson.ridlarare,
        vecka: detail.vecka,
        datum: detail.datum,
        deltagare: detail.deltagare,
      });
    }
  }

  // Spara
  const filename = `historik_${WEEKS_BACK}v_${new Date().toISOString().slice(0, 10)}.json`;
  const filepath = join(DATA_DIR, filename);
  writeFileSync(filepath, JSON.stringify(historik, null, 2), 'utf-8');
  console.log(`\n  Sparade ${historik.length} lektions-tillfällen → ${filepath}`);

  // Sammanfattning
  console.log('\n==========================================');
  console.log('  SAMMANFATTNING');
  console.log('==========================================');

  const veckor = new Set(historik.map(h => h.vecka));
  const kurser = new Set(historik.map(h => h.kursnamn));
  const hastar = new Set();
  const ryttare = new Set();
  let totalNarvarande = 0;
  let totalPlatser = 0;

  for (const h of historik) {
    for (const d of h.deltagare) {
      if (d.namn) ryttare.add(d.namn);
      if (d.hast && !d.avbokad) hastar.add(d.hast);
      if (!d.avbokad) totalPlatser++;
      if (d.narvaro) totalNarvarande++;
    }
  }

  console.log(`  Veckor: ${veckor.size} (${Array.from(veckor).sort().join(', ')})`);
  console.log(`  Kurser: ${kurser.size}`);
  console.log(`  Unika ryttare: ${ryttare.size}`);
  console.log(`  Unika hästar: ${hastar.size}`);
  console.log(`  Tillfällen: ${historik.length}`);
  console.log(`  Deltagarplatser (aktiva): ${totalPlatser}`);
  console.log(`  Avprickade (närvarade): ${totalNarvarande}`);
  if (totalPlatser > 0) {
    console.log(`  Närvarograd: ${Math.round(totalNarvarande / totalPlatser * 100)}%`);
  }

  console.log(`\n  Data: ${filepath}`);
  console.log('==========================================');

} catch (e) {
  console.error('\nFEL:', e.message);
  console.error(e.stack?.split('\n').slice(0, 5).join('\n'));
} finally {
  await browser.close();
}
