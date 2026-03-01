/**
 * Deep Step Recorder — Navigerar portalen och rapporterar selektorer
 *
 * Kör: node scrapers/deep-step-recorder.js
 *
 * Loggar in och navigerar enligt det önskade flödet, tar screenshot per steg,
 * och skriver ut en färdig deep_steps JSON-config.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = resolve(__dirname, '..', 'data', 'deep-recording');
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const BASE_URL = 'https://portal.backatorpif.se';
const USERNAME = 'js@vda.se';
const PASSWORD = '"h999ztkp#';

const steps = [];
let stepIndex = 0;

async function screenshot(page, name) {
  stepIndex++;
  const num = String(stepIndex).padStart(2, '0');
  const safeName = name.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const path = resolve(SCREENSHOT_DIR, `${num}_${safeName}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  📸 ${num}. ${name}`);
  return path;
}

async function logLinks(page, label) {
  const links = await page.$$eval('nav a, .nav a, .sidebar a, .menu a, a.nav-link, a.menu-item', els =>
    els.map(el => ({
      text: el.textContent.trim().substring(0, 50),
      href: el.getAttribute('href'),
      selector: el.id ? `#${el.id}` : null,
    })).filter(l => l.text)
  );
  if (links.length > 0) {
    console.log(`\n  📋 ${label} — ${links.length} nav-länkar:`);
    for (const l of links.slice(0, 20)) {
      console.log(`     ${l.text} → ${l.href || '(ingen href)'}${l.selector ? ` [${l.selector}]` : ''}`);
    }
  }
}

async function findClickable(page, text) {
  // Försök hitta en klickbar länk/knapp med texten
  const selectors = [
    `a:has-text("${text}")`,
    `button:has-text("${text}")`,
    `[role="button"]:has-text("${text}")`,
    `.nav-link:has-text("${text}")`,
    `.menu-item:has-text("${text}")`,
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el && await el.isVisible()) {
      return { selector: sel, element: el };
    }
  }
  return null;
}

(async () => {
  console.log('\n🔍 Deep Step Recorder — Startar\n');
  console.log(`  URL: ${BASE_URL}`);
  console.log(`  User: ${USERNAME}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // Logga JS-fel
  const jsErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') jsErrors.push(msg.text());
  });

  try {
    // === STEG 1: Gå till startsida ===
    console.log('─── STEG 1: Gå till portalen ───');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await screenshot(page, 'startsida');

    // Kolla om vi är på login-sidan
    const currentUrl = page.url();
    console.log(`  URL efter load: ${currentUrl}`);

    // Identifiera login-formulärets element
    const loginFields = await page.$$eval('input, select, button[type="submit"]', els =>
      els.map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.type,
        name: el.name,
        id: el.id,
        placeholder: el.placeholder,
        selector: el.name ? `[name="${el.name}"]` : (el.id ? `#${el.id}` : null),
      }))
    );
    console.log('\n  📋 Formulärfält på sidan:');
    for (const f of loginFields) {
      console.log(`     ${f.tag}[type=${f.type}] name="${f.name}" id="${f.id}" placeholder="${f.placeholder || ''}"`);
    }

    // === STEG 2: Logga in ===
    console.log('\n─── STEG 2: Logga in ───');

    // Fyll i username
    const usernameField = await page.$('input[name="username"]') || await page.$('input[type="email"]') || await page.$('input[name="email"]');
    if (usernameField) {
      await usernameField.fill(USERNAME);
      console.log('  ✅ Username ifyllt');
    } else {
      console.log('  ❌ Hittar inte username-fält');
    }

    // Fyll i password
    const passwordField = await page.$('input[name="password"]') || await page.$('input[type="password"]');
    if (passwordField) {
      await passwordField.fill(PASSWORD);
      console.log('  ✅ Password ifyllt');
    } else {
      console.log('  ❌ Hittar inte password-fält');
    }

    // Välj association om det finns
    const assocSelect = await page.$('select[name="association_id"]');
    if (assocSelect) {
      const options = await assocSelect.$$eval('option', opts =>
        opts.map(o => ({ value: o.value, text: o.textContent.trim() }))
      );
      console.log('  📋 Föreningsväljare:', options);
      if (options.length > 0) {
        // Välj första icke-tomma
        const val = options.find(o => o.value && o.value !== '')?.value || '1';
        await assocSelect.selectOption(val);
        console.log(`  ✅ Valde förening: ${val}`);
      }
    }

    await screenshot(page, 'login-ifyllt');

    // Klicka submit
    const submitBtn = await page.$('button[type="submit"]') || await page.$('input[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
      console.log('  ✅ Klickade submit');
    }

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const afterLoginUrl = page.url();
    console.log(`  URL efter login: ${afterLoginUrl}`);
    await screenshot(page, 'efter-login');

    // Kolla navigationsstruktur
    await logLinks(page, 'Navigation efter login');

    // Samla alla synliga länkar/menyer
    const allLinks = await page.$$eval('a[href]', els =>
      els.filter(el => el.offsetParent !== null).map(el => ({
        text: el.textContent.trim().substring(0, 60),
        href: el.getAttribute('href'),
        classes: el.className.substring(0, 80),
      })).filter(l => l.text && l.text.length > 1)
    );
    console.log(`\n  📋 Alla synliga länkar (${allLinks.length} st):`);
    for (const l of allLinks.slice(0, 30)) {
      console.log(`     "${l.text}" → ${l.href} [${l.classes}]`);
    }

    // === STEG 3: Navigera till "Boka & beställ" ===
    console.log('\n─── STEG 3: Gå till "Boka & beställ" ───');
    let bokaLink = await findClickable(page, 'Boka');
    if (!bokaLink) bokaLink = await findClickable(page, 'beställ');
    if (!bokaLink) bokaLink = await findClickable(page, 'Boka & beställ');

    if (bokaLink) {
      console.log(`  ✅ Hittade: ${bokaLink.selector}`);
      await bokaLink.element.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      console.log(`  URL: ${page.url()}`);
      await screenshot(page, 'boka-bestall');
      await logLinks(page, 'Navigation i Boka & beställ');

      // Samla synliga produkter/kategorier
      const subLinks = await page.$$eval('a[href]', els =>
        els.filter(el => el.offsetParent !== null).map(el => ({
          text: el.textContent.trim().substring(0, 60),
          href: el.getAttribute('href'),
        })).filter(l => l.text && l.text.length > 1)
      );
      console.log(`\n  📋 Länkar i Boka & beställ (${subLinks.length} st):`);
      for (const l of subLinks.slice(0, 25)) {
        console.log(`     "${l.text}" → ${l.href}`);
      }
    } else {
      console.log('  ❌ Hittade inte "Boka & beställ"-länk');
      // Ta screenshot av hela sidan för debug
      await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'debug-no-boka.png'), fullPage: true });
    }

    // === STEG 4: Gå till "Träningsbollar" ===
    console.log('\n─── STEG 4: Gå till "Träningsbollar" ───');
    let bollarLink = await findClickable(page, 'Träningsbollar');
    if (!bollarLink) bollarLink = await findClickable(page, 'bollar');
    if (!bollarLink) bollarLink = await findClickable(page, 'Träning');

    if (bollarLink) {
      console.log(`  ✅ Hittade: ${bollarLink.selector}`);
      await bollarLink.element.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      console.log(`  URL: ${page.url()}`);
      await screenshot(page, 'traningsbollar');

      // Hitta "lägg i kundkorg"-knappar
      const buttons = await page.$$eval('button, input[type="submit"], a.btn', els =>
        els.filter(el => el.offsetParent !== null).map(el => ({
          text: el.textContent.trim().substring(0, 60),
          type: el.type || el.tagName,
          selector: el.id ? `#${el.id}` : (el.name ? `[name="${el.name}"]` : null),
          classes: el.className.substring(0, 80),
        })).filter(b => b.text)
      );
      console.log(`\n  📋 Knappar/actions (${buttons.length} st):`);
      for (const b of buttons) {
        console.log(`     "${b.text}" [${b.classes}] ${b.selector || ''}`);
      }

      // Hitta quantity-inputs
      const qtyInputs = await page.$$eval('input[type="number"], input.qty, input.quantity, select.qty', els =>
        els.map(el => ({
          name: el.name, id: el.id, value: el.value,
          selector: el.name ? `[name="${el.name}"]` : (el.id ? `#${el.id}` : null),
        }))
      );
      if (qtyInputs.length > 0) {
        console.log(`\n  📋 Antal-fält: ${JSON.stringify(qtyInputs)}`);
      }
    } else {
      console.log('  ❌ Hittade inte "Träningsbollar"-länk');
    }

    // === STEG 5: Gå till "Uppgifter" ===
    console.log('\n─── STEG 5: Gå till "Uppgifter" ───');
    let uppgifterLink = await findClickable(page, 'Uppgifter');

    if (uppgifterLink) {
      console.log(`  ✅ Hittade: ${uppgifterLink.selector}`);
      await uppgifterLink.element.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      console.log(`  URL: ${page.url()}`);
      await screenshot(page, 'uppgifter');
    } else {
      console.log('  ❌ Hittade inte "Uppgifter"-länk');
    }

    // === STEG 6: Gå till "Profil" ===
    console.log('\n─── STEG 6: Gå till "Profil" ───');
    let profilLink = await findClickable(page, 'Profil');
    if (!profilLink) profilLink = await findClickable(page, 'Min profil');

    if (profilLink) {
      console.log(`  ✅ Hittade: ${profilLink.selector}`);
      await profilLink.element.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      console.log(`  URL: ${page.url()}`);
      await screenshot(page, 'profil');

      // Hitta "tillbaka"-knapp
      const backBtns = await page.$$eval('a, button', els =>
        els.filter(el => {
          const text = el.textContent.trim().toLowerCase();
          return el.offsetParent !== null && (
            text.includes('tillbaka') || text.includes('back') ||
            el.getAttribute('aria-label')?.includes('back') ||
            el.querySelector('svg') !== null && text.length < 5
          );
        }).map(el => ({
          text: el.textContent.trim().substring(0, 40),
          tag: el.tagName, href: el.getAttribute('href'),
          classes: el.className.substring(0, 80),
        }))
      );
      if (backBtns.length > 0) {
        console.log(`\n  📋 Tillbaka-knappar: ${JSON.stringify(backBtns)}`);
      }

      // Tryck tillbaka (browser back)
      console.log('  ← Trycker bakåt (browser back)');
      await page.goBack({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      console.log(`  URL efter tillbaka: ${page.url()}`);
      await screenshot(page, 'efter-profil-tillbaka');
    } else {
      console.log('  ❌ Hittade inte "Profil"-länk');
    }

    // === STEG 7: Gå till "Aktuellt" ===
    console.log('\n─── STEG 7: Gå till "Aktuellt" ───');
    let aktuelltLink = await findClickable(page, 'Aktuellt');
    if (!aktuelltLink) aktuelltLink = await findClickable(page, 'Nyheter');

    if (aktuelltLink) {
      console.log(`  ✅ Hittade: ${aktuelltLink.selector}`);
      await aktuelltLink.element.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      console.log(`  URL: ${page.url()}`);
      await screenshot(page, 'aktuellt');
    } else {
      console.log('  ❌ Hittade inte "Aktuellt"-länk');
    }

    // === SAMMANFATTNING ===
    console.log('\n═══════════════════════════════════════');
    console.log('  SAMMANFATTNING');
    console.log('═══════════════════════════════════════\n');

    if (jsErrors.length > 0) {
      console.log(`  ⚠️  ${jsErrors.length} JS-fel:`);
      for (const e of jsErrors.slice(0, 10)) {
        console.log(`     ${e.substring(0, 120)}`);
      }
    } else {
      console.log('  ✅ Inga JS-fel');
    }

    console.log(`\n  Screenshots sparade i: ${SCREENSHOT_DIR}`);

  } catch (err) {
    console.error(`\n  ❌ Fel: ${err.message}`);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'error.png'), fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log('\n🏁 Klart!\n');
})();
