/**
 * MinRidskola Avprickning Scraper
 *
 * Scrapar närvarodata från avprickningssidan.
 * OBS: BARA LÄSNING – ÄNDRAR INGET PÅ SIDAN.
 *
 * Lägen:
 *   node scrape.js              → Nuvarande vecka (snabb, ~1 min)
 *   node scrape.js --year       → Innevarande år (alla veckor bakåt till v1)
 *   node scrape.js --year 2025  → Specifikt år (bara det årets veckor)
 *   node scrape.js --weeks 8    → 8 veckor bakåt
 *
 * Output: data/minridskola/narvaro_{datum}.json
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

// --- Argument-parsning ---
const args = process.argv.slice(2);
const yearIdx = args.indexOf('--year');
const yearMode = yearIdx >= 0;
const TARGET_YEAR = yearMode
  ? (args[yearIdx + 1] && !args[yearIdx + 1].startsWith('-') ? parseInt(args[yearIdx + 1]) : new Date().getFullYear())
  : null;
const weeksIdx = args.indexOf('--weeks');
const WEEKS_BACK = yearMode ? 60 : (weeksIdx >= 0 ? parseInt(args[weeksIdx + 1], 10) : 0);
const CURRENT_YEAR = new Date().getFullYear();
const DAGNAMN = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];
const DAG_OFFSET = { 'Måndag': 1, 'Tisdag': 2, 'Onsdag': 3, 'Torsdag': 4, 'Fredag': 5, 'Lördag': 6, 'Söndag': 7 };

/**
 * Beräkna faktiskt datum från "Vecka 2026-06" + "Måndag"
 * ISO 8601: vecka börjar på måndag (1) och slutar söndag (7)
 */
function computeDate(veckaText, dagnamn) {
  const m = veckaText.match(/(\d{4})-(\d{1,2})/);
  if (!m) return '';
  const year = parseInt(m[1]);
  const week = parseInt(m[2]);
  const dayOfWeek = DAG_OFFSET[dagnamn] || 1;

  // ISO 8601: Vecka 1 innehåller 4 januari
  // Hitta måndag i vecka 1
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7; // Söndag=7
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setDate(jan4.getDate() - jan4Day + 1);

  // Beräkna datum
  const date = new Date(mondayWeek1);
  date.setDate(mondayWeek1.getDate() + (week - 1) * 7 + (dayOfWeek - 1));

  // Formatera lokalt (toISOString() ger UTC som kan shifta en dag)
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// --- Helpers ---

async function waitForOverlay(page) {
  try {
    await page.waitForFunction(() => {
      const d = document.getElementById('dialogWait');
      return !d || d.style.display === 'none';
    }, { timeout: 15000 });
  } catch { /* timeout = fortsätt */ }
  await page.waitForLoadState('networkidle');
}

async function login(page) {
  // Steg 1: Licensnummer
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

  // Steg 2-3: Login-formulär
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
  return true;
}

/**
 * Hämtar veckonummer-texten från lektionsdetaljvyn, t.ex. "Vecka 2026-06"
 */
async function getCurrentWeek(page) {
  return page.evaluate(() => {
    return document.querySelector('#ContentPlaceHolder1_butVeckoNr2')?.value || '';
  });
}

/**
 * Parsa "Vecka 2026-06" → { year: 2026, week: 6 }
 */
function parseWeek(text) {
  const m = text.match(/(\d{4})-(\d{1,2})/);
  return m ? { year: parseInt(m[1]), week: parseInt(m[2]) } : null;
}

/**
 * Klicka < (bakåt en vecka) inne i lektionsdetaljvyn
 */
async function goBackOneWeek(page) {
  const btn = page.locator('#ContentPlaceHolder1_butVeckoNr1');
  if (await btn.count() === 0) return false;
  await btn.click();
  await waitForOverlay(page);
  await randomDelay(1000, 0.5);
  return true;
}

/**
 * Klicka > (framåt en vecka) inne i lektionsdetaljvyn
 */
async function goForwardOneWeek(page) {
  const btn = page.locator('#ContentPlaceHolder1_butVeckoNr3');
  if (await btn.count() === 0) return false;
  await btn.click();
  await waitForOverlay(page);
  await randomDelay(1000, 0.5);
  return true;
}

/**
 * Navigera till en specifik lektion och återställ till nuvarande vecka.
 * Gå via avprickningslistan först för att reseta veckostaten i sessionen.
 */
async function gotoLessonCurrentWeek(page, lnummer, currentWeekText, dayNum) {
  // Reseta veckostate genom att gå till listan och klicka på rätt dag
  await page.goto(`${BASE_URL}/Xenophon/Avprickning/Avprick00_LektLista.aspx`);
  await page.waitForLoadState('networkidle');
  await waitForOverlay(page);

  if (dayNum) {
    const dayBtn = page.locator(`#ContentPlaceHolder1_butVdag${dayNum}`);
    if (await dayBtn.count() > 0) {
      await dayBtn.click();
      await waitForOverlay(page);
      await randomDelay(500, 0.5);
    }
  }

  // Nu navigera till lektionen - sessionen bör vara på nuvarande vecka
  await page.goto(`${BASE_URL}/Xenophon/Avprickning/Avprick10_LasaLektion.aspx?LNummer=${lnummer}`);
  await page.waitForLoadState('networkidle');
  await waitForOverlay(page);

  let weekText = await getCurrentWeek(page);

  // Dubbelkolla - klicka framåt om det behövs (max 5 klick)
  let attempts = 0;
  while (weekText !== currentWeekText && attempts < 5) {
    const ok = await goForwardOneWeek(page);
    if (!ok) break;
    const newWeek = await getCurrentWeek(page);
    if (newWeek === weekText) break;
    weekText = newWeek;
    attempts++;
  }

  return weekText;
}

/**
 * Extrahera deltagardata från lektionsdetaljsidan
 */
async function extractDetail(page) {
  return page.evaluate(() => {
    const result = { vecka: '', datum: '', deltagare: [] };

    // Veckonummer
    result.vecka = document.querySelector('#ContentPlaceHolder1_butVeckoNr2')?.value || '';

    // Datum
    const firstTd = document.querySelector('table td');
    result.datum = firstTd?.innerText?.trim() || '';

    // Lektionsinfo
    const allText = document.body?.innerText || '';
    const m = allText.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*-\s*(.+?)(?:\n|$)/);
    if (m) {
      result.tid = `${m[1]}-${m[2]}`;
      const parts = m[3].split(' - ');
      result.kursnamn = parts[0]?.trim() || '';
      result.plats = parts[1]?.trim() || '';
    }

    // Deltagardata
    for (const table of document.querySelectorAll('table')) {
      if (!table.querySelector('tr')?.innerText?.includes('Ryttare')) continue;
      const rows = table.querySelectorAll('tr');
      for (let i = 1; i < rows.length; i++) {
        const cells = Array.from(rows[i].querySelectorAll('td'));
        if (cells.length < 2) continue;
        const rText = cells[0]?.innerText?.trim() || '';
        const hText = cells[1]?.innerText?.trim() || '';
        const idM = rText.match(/\((\d+)\)\s*(.*)/);
        const checkbox = rows[i].querySelector('input[type="checkbox"]');
        // Hästnummer från checkbox-ID (chkHast{hnummer}) eller PrickaAv 4:e param
        let hastNummer = '';
        if (checkbox?.id) {
          const hm = checkbox.id.match(/chkHast(\d+)/);
          if (hm) hastNummer = hm[1];
        }
        result.deltagare.push({
          ryttareId: idM ? idM[1] : '',
          namn: idM ? idM[2].trim() : rText,
          hast: hText,
          hastNummer,
          avbokad: hText === 'AVBOKAD' || hText === 'LÅST AVBOKNING',
          narvaro: checkbox?.checked || false,
        });
      }
      break;
    }
    return result;
  });
}

/**
 * Hämta alla lektioner från avpricknings-listan (alla 7 dagar)
 */
async function getAllLessons(page) {
  const all = [];
  for (let day = 1; day <= 7; day++) {
    await page.goto(`${BASE_URL}/Xenophon/Avprickning/Avprick00_LektLista.aspx`);
    await page.waitForLoadState('networkidle');
    await waitForOverlay(page);

    const btn = page.locator(`#ContentPlaceHolder1_butVdag${day}`);
    if (await btn.count() > 0) {
      await btn.click();
      await waitForOverlay(page);
      await randomDelay(1000, 0.5);
    }

    const lessons = await page.evaluate((dagnamn) => {
      const seen = new Set();
      const result = [];
      document.querySelectorAll('tr[onclick*="GoToLektion"]').forEach(row => {
        const m = row.getAttribute('onclick')?.match(/GoToLektion\('([^']+)'\)/);
        const lnummer = m ? m[1] : '';
        if (!lnummer || seen.has(lnummer)) return;
        seen.add(lnummer);
        const cells = Array.from(row.querySelectorAll('td'));
        result.push({
          lnummer,
          kursnamn: cells[0]?.innerText?.trim() || '',
          tid: cells[1]?.innerText?.trim() || '',
          plats: cells.length >= 4 ? cells[2]?.innerText?.trim() || '' : '',
          ridlarare: cells.length >= 4 ? cells[3]?.innerText?.trim() || '' : '',
          dag: dagnamn,
        });
      });
      return result;
    }, DAGNAMN[day - 1]);

    all.push(...lessons);
  }
  return all;
}

// === MAIN ===

// Slumpmässig startfördröjning (0-90s) så att trafiken inte alltid börjar exakt på :00/:15/:30/:45
const startDelaySec = Math.floor(Math.random() * 90);
console.log(`  [stealth] Väntar ${startDelaySec}s före start...`);
await randomDelay(startDelaySec * 1000, 0.1);

const modeLabel = yearMode ? `hela ${TARGET_YEAR}` : WEEKS_BACK > 0 ? `${WEEKS_BACK} veckor bakåt` : 'nuvarande vecka';
console.log('==========================================');
console.log('  MinRidskola Närvaroskrapare');
console.log(`  Läge: ${modeLabel}`);
console.log('  OBS: BARA LÄSNING');
console.log('==========================================');

const browser = await chromium.launch({ headless: true });
const context = await createStealthContext(browser, {
  viewport: { width: 1400, height: 900 },
});
const page = await context.newPage();

try {
  console.log('  Loggar in...');
  await login(page);
  console.log('  OK!\n');

  // Hämta lektionslista
  console.log('== HÄMTAR LEKTIONER ==');
  const allLessons = await getAllLessons(page);
  console.log(`  ${allLessons.length} lektioner: ${DAGNAMN.map(d => {
    const n = allLessons.filter(l => l.dag === d).length;
    return n > 0 ? `${d.substring(0,3)}:${n}` : '';
  }).filter(Boolean).join(' ')}\n`);

  // Ta reda på vilken vecka som är "nu" genom att gå in i första lektionen
  await page.goto(`${BASE_URL}/Xenophon/Avprickning/Avprick10_LasaLektion.aspx?LNummer=${allLessons[0].lnummer}`);
  await page.waitForLoadState('networkidle');
  await waitForOverlay(page);
  const currentWeekText = await getCurrentWeek(page);
  const currentWeek = parseWeek(currentWeekText);
  console.log(`  Nuvarande vecka: ${currentWeekText}\n`);

  // Samla all data
  const tillfallen = []; // Alla lektionstillfällen

  for (let li = 0; li < allLessons.length; li++) {
    const lesson = allLessons[li];
    console.log(`[${li + 1}/${allLessons.length}] ${lesson.kursnamn} (${lesson.dag} ${lesson.tid}) [${lesson.lnummer}]`);

    // Navigera till lektionen och återställ till nuvarande vecka
    const dayNum = DAGNAMN.indexOf(lesson.dag) + 1;
    const startWeek = await gotoLessonCurrentWeek(page, lesson.lnummer, currentWeekText, dayNum);
    if (startWeek !== currentWeekText) {
      console.log(`  (startade på ${startWeek}, kunde inte nå ${currentWeekText})`);
    }

    // Scrapa nuvarande vecka
    const detail = await extractDetail(page);
    const cwk = parseWeek(detail.vecka);
    const currentInTarget = !TARGET_YEAR || (cwk && cwk.year === TARGET_YEAR);

    if (detail.deltagare.length > 0 && currentInTarget) {
      tillfallen.push({
        lnummer: lesson.lnummer,
        kursnamn: lesson.kursnamn || detail.kursnamn,
        dag: lesson.dag,
        tid: lesson.tid || detail.tid,
        plats: lesson.plats || detail.plats,
        ridlarare: lesson.ridlarare,
        vecka: detail.vecka,
        datum: computeDate(detail.vecka, lesson.dag),
        deltagare: detail.deltagare,
      });
    }

    const aktiva = detail.deltagare.filter(d => !d.avbokad).length;
    const avbokade = detail.deltagare.filter(d => d.avbokad).length;
    console.log(`  ${detail.vecka} | ${aktiva} aktiva, ${avbokade} avbokade`);

    // Navigera bakåt om historik-läge
    if (WEEKS_BACK > 0) {
      for (let w = 0; w < WEEKS_BACK; w++) {
        const ok = await goBackOneWeek(page);
        if (!ok) break;

        const weekDetail = await extractDetail(page);
        const wk = parseWeek(weekDetail.vecka);

        // Stoppa om vi passerat target-året
        if (yearMode && wk && wk.year < TARGET_YEAR) {
          console.log(`  ${weekDetail.vecka} (passerat ${TARGET_YEAR} - stoppar)`);
          break;
        }

        // Hoppa över veckor som inte tillhör target-året
        if (TARGET_YEAR && wk && wk.year !== TARGET_YEAR) {
          continue;
        }

        // Hoppa tomma veckor men fortsätt bakåt
        if (weekDetail.deltagare.length === 0) continue;

        tillfallen.push({
          lnummer: lesson.lnummer,
          kursnamn: lesson.kursnamn || weekDetail.kursnamn,
          dag: lesson.dag,
          tid: lesson.tid || weekDetail.tid,
          plats: lesson.plats || weekDetail.plats,
          ridlarare: lesson.ridlarare,
          vecka: weekDetail.vecka,
          datum: computeDate(weekDetail.vecka, lesson.dag),
          deltagare: weekDetail.deltagare,
        });

        const wa = weekDetail.deltagare.filter(d => !d.avbokad).length;
        console.log(`  ${weekDetail.vecka} | ${wa} aktiva`);
      }
    }
  }

  // === BYGG OUTPUT-JSON ===

  // Samla unika kurser, ryttare, hästar
  const kurserMap = new Map();
  const ryttareMap = new Map();
  const hastarSet = new Set();

  for (const t of tillfallen) {
    if (!kurserMap.has(t.lnummer)) {
      kurserMap.set(t.lnummer, {
        lnummer: t.lnummer,
        kursnamn: t.kursnamn,
        dag: t.dag,
        tid: t.tid,
        plats: t.plats,
        ridlarare: t.ridlarare,
      });
    }
    for (const d of t.deltagare) {
      if (d.namn && d.ryttareId) {
        if (!ryttareMap.has(d.ryttareId)) {
          ryttareMap.set(d.ryttareId, { id: d.ryttareId, namn: d.namn });
        }
      }
      if (d.hast && !d.avbokad) hastarSet.add(d.hast);
    }
  }

  // Räkna statistik
  let totalPlatser = 0;
  let totalNarvarande = 0;
  let totalAvbokade = 0;
  for (const t of tillfallen) {
    for (const d of t.deltagare) {
      if (d.avbokad) totalAvbokade++;
      else totalPlatser++;
      if (d.narvaro) totalNarvarande++;
    }
  }

  const output = {
    meta: {
      scraped: new Date().toISOString(),
      lage: modeLabel,
      nuvarandeVecka: currentWeekText,
    },
    statistik: {
      antalTillfallen: tillfallen.length,
      antalKurser: kurserMap.size,
      unikaRyttare: ryttareMap.size,
      unikaHastar: hastarSet.size,
      deltagarplatser: totalPlatser,
      avbokade: totalAvbokade,
      narvarande: totalNarvarande,
      narvarograd: totalPlatser > 0 ? Math.round(totalNarvarande / totalPlatser * 100) : 0,
    },
    kurser: Array.from(kurserMap.values()),
    ryttare: Array.from(ryttareMap.values()).sort((a, b) => a.namn.localeCompare(b.namn, 'sv')),
    hastar: Array.from(hastarSet).sort((a, b) => a.localeCompare(b, 'sv')),
    tillfallen: tillfallen.map(t => ({
      lnummer: t.lnummer,
      kursnamn: t.kursnamn,
      dag: t.dag,
      vecka: t.vecka,
      datum: t.datum,
      deltagare: t.deltagare,
    })),
  };

  const dateSuffix = new Date().toISOString().slice(0, 10);
  const filename = TARGET_YEAR
    ? `narvaro_${TARGET_YEAR}.json`
    : WEEKS_BACK > 0
      ? `narvaro_historik_${dateSuffix}.json`
      : `narvaro_${dateSuffix}.json`;
  const filepath = join(DATA_DIR, filename);
  writeFileSync(filepath, JSON.stringify(output, null, 2), 'utf-8');

  // Sammanfattning
  console.log('\n==========================================');
  console.log('  RESULTAT');
  console.log('==========================================');
  console.log(`  Tillfällen: ${output.statistik.antalTillfallen}`);
  console.log(`  Kurser:     ${output.statistik.antalKurser}`);
  console.log(`  Ryttare:    ${output.statistik.unikaRyttare}`);
  console.log(`  Hästar:     ${output.statistik.unikaHastar}`);
  console.log(`  Platser:    ${output.statistik.deltagarplatser} (${output.statistik.avbokade} avbokade)`);
  console.log(`  Närvaro:    ${output.statistik.narvarande}/${output.statistik.deltagarplatser} = ${output.statistik.narvarograd}%`);
  console.log(`\n  → ${filepath}`);
  console.log('==========================================');

} catch (e) {
  console.error('\nFEL:', e.message);
  console.error(e.stack?.split('\n').slice(0, 5).join('\n'));
} finally {
  await browser.close();
}
