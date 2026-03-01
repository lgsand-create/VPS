/**
 * Utforskning av hästsidorna i MinRidskola/Xenophon — v3.
 * Loggar in, navigerar till en häst, klickar igenom alla 5 flikar.
 *
 * OBS: BARA LÄSNING – ÄNDRAR INGET PÅ SIDAN.
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
 * Extrahera alla formulärfält och synlig text från aktuell sida
 */
async function extractPageData(page) {
  return page.evaluate(() => {
    const r = { fields: {}, selects: {}, checkboxes: {}, textareas: {}, bodyText: '', tables: [] };

    // Input-fält
    document.querySelectorAll('input').forEach(inp => {
      if (inp.type === 'hidden' || inp.type === 'submit') return;
      const id = inp.id?.replace('ContentPlaceHolder1_', '') || inp.name;
      if (!id) return;
      if (inp.type === 'checkbox') {
        r.checkboxes[id] = inp.checked;
      } else if (inp.type === 'radio') {
        if (inp.checked) r.fields[id.replace(/_\d+$/, '')] = inp.value;
      } else {
        r.fields[id] = inp.value;
      }
    });

    // Selects
    document.querySelectorAll('select').forEach(sel => {
      const id = sel.id?.replace('ContentPlaceHolder1_', '') || sel.name;
      const opts = Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
      r.selects[id] = {
        value: sel.value,
        text: sel.options[sel.selectedIndex]?.text,
        options: opts,
      };
    });

    // Textareas
    document.querySelectorAll('textarea').forEach(ta => {
      const id = ta.id?.replace('ContentPlaceHolder1_', '') || ta.name;
      r.textareas[id] = ta.value;
    });

    // Tabeller
    document.querySelectorAll('table').forEach(table => {
      const rows = [];
      table.querySelectorAll('tr').forEach((tr, i) => {
        if (i > 30) return;
        const cells = Array.from(tr.querySelectorAll('td, th')).map(c => c.innerText?.trim().substring(0, 150));
        if (cells.some(c => c.length > 0)) rows.push(cells);
      });
      if (rows.length > 1) {
        r.tables.push({ id: table.id, rows, total: table.querySelectorAll('tr').length });
      }
    });

    r.bodyText = document.body?.innerText?.substring(0, 5000);
    return r;
  });
}

// === MAIN ===

console.log('==========================================');
console.log('  Hästsidor v3 — Alla flikar');
console.log('==========================================\n');

const browser = await chromium.launch({ headless: true });
const context = await createStealthContext(browser, { viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

const output = { meta: { scraped: new Date().toISOString() }, tabs: {} };

try {
  console.log('  Loggar in...');
  await login(page);
  console.log('  OK!\n');

  // Navigera direkt till Diamond (HNummer=10) — vi vet URL:en nu
  const HORSE_ID = '10';
  await page.goto(`${BASE_URL}/Xenophon/Hastar/Hast10_VisaHast.aspx?HNummer=${HORSE_ID}`);
  await page.waitForLoadState('networkidle');
  await waitForOverlay(page);
  console.log(`  Öppnade häst #${HORSE_ID}: ${page.url()}\n`);

  // Flikarna (submit-knappar som byter vy)
  const tabs = [
    { label: 'Data', id: 'ContentPlaceHolder1_butLagreData' },
    { label: 'Foder', id: 'ContentPlaceHolder1_butLargeFoder' },
    { label: 'Journaler', id: 'ContentPlaceHolder1_butLargeDagbok' },
    { label: 'Sjukskrivning', id: 'ContentPlaceHolder1_butLargeSjuk' },
    { label: 'Skoningar', id: 'ContentPlaceHolder1_butLargeSkoning' },
  ];

  for (const tab of tabs) {
    console.log(`\n== FLIK: ${tab.label.toUpperCase()} ==`);

    // Klicka på fliken
    try {
      await page.click(`#${tab.id}`);
      await randomDelay(2000, 0.5);
      await waitForOverlay(page);
    } catch (e) {
      console.log(`  Kunde inte klicka: ${e.message}`);
      continue;
    }

    console.log(`  URL: ${page.url()}`);
    await page.screenshot({ path: join(DATA_DIR, `probe_hast_${tab.label.toLowerCase()}.png`), fullPage: true });

    const data = await extractPageData(page);
    output.tabs[tab.label] = data;

    // Skriv ut fält
    if (Object.keys(data.fields).length > 0) {
      console.log('  Fält:');
      for (const [k, v] of Object.entries(data.fields)) {
        console.log(`    ${k} = "${v}"`);
      }
    }

    if (Object.keys(data.selects).length > 0) {
      console.log('  Selects:');
      for (const [k, v] of Object.entries(data.selects)) {
        console.log(`    ${k} = "${v.text}" (${v.options.length} val: ${v.options.map(o => o.text).join(', ')})`);
      }
    }

    if (Object.keys(data.checkboxes).length > 0) {
      console.log('  Checkboxes:');
      for (const [k, v] of Object.entries(data.checkboxes)) {
        console.log(`    ${k} = ${v}`);
      }
    }

    if (Object.keys(data.textareas).length > 0) {
      console.log('  Textareas:');
      for (const [k, v] of Object.entries(data.textareas)) {
        console.log(`    ${k} = "${v?.substring(0, 100)}"`);
      }
    }

    if (data.tables.length > 0) {
      console.log(`  Tabeller (${data.tables.length}):`);
      data.tables.forEach(t => {
        console.log(`    [${t.id}] ${t.total} rader:`);
        t.rows.slice(0, 8).forEach(r => console.log(`      ${r.join(' | ')}`));
        if (t.total > 8) console.log(`      ... (${t.total - 8} fler rader)`);
      });
    }

    // Skriv ut body-text för kontext
    console.log(`\n  Body-text (utdrag):`);
    // Filtrera bort navigation och footer
    const relevant = data.bodyText
      ?.split('\n')
      .filter(l => l.trim().length > 0)
      .filter(l => !l.includes('Avprickning') && !l.includes('Nedladdningar') && !l.includes('Copyright'))
      .slice(0, 30)
      .join('\n');
    console.log(relevant);
  }

  // Spara allt
  const filepath = join(DATA_DIR, 'probe_hastar_v3.json');
  writeFileSync(filepath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n\n→ ${filepath}`);
  console.log('==========================================');

} catch (e) {
  console.error('\nFEL:', e.message);
  console.error(e.stack?.split('\n').slice(0, 5).join('\n'));
  try { await page.screenshot({ path: join(DATA_DIR, 'probe_hastar_error.png'), fullPage: true }); } catch {}
} finally {
  await browser.close();
}
