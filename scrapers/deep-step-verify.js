/**
 * Verifierar hela deep test-flödet med exakta selektorer
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, '..', 'data', 'deep-recording');
mkdirSync(DIR, { recursive: true });

const steps = [
  { action: 'goto', name: 'Loginsida', value: 'https://portal.backatorpif.se/portal/login' },
  { action: 'fill', name: 'E-post', selector: 'input[name="email"]', value: 'js@vda.se' },
  { action: 'fill', name: 'Lösenord', selector: 'input[name="password"]', value: '"h999ztkp#' },
  { action: 'click', name: 'Logga in', selector: 'button[type="submit"]' },
  { action: 'waitFor', name: 'Dashboard', selector: 'a.card.menu-item' },
  { action: 'click', name: 'Boka & beställ', selector: 'a[href="/portal/booking"]' },
  { action: 'waitFor', name: 'Kategorier laddade', selector: 'a[href="/portal/booking/category/3"]' },
  { action: 'click', name: 'Träningsbollar', selector: 'a[href="/portal/booking/category/3"]' },
  { action: 'waitFor', name: 'Bollar laddade', selector: '.item-card[data-item-id="33"]' },
  { action: 'click', name: 'Lägg till boll 1', selector: '.item-card[data-item-id="33"] .qty-plus' },
  { action: 'click', name: 'Lägg till boll 2', selector: '.item-card[data-item-id="33"] .qty-plus' },
  { action: 'click', name: 'Lägg till boll 3', selector: '.item-card[data-item-id="33"] .qty-plus' },
  { action: 'wait', name: 'Kort paus', value: '500' },
  { action: 'click', name: 'Ta bort boll 1', selector: '.item-card[data-item-id="33"] .qty-minus' },
  { action: 'click', name: 'Ta bort boll 2', selector: '.item-card[data-item-id="33"] .qty-minus' },
  { action: 'click', name: 'Ta bort boll 3', selector: '.item-card[data-item-id="33"] .qty-minus' },
  { action: 'click', name: 'Uppgifter', selector: 'a.nav-item[href="/portal/tasks"]' },
  { action: 'waitFor', name: 'Uppgifter laddade', selector: '.app-main' },
  { action: 'click', name: 'Profil', selector: 'a.nav-item[href="/portal/profile"]' },
  { action: 'waitFor', name: 'Profil laddad', selector: '.app-main' },
  { action: 'click', name: 'Pil tillbaka', selector: 'a[title="Tillbaka"]' },
  { action: 'waitFor', name: 'Föregående sida', selector: '.app-main' },
  { action: 'click', name: 'Aktuellt', selector: 'a.nav-item[href="/portal/news"]' },
  { action: 'waitFor', name: 'Aktuellt laddat', selector: '.app-main' },
];

(async () => {
  console.log('\n🧪 Verifierar deep test-flöde\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const jsErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); });

  const results = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const num = String(i + 1).padStart(2, '0');
    const start = Date.now();
    let ok = true;
    let error = null;

    try {
      switch (step.action) {
        case 'goto':
          await page.goto(step.value, { waitUntil: 'networkidle', timeout: 15000 });
          break;
        case 'fill':
          await page.fill(step.selector, step.value);
          break;
        case 'click':
          await page.click(step.selector, { timeout: 5000 });
          await page.waitForTimeout(300);
          break;
        case 'waitFor':
          await page.waitForSelector(step.selector, { timeout: 8000 });
          break;
        case 'wait':
          await page.waitForTimeout(parseInt(step.value) || 500);
          break;
      }
    } catch (err) {
      ok = false;
      error = err.message.substring(0, 100);
    }

    const ms = Date.now() - start;
    const status = ok ? '✅' : '❌';
    console.log(`  ${status} ${num}. ${step.name} [${step.action}] — ${ms}ms${error ? ` — ${error}` : ''} — ${page.url()}`);

    // Screenshot
    const safeName = step.name.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    try {
      await page.screenshot({ path: resolve(DIR, `verify_${num}_${safeName}.png`) });
    } catch {}

    results.push({ ...step, ok, ms, error });

    if (!ok) {
      console.log('\n  ⛔ Stoppar vid första felet');
      break;
    }
  }

  await browser.close();

  // Sammanfattning
  const okCount = results.filter(r => r.ok).length;
  console.log(`\n═══ Resultat: ${okCount}/${results.length} steg OK ═══`);

  if (jsErrors.length > 0) {
    console.log(`\n⚠️  ${jsErrors.length} JS-fel:`);
    for (const e of jsErrors.slice(0, 5)) console.log(`  ${e.substring(0, 120)}`);
  }

  console.log(`\nScreenshots i: ${DIR}`);
  console.log('\n🏁 Klart!\n');
})();
