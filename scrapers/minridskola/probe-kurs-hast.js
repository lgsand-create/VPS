/**
 * Probe: Verifiera att hastNummer fångas korrekt från kursvy
 *
 * Kör: node scrapers/minridskola/probe-kurs-hast.js
 */

import { chromium } from 'playwright';
import dotenv from 'dotenv';
import { createStealthContext, randomDelay } from '../helpers/stealth.js';
dotenv.config();

const BASE_URL = process.env.MRS_BASE_URL || 'https://www.minridskola.se';
const LICNR = process.env.MRS_LICNR || '7678-5850-0915';

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

const browser = await chromium.launch({ headless: true });
const context = await createStealthContext(browser, {
  viewport: { width: 1400, height: 900 },
});
const page = await context.newPage();

try {
  console.log('Loggar in...');
  await login(page);
  console.log('OK!\n');

  // Gå till avprickning
  await page.goto(`${BASE_URL}/Xenophon/Avprickning/Avprick00_LektLista.aspx`);
  await page.waitForLoadState('networkidle');
  await waitForOverlay(page);

  // Hitta och klicka in på första lektionen
  const firstLnummer = await page.evaluate(() => {
    const row = document.querySelector('tr[onclick*="GoToLektion"]');
    const m = row?.getAttribute('onclick')?.match(/GoToLektion\('([^']+)'\)/);
    return m ? m[1] : null;
  });

  if (!firstLnummer) throw new Error('Ingen lektion hittad');
  console.log(`Klickar på lektion: ${firstLnummer}`);

  await page.evaluate((lnr) => GoToLektion(lnr), firstLnummer);
  await page.waitForLoadState('networkidle');
  await waitForOverlay(page);

  // Kör EXAKT samma deltagarextrahering som scrape.js (med hastNummer)
  const result = await page.evaluate(() => {
    const deltagare = [];
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
        let hastNummer = '';
        if (checkbox?.id) {
          const hm = checkbox.id.match(/chkHast(\d+)/);
          if (hm) hastNummer = hm[1];
        }
        deltagare.push({
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
    return deltagare;
  });

  console.log(`\n${result.length} deltagare:\n`);
  for (const d of result) {
    const hnr = d.hastNummer ? `hnr=${d.hastNummer}` : 'hnr=SAKNAS';
    console.log(`  (${d.ryttareId}) ${d.namn.padEnd(25)} → ${d.hast.padEnd(15)} ${hnr}`);
  }

  const withHnr = result.filter(d => d.hastNummer).length;
  const without = result.filter(d => !d.hastNummer && !d.avbokad).length;
  console.log(`\n  Med hastNummer: ${withHnr}/${result.length}`);
  if (without > 0) console.log(`  UTAN hastNummer (ej avbokade): ${without}`);

} catch (e) {
  console.error('\nFEL:', e.message);
} finally {
  await browser.close();
}
