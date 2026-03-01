/**
 * Inspektera kundkorg-element på Träningsbollar-sidan
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, '..', 'data', 'deep-recording');
mkdirSync(DIR, { recursive: true });

const BASE = 'https://portal.backatorpif.se';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // Login
  await page.goto(`${BASE}/portal/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', 'js@vda.se');
  await page.fill('input[name="password"]', '"h999ztkp#');
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  console.log('Inloggad:', page.url());

  // Gå direkt till Träningsbollar
  await page.goto(`${BASE}/portal/booking/category/3`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Inspektera DOM-strukturen
  const pageHtml = await page.evaluate(() => {
    // Hitta alla items/kort med kvantitet
    const items = document.querySelectorAll('.item-card, .booking-item, .product-item, .category-item, [class*="item"], [class*="product"]');
    const result = [];
    for (const item of items) {
      result.push({
        tag: item.tagName,
        classes: item.className.substring(0, 100),
        html: item.outerHTML.substring(0, 500),
      });
    }
    return result;
  });

  console.log(`\n📋 Hittade ${pageHtml.length} item-element:`);
  for (const item of pageHtml) {
    console.log(`  [${item.tag}.${item.classes}]`);
    console.log(`  ${item.html.substring(0, 300)}\n`);
  }

  // Inspektera ALLA knappar
  const buttons = await page.$$eval('button, [role="button"]', els =>
    els.map(el => ({
      text: el.textContent.trim().substring(0, 30),
      tag: el.tagName,
      classes: el.className.substring(0, 100),
      type: el.type,
      disabled: el.disabled,
      ariaLabel: el.getAttribute('aria-label'),
      onclick: el.getAttribute('onclick')?.substring(0, 100),
      parentClasses: el.parentElement?.className?.substring(0, 80),
      outerHTML: el.outerHTML.substring(0, 300),
    }))
  );

  console.log(`\n📋 Alla knappar (${buttons.length} st):`);
  for (const b of buttons) {
    console.log(`  "${b.text}" [${b.classes}] type=${b.type} disabled=${b.disabled}`);
    console.log(`    aria-label: ${b.ariaLabel}`);
    console.log(`    onclick: ${b.onclick}`);
    console.log(`    parent: ${b.parentClasses}`);
    console.log(`    HTML: ${b.outerHTML.substring(0, 200)}\n`);
  }

  // Inspektera inputs (quantity)
  const inputs = await page.$$eval('input', els =>
    els.map(el => ({
      type: el.type, name: el.name, id: el.id, value: el.value,
      classes: el.className.substring(0, 100),
      parentClasses: el.parentElement?.className?.substring(0, 80),
      outerHTML: el.outerHTML.substring(0, 200),
    }))
  );

  console.log(`\n📋 Alla inputs (${inputs.length} st):`);
  for (const inp of inputs) {
    console.log(`  type=${inp.type} name="${inp.name}" id="${inp.id}" value="${inp.value}" [${inp.classes}]`);
    console.log(`    parent: ${inp.parentClasses}`);
    console.log(`    HTML: ${inp.outerHTML}\n`);
  }

  // Hämta hela main-content HTML (förkortad)
  const mainHtml = await page.evaluate(() => {
    const main = document.querySelector('main, .content, .page-content, #app, body > div');
    return main ? main.innerHTML.substring(0, 3000) : document.body.innerHTML.substring(0, 3000);
  });
  console.log('\n📋 Sid-HTML (förkortad):');
  console.log(mainHtml);

  // Testa: klicka på + för första bollen
  console.log('\n─── TEST: Klicka + för Boll storlek 3 ───');

  // Hitta + knappar (de med "+" text)
  const plusBtns = await page.$$('button:has-text("+")');
  console.log(`Hittade ${plusBtns.length} st "+"-knappar`);

  if (plusBtns.length > 0) {
    // Klicka + tre gånger på första bollen
    for (let i = 0; i < 3; i++) {
      await plusBtns[0].click();
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: resolve(DIR, '10_efter-3-plus.png') });
    console.log('Klickade + 3 gånger, screenshot tagen');

    // Kolla kvantiteten
    const qtyValues = await page.$$eval('input[type="number"], .qty-value, .quantity', els =>
      els.map(el => ({ tag: el.tagName, value: el.value || el.textContent?.trim(), classes: el.className }))
    );
    console.log('Kvantitetsvärden:', JSON.stringify(qtyValues));

    // Hitta kundkorg-ikon och klicka
    const cartBtn = await page.$('a[href*="cart"], button[class*="cart"], .cart-icon, header a:nth-child(2), .header-actions a:first-child');
    if (cartBtn) {
      console.log('\nHittade kundkorg-knapp, klickar...');
      await cartBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      console.log('URL:', page.url());
      await page.screenshot({ path: resolve(DIR, '11_kundkorg.png') });

      // Inspektera ta bort-knappar
      const removeBtns = await page.$$eval('button, a', els =>
        els.filter(el => {
          const t = (el.textContent || '').trim().toLowerCase();
          return el.offsetParent !== null && (
            t.includes('ta bort') || t.includes('radera') || t.includes('remove') ||
            t.includes('töm') || t.includes('rensa') ||
            el.getAttribute('aria-label')?.toLowerCase().includes('remove') ||
            el.getAttribute('aria-label')?.toLowerCase().includes('delete')
          );
        }).map(el => ({
          text: el.textContent.trim().substring(0, 50),
          tag: el.tagName, href: el.getAttribute('href'),
          classes: el.className.substring(0, 80),
          ariaLabel: el.getAttribute('aria-label'),
        }))
      );
      console.log(`Ta bort-knappar: ${JSON.stringify(removeBtns)}`);
    } else {
      console.log('\nTestar att klicka - tre gånger istället...');
      // Hitta minus-knappar
      const minusBtns = await page.$$('button:has-text("−"), button:has-text("-")');
      console.log(`Hittade ${minusBtns.length} st "-"-knappar`);
      if (minusBtns.length > 0) {
        for (let i = 0; i < 3; i++) {
          await minusBtns[0].click();
          await page.waitForTimeout(300);
        }
        await page.screenshot({ path: resolve(DIR, '12_efter-3-minus.png') });
        console.log('Klickade - 3 gånger, screenshot tagen');
      }
    }
  }

  // Kolla header-ikonerna
  const headerLinks = await page.$$eval('header a, .page-header a, .header-actions a, [class*="header"] a', els =>
    els.map(el => ({
      href: el.getAttribute('href'),
      classes: el.className.substring(0, 80),
      title: el.getAttribute('title'),
      ariaLabel: el.getAttribute('aria-label'),
      innerHTML: el.innerHTML.substring(0, 200),
    }))
  );
  console.log(`\nHeader-länkar: ${JSON.stringify(headerLinks, null, 2)}`);

  await browser.close();
  console.log('\nKlart!');
})();
