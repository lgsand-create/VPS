/**
 * Stealth-hjälpare för att minska risk att bli blockerad vid scraping.
 *
 * - Roterar User-Agent mellan vanliga desktop-browsers
 * - Randomiserar delays (jitter) så mönstret inte ser maskinellt ut
 * - Sätter realistiska HTTP-headers
 */

// Moderna, vanliga User-Agent-strängar (uppdatera vid behov)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

/**
 * Välj en slumpmässig User-Agent från poolen.
 */
export function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Vänta minst baseMs, plus en slumpmässig extra fördröjning.
 * Basen är alltid minimum – jittern lägger bara till tid uppåt.
 * Exempel: randomDelay(1000, 0.5) → väntar 1000-1500ms (aldrig under 1000)
 *
 * @param {number} baseMs   Minimum-delay i millisekunder
 * @param {number} jitter   Extra tid uppåt som andel av base (0.5 = +0-50%)
 */
export async function randomDelay(baseMs = 1000, jitter = 0.4) {
  const extra = Math.floor(Math.random() * baseMs * jitter);
  const delay = baseMs + extra;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Realistiska HTTP-headers som matchar en vanlig browser.
 * Returnerar headers-objekt att skicka med i newContext().
 */
export function getRealisticHeaders() {
  return {
    'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  };
}

/**
 * Skapa ett Playwright browser-context med stealth-inställningar.
 * Drop-in ersättning för browser.newContext().
 *
 * @param {import('playwright').Browser} browser
 * @param {object} options  Extra context-options (viewport etc)
 */
export async function createStealthContext(browser, options = {}) {
  const userAgent = getRandomUserAgent();
  const extraHTTPHeaders = getRealisticHeaders();

  const context = await browser.newContext({
    userAgent,
    extraHTTPHeaders,
    locale: 'sv-SE',
    timezoneId: 'Europe/Stockholm',
    ...options,
  });

  console.log(`  [stealth] UA: ...${userAgent.slice(-40)}`);
  return context;
}
