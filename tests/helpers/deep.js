/**
 * Hjälpfunktioner för deep-tester ("klicka överallt").
 * Upptäcker och kategoriserar klickbara element, samlar JS-fel,
 * och skyddar mot destruktiva åtgärder.
 */

// Routes som sannolikt innehåller formulär
const FORM_ROUTE_PATTERNS = ['/create', '/new', '/settings', '/edit'];

// Selektorer som ALDRIG ska klickas (destruktiva åtgärder)
export const DANGEROUS_SELECTORS = [
  'button.btn-logout',
  '[data-action="delete"]',
  'a[href*="delete"]',
  'a[href*="remove"]',
  'button:has-text("Radera")',
  'button:has-text("Ta bort")',
  'button:has-text("Delete")',
  'a[href*="logout"]',
  'a[href*="export"]',
  'a[href*="download"]',
  'a[href*="/csv"]',
  'a[href*="/pdf"]',
];

// Href-mönster att hoppa över vid länkklick
const SKIP_HREF_PATTERNS = [
  /^mailto:/,
  /^tel:/,
  /^javascript:/,
  /^#$/,
  /^#/,
  /\.(pdf|csv|xlsx|zip|png|jpg|gif|svg)$/i,
];

// Download-routes att hoppa över
export const DOWNLOAD_ROUTES = ['/export', '/download', '/csv', '/pdf'];

/**
 * Klassificera en route som formulärsida eller ej.
 */
export function isFormRoute(route) {
  return FORM_ROUTE_PATTERNS.some(p => route.includes(p));
}

/**
 * Kontrollera om en route är en download-route.
 */
export function isDownloadRoute(route) {
  return DOWNLOAD_ROUTES.some(d => route.endsWith(d));
}

/**
 * Kontrollera om ett href ska hoppas över.
 */
export function shouldSkipHref(href, baseURL) {
  if (!href || href.trim() === '') return true;
  if (SKIP_HREF_PATTERNS.some(p => p.test(href))) return true;

  // Hoppa över externa länkar
  try {
    const url = new URL(href, baseURL);
    const base = new URL(baseURL);
    if (url.hostname !== base.hostname) return true;
  } catch {
    return true;
  }

  // Hoppa över farliga href-mönster
  const dangerousHrefParts = ['delete', 'remove', 'logout', 'export', 'download', '/csv', '/pdf'];
  const lower = href.toLowerCase();
  if (dangerousHrefParts.some(p => lower.includes(p))) return true;

  return false;
}

/**
 * Starta JS-felsamling på en page.
 * Returnerar objekt med errors-array, getCritical() och cleanup().
 */
export function startJsErrorCollection(page) {
  const errors = [];
  const ignorePatterns = [
    'favicon',
    'net::ERR_',
    'Mixed Content',
    'third-party',
    'Failed to load resource',
  ];

  const onConsole = (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      const critical = !ignorePatterns.some(p => text.includes(p));
      errors.push({ text, critical, timestamp: Date.now() });
    }
  };

  const onError = (err) => {
    errors.push({ text: err.message, critical: true, timestamp: Date.now() });
  };

  page.on('console', onConsole);
  page.on('pageerror', onError);

  return {
    errors,
    getCritical: () => errors.filter(e => e.critical),
    cleanup: () => {
      page.off('console', onConsole);
      page.off('pageerror', onError);
    },
  };
}

/**
 * Hitta alla synliga interna länkar på sidan.
 * Returnerar array av { href, fullUrl, text, isInternal }.
 */
export async function discoverLinks(page, baseURL) {
  return page.evaluate((base) => {
    const links = [];
    const seen = new Set();

    for (const a of document.querySelectorAll('a[href]')) {
      // Hoppa över osynliga element
      if (a.offsetParent === null && !a.closest('nav')) continue;

      const href = a.getAttribute('href');
      if (!href || href.trim() === '') continue;

      let fullUrl;
      try {
        fullUrl = new URL(href, base).href;
      } catch {
        continue;
      }

      // Deduplicera på fullUrl
      if (seen.has(fullUrl)) continue;
      seen.add(fullUrl);

      const baseHost = new URL(base).hostname;
      const linkHost = new URL(fullUrl).hostname;

      links.push({
        href,
        fullUrl,
        text: a.textContent.trim().substring(0, 80),
        isInternal: linkHost === baseHost,
      });
    }

    return links;
  }, baseURL);
}

/**
 * Hitta interaktiva UI-element (tabs, accordions, dropdowns, modaler).
 * Returnerar kategoriserade element med info för att klicka dem.
 */
export async function discoverInteractiveElements(page) {
  return page.evaluate(() => {
    const results = { tabs: [], accordions: [], dropdowns: [], modals: [] };

    // Tabs
    const tabSelectors = '[role="tab"], .nav-tabs a, .nav-tabs button, [data-toggle="tab"], [data-bs-toggle="tab"]';
    for (const el of document.querySelectorAll(tabSelectors)) {
      if (el.offsetParent === null) continue;
      results.tabs.push({
        text: el.textContent.trim().substring(0, 60),
        index: Array.from(document.querySelectorAll(tabSelectors)).filter(e => e.offsetParent !== null).indexOf(el),
      });
    }

    // Accordions
    const accSelectors = '[data-toggle="collapse"], [data-bs-toggle="collapse"], .accordion-button';
    for (const el of document.querySelectorAll(accSelectors)) {
      if (el.offsetParent === null) continue;
      results.accordions.push({
        text: el.textContent.trim().substring(0, 60),
        target: el.getAttribute('data-target') || el.getAttribute('data-bs-target') || el.getAttribute('href'),
        index: Array.from(document.querySelectorAll(accSelectors)).filter(e => e.offsetParent !== null).indexOf(el),
      });
    }

    // Dropdowns
    const ddSelectors = '[data-toggle="dropdown"], [data-bs-toggle="dropdown"], .dropdown-toggle';
    for (const el of document.querySelectorAll(ddSelectors)) {
      if (el.offsetParent === null) continue;
      results.dropdowns.push({
        text: el.textContent.trim().substring(0, 60),
        index: Array.from(document.querySelectorAll(ddSelectors)).filter(e => e.offsetParent !== null).indexOf(el),
      });
    }

    // Modal-triggers
    const modalSelectors = '[data-toggle="modal"], [data-bs-toggle="modal"]';
    for (const el of document.querySelectorAll(modalSelectors)) {
      if (el.offsetParent === null) continue;
      results.modals.push({
        text: el.textContent.trim().substring(0, 60),
        target: el.getAttribute('data-target') || el.getAttribute('data-bs-target'),
        index: Array.from(document.querySelectorAll(modalSelectors)).filter(e => e.offsetParent !== null).indexOf(el),
      });
    }

    return results;
  });
}

/**
 * Samla alla nätverksfel (trasiga resurser) under sidladdning.
 * Returnerar { start, getFailures, cleanup }.
 */
export function startNetworkMonitor(page) {
  const failures = [];

  const onResponse = (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && !url.includes('favicon')) {
      failures.push({
        url,
        status,
        type: guessResourceType(url),
      });
    }
  };

  const onRequestFailed = (request) => {
    const url = request.url();
    if (url.includes('favicon')) return;
    failures.push({
      url,
      status: 0,
      error: request.failure()?.errorText || 'unknown',
      type: guessResourceType(url),
    });
  };

  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  return {
    failures,
    getFailures: () => failures,
    cleanup: () => {
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    },
  };
}

function guessResourceType(url) {
  if (/\.(js|mjs)(\?|$)/i.test(url)) return 'js';
  if (/\.(css)(\?|$)/i.test(url)) return 'css';
  if (/\.(png|jpg|jpeg|gif|svg|webp|ico)(\?|$)/i.test(url)) return 'image';
  if (/\.(woff2?|ttf|eot)(\?|$)/i.test(url)) return 'font';
  if (/\/api\//i.test(url)) return 'api';
  return 'other';
}

/**
 * Kör grundläggande tillgänglighetskontroller på sidan.
 * Returnerar array av issues.
 */
export async function checkAccessibility(page) {
  return page.evaluate(() => {
    const issues = [];

    // Bilder utan alt-text
    const imgsNoAlt = document.querySelectorAll('img:not([alt])');
    if (imgsNoAlt.length > 0) {
      issues.push({
        type: 'img-no-alt',
        count: imgsNoAlt.length,
        description: `${imgsNoAlt.length} bild(er) saknar alt-text`,
      });
    }

    // Knappar/länkar utan tillgänglig text
    const emptyButtons = [];
    for (const btn of document.querySelectorAll('button, a[role="button"]')) {
      const text = (btn.textContent || '').trim();
      const ariaLabel = btn.getAttribute('aria-label') || '';
      const title = btn.getAttribute('title') || '';
      if (!text && !ariaLabel && !title && btn.offsetParent !== null) {
        emptyButtons.push(btn.tagName + (btn.className ? `.${btn.className.split(' ')[0]}` : ''));
      }
    }
    if (emptyButtons.length > 0) {
      issues.push({
        type: 'empty-buttons',
        count: emptyButtons.length,
        description: `${emptyButtons.length} knapp(ar) utan text/aria-label`,
        elements: emptyButtons.slice(0, 5),
      });
    }

    // Formulär utan labels
    const inputsNoLabel = [];
    for (const input of document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), select, textarea')) {
      if (input.offsetParent === null) continue;
      const id = input.id;
      const hasLabel = id && document.querySelector(`label[for="${id}"]`);
      const hasAriaLabel = input.getAttribute('aria-label');
      const hasPlaceholder = input.getAttribute('placeholder');
      const wrappedInLabel = input.closest('label');
      if (!hasLabel && !hasAriaLabel && !wrappedInLabel && !hasPlaceholder) {
        inputsNoLabel.push(input.name || input.type || 'unknown');
      }
    }
    if (inputsNoLabel.length > 0) {
      issues.push({
        type: 'inputs-no-label',
        count: inputsNoLabel.length,
        description: `${inputsNoLabel.length} fält utan label/aria-label`,
        elements: inputsNoLabel.slice(0, 5),
      });
    }

    // Kontrast: kontrollera att viktig text inte är för ljus
    // (Enkel heuristik – kollar inte faktisk kontrast)
    const heading = document.querySelector('h1, h2, h3');
    if (!heading) {
      issues.push({
        type: 'no-heading',
        count: 1,
        description: 'Sidan saknar rubrik (h1/h2/h3)',
      });
    }

    // Skip-to-content länk
    // (Bara varning, inte fel)

    return issues;
  });
}

/**
 * Mät sidprestanda (laddtid, storlek).
 */
export async function measurePerformance(page) {
  return page.evaluate(() => {
    const perf = performance.getEntriesByType('navigation')[0];
    if (!perf) return null;
    return {
      domContentLoaded: Math.round(perf.domContentLoadedEventEnd - perf.startTime),
      loadComplete: Math.round(perf.loadEventEnd - perf.startTime),
      ttfb: Math.round(perf.responseStart - perf.startTime),
      transferSize: perf.transferSize || 0,
    };
  });
}

/**
 * Hitta alla klickbara knappar (ej submit, ej farliga).
 */
export async function discoverButtons(page) {
  return page.evaluate(() => {
    const buttons = [];
    const dangerTexts = ['radera', 'ta bort', 'delete', 'remove', 'logga ut', 'logout'];
    const skipTypes = ['submit', 'reset'];

    for (const btn of document.querySelectorAll('button, [role="button"]')) {
      if (btn.offsetParent === null) continue;
      if (skipTypes.includes(btn.type)) continue;

      const text = (btn.textContent || '').trim().substring(0, 60);
      const lower = text.toLowerCase();

      // Hoppa över farliga knappar
      if (dangerTexts.some(d => lower.includes(d))) continue;
      // Hoppa över logout
      if (btn.classList.contains('btn-logout')) continue;

      buttons.push({
        text,
        hasOnClick: !!btn.onclick || btn.hasAttribute('onclick'),
        dataAction: btn.getAttribute('data-action') || '',
      });
    }
    return buttons;
  });
}

/**
 * Crawla en portal dynamiskt. Returnerar Map av url → pageData.
 */
export async function crawlPortal(page, context, site, options = {}) {
  const maxDepth = options.maxDepth || 3;
  const maxPages = options.maxPages || 200;
  const startPath = site.portalStart || '/portal';

  const visited = new Map(); // url → { status, jsErrors, networkFailures, loadTime, depth }
  const toVisit = new Set();
  const failures = [];

  // Ladda startsidan – vänta på networkidle så SPA hinner rendera
  await page.goto(`${site.baseURL}${startPath}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Kontrollera att vi inte hamnade på login-sidan
  const currentUrl = page.url();
  if (currentUrl.includes('/login')) {
    console.warn('  ⚠ Sessionen verkar ha gått ut – hamnade på login-sidan');
  }

  const startLinks = await discoverLinks(page, site.baseURL);
  for (const link of startLinks) {
    if (link.isInternal && !shouldSkipHref(link.href, site.baseURL)) {
      toVisit.add(link.fullUrl);
    }
  }
  visited.set(currentUrl, { status: 200, depth: 0 });

  let depth = 0;

  while (toVisit.size > 0 && visited.size < maxPages && depth < maxDepth) {
    const currentBatch = [...toVisit];
    toVisit.clear();
    depth++;

    for (const url of currentBatch) {
      if (visited.has(url) || visited.size >= maxPages) continue;

      let testPage;
      try {
        testPage = await context.newPage();
        testPage.on('dialog', (d) => d.dismiss());

        const jsCollector = startJsErrorCollection(testPage);
        const netMonitor = startNetworkMonitor(testPage);

        const startTime = Date.now();
        const resp = await testPage.goto(url, {
          waitUntil: 'networkidle',
          timeout: 20_000,
        });
        const loadTime = Date.now() - startTime;

        const status = resp?.status() || 0;
        const jsErrors = jsCollector.getCritical();
        const netFailures = netMonitor.getFailures();

        jsCollector.cleanup();
        netMonitor.cleanup();

        visited.set(url, {
          status,
          depth,
          loadTime,
          jsErrors: jsErrors.map(e => e.text),
          networkFailures: netFailures,
        });

        if (![200, 302, 303, 403].includes(status)) {
          failures.push({ url, status, depth });
        }

        // Samla nya länkar
        if (status === 200 && depth < maxDepth) {
          const pageLinks = await discoverLinks(testPage, site.baseURL);
          for (const link of pageLinks) {
            if (
              link.isInternal &&
              !shouldSkipHref(link.href, site.baseURL) &&
              !visited.has(link.fullUrl)
            ) {
              toVisit.add(link.fullUrl);
            }
          }
        }
      } catch (err) {
        visited.set(url, { status: 0, depth, error: err.message.substring(0, 120) });
        failures.push({ url, error: err.message.substring(0, 120), depth });
      } finally {
        if (testPage) await testPage.close().catch(() => {});
      }
    }
  }

  return { visited, failures };
}

/**
 * Hitta alla formulär och deras fält/submit-knappar.
 */
export async function discoverForms(page) {
  return page.evaluate(() => {
    const forms = [];
    for (const form of document.querySelectorAll('form')) {
      const fields = [];
      for (const input of form.querySelectorAll('input, select, textarea')) {
        fields.push({
          tag: input.tagName.toLowerCase(),
          type: input.type || '',
          name: input.name || '',
          required: input.required,
        });
      }

      const submit = form.querySelector('button[type="submit"], input[type="submit"]');
      forms.push({
        action: form.getAttribute('action') || '',
        method: (form.getAttribute('method') || 'GET').toUpperCase(),
        fieldCount: fields.length,
        fields,
        hasSubmit: !!submit,
        submitText: submit?.textContent?.trim() || '',
      });
    }
    return forms;
  });
}
