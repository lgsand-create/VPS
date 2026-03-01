/**
 * Bakgrundskontroll — kärna
 *
 * Tar emot 4 fält (extraherade av sändande system ur PDF),
 * verifierar utdragets äkthet via Polisens kontrolltjänst med Playwright,
 * och returnerar verifikationsintyg som Buffer.
 *
 * Ingen personuppgift loggas eller lagras av denna modul.
 */

import { chromium } from 'playwright';
import { readFile, unlink, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';

// Rensa kvarglömda temp-PDF:er (från kraschade checks)
(async () => {
  try {
    const dir = tmpdir();
    const files = await readdir(dir);
    const stale = files.filter(f => f.startsWith('bgcheck_') && f.endsWith('.pdf'));
    for (const f of stale) {
      await unlink(join(dir, f)).catch(() => {});
    }
    if (stale.length > 0) {
      console.log(`  [bgcheck] Städade ${stale.length} kvarglömd(a) temp-PDF`);
    }
  } catch { /* ignore */ }
})();

const KONTROLL_URL = 'https://etjanster.polisen.se/eregisterutdrag/kontroll';

/**
 * Giltiga utdragstyper — exakt samma som Polisens dropdown på kontrolltjänsten.
 * Portalen skickar ett av dessa värden rakt av (ingen mappning behövs).
 */
const VALID_UTDRAGSTYPER = new Set([
  'Arbete inom skola eller förskola',
  'Arbete med barn med funktionsnedsättning',
  'Arbete på HVB-hem',
  'Arbete med barn i annan verksamhet än skola och barnomsorg',
  'Försäkringsbolag eller försäkringsförmedling',
]);

/**
 * @param {{
 *   arendenummer:    string,
 *   personnummer:    string,   ← YYYYMMDDXXXX (utan bindestreck)
 *   utfardandedatum: string,   ← YYYY-MM-DD
 *   utdragstyp:      string,   ← exakt select-label från Polisens dropdown
 * }} fields
 *
 * @returns {Promise<{
 *   authentic:          boolean | null,   ← null = valideringsfel, aldrig skickat till Polisen
 *   hasRecord:          boolean | null,
 *   verificationNumber: string | null,
 *   verificationPdf:    Buffer | null,
 *   checkedAt:          string,
 *   warnings:           string[]
 * }>}
 */
export async function runCheck(fields) {
  const { arendenummer, personnummer, utfardandedatum, utdragstyp } = fields;
  const warnings = [];

  // Validera inkommande fält
  if (!arendenummer?.match(/^\d{8}$/)) warnings.push('INVALID_ARENDENUMMER');
  if (!personnummer?.match(/^\d{12}$/))  warnings.push('INVALID_PERSONNUMMER');
  if (!utfardandedatum?.match(/^\d{4}-\d{2}-\d{2}$/)) warnings.push('INVALID_DATUM');

  // Kontrollera att utdraget inte gått ut (1 år)
  if (utfardandedatum) {
    const issued  = new Date(utfardandedatum);
    const expires = new Date(issued);
    expires.setFullYear(expires.getFullYear() + 1);
    if (new Date() > expires) warnings.push('EXPIRED');
  }

  // Validera utdragstyp mot Polisens fasta lista
  if (!VALID_UTDRAGSTYPER.has(utdragstyp)) warnings.push('UNKNOWN_UTDRAGSTYP');

  // Avbryt om valideringsfel hindrar oss från att fylla i formuläret
  // authentic = null → vi har INTE frågat Polisen (skiljer från false = Polisen sa nej)
  if (warnings.some(w => ['INVALID_ARENDENUMMER', 'INVALID_PERSONNUMMER', 'INVALID_DATUM', 'UNKNOWN_UTDRAGSTYP'].includes(w))) {
    return {
      authentic: null,
      hasRecord: null,
      verificationNumber: null,
      verificationPdf: null,
      checkedAt: new Date().toISOString(),
      warnings,
    };
  }

  // Playwright-verifiering
  let authentic = false;
  let hasRecord = null;
  let verificationNumber = null;
  let verificationPdf = null;
  const tmpPath = join(tmpdir(), `bgcheck_${Date.now()}_${createHash('sha256').update(personnummer).digest('hex').slice(0, 8)}.pdf`);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(KONTROLL_URL, { waitUntil: 'networkidle' });

    await page.fill('#utdragInformation-fieldset-arendenummer', arendenummer);
    await page.fill('#utdragInformation-fieldset-personnummer', personnummer);
    await page.fill('#utdragInformation-fieldset-datum', utfardandedatum);
    await page.selectOption('#utdragInformation-fieldset-utdragstyp', { label: utdragstyp });

    await page.click('button:has-text("Kontrollera uppgifter")');
    await page.waitForTimeout(2000);

    const resultText = await page.evaluate(() => document.body.innerText);

    authentic = /äkta och har utfärdats av Polismyndigheten/i.test(resultText);
    if (!authentic) {
      warnings.push('VERIFICATION_FAILED');
      // Logga aldrig personnummer — bara ärendenummer är OK att logga
      console.warn(`  [background-check] Verifiering misslyckades — ärendenummer: ${arendenummer}`);
    }

    // Ladda ned verifikationsintyg från polisen
    if (authentic) {
      const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
      await page.click('button:has-text("Spara ned resultatet")');
      const download = await downloadPromise;

      await download.saveAs(tmpPath);
      verificationPdf = await readFile(tmpPath);

      // Extrahera verifikationsnummer (UUID) ur intyget
      verificationNumber = await extractVerificationNumber(verificationPdf);
    }

    // hasRecord läses inte här — portalen känner till det från PDF-parsningen.
    // Vi sätter den till null för att inte duplicera logik.
    hasRecord = null;

  } finally {
    await browser.close();
    await unlink(tmpPath).catch(() => {});
  }

  return {
    authentic,
    hasRecord,
    verificationNumber,
    verificationPdf,
    checkedAt: new Date().toISOString(),
    warnings,
  };
}

/**
 * Extraherar verifikationsnummer (UUID) ur verifikationsintygets PDF
 * Använder pdf-parse för att hantera komprimerat (flate) innehåll.
 * @param {Buffer} buf
 * @returns {Promise<string|null>}
 */
async function extractVerificationNumber(buf) {
  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buf);
    const match = data.text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return match?.[0] ?? null;
  } catch (err) {
    console.error('  [bgcheck] PDF-parse error:', err.message);
    return null;
  }
}
