/**
 * E2E – CSP-compliance (Content Security Policy)
 *
 * Verifierar att sidan följer CSP-regler.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';

const site = getActiveSite();
const baseURL = site.baseURL;

// Utan session (testar publika sidor)
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('CSP Compliance', () => {
  test('inga inline style-attribut i DOM (login-sida)', async ({ page }) => {
    await page.goto(`${baseURL}/portal/login`);

    const inlineStyles = await page.evaluate(() => {
      const elements = document.querySelectorAll('[style]');
      return Array.from(elements).map(el => ({
        tag: el.tagName,
        class: el.className,
        style: el.getAttribute('style').substring(0, 50),
      }));
    });

    // CSP borde förhindra inline styles
    // Logga dem men använd soft assert
    if (inlineStyles.length > 0) {
      expect.soft(
        inlineStyles.length,
        `${inlineStyles.length} element med inline style: ${inlineStyles[0].tag}.${inlineStyles[0].class}`
      ).toBe(0);
    }
  });

  test('inga onclick/onchange attribut i DOM', async ({ page }) => {
    await page.goto(`${baseURL}/portal/login`);

    const inlineHandlers = await page.evaluate(() => {
      const eventAttrs = [
        'onclick', 'onchange', 'onsubmit', 'onload', 'onerror',
        'onmouseover', 'onmouseout', 'onfocus', 'onblur', 'onkeydown',
      ];
      const found = [];
      for (const attr of eventAttrs) {
        const elements = document.querySelectorAll(`[${attr}]`);
        for (const el of elements) {
          found.push({
            tag: el.tagName,
            attr,
            value: el.getAttribute(attr).substring(0, 30),
          });
        }
      }
      return found;
    });

    expect.soft(
      inlineHandlers.length,
      `${inlineHandlers.length} inline event handlers hittade`
    ).toBe(0);
  });

  test('CSP-headers finns i response', async ({ page }) => {
    const response = await page.goto(`${baseURL}/portal/login`);
    const headers = response.headers();

    // Kolla om CSP-headers finns
    const csp = headers['content-security-policy'] || headers['content-security-policy-report-only'];
    const xFrame = headers['x-frame-options'];

    // Logga vilka säkerhetsheaders som finns
    const hasCSP = !!csp;
    const hasXFrame = !!xFrame;

    // Minst en säkerhetsheader bör finnas
    expect.soft(
      hasCSP || hasXFrame,
      'Inga CSP-relaterade headers hittades'
    ).toBe(true);
  });

  test('inga CSP-fel i konsolen', async ({ page }) => {
    const cspErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) {
        cspErrors.push(msg.text().substring(0, 100));
      }
    });

    await page.goto(`${baseURL}/portal/login`);
    await page.waitForTimeout(2_000);

    expect.soft(
      cspErrors.length,
      `${cspErrors.length} CSP-fel: ${cspErrors[0] || ''}`
    ).toBe(0);
  });

  test('script/style-taggar kontrolleras', async ({ page }) => {
    await page.goto(`${baseURL}/portal/login`);

    const scriptInfo = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      const styles = document.querySelectorAll('style');
      const inlineScripts = Array.from(scripts).filter(s => !s.src && s.textContent.trim());
      const inlineStyles = Array.from(styles).filter(s => s.textContent.trim());

      return {
        totalScripts: scripts.length,
        inlineScripts: inlineScripts.length,
        scriptsWithNonce: Array.from(scripts).filter(s => s.nonce).length,
        totalStyles: styles.length,
        inlineStyles: inlineStyles.length,
        stylesWithNonce: Array.from(styles).filter(s => s.nonce).length,
      };
    });

    // Om det finns inline scripts bör de ha nonce
    if (scriptInfo.inlineScripts > 0) {
      expect.soft(
        scriptInfo.scriptsWithNonce,
        `${scriptInfo.inlineScripts} inline scripts utan nonce`
      ).toBeGreaterThanOrEqual(scriptInfo.inlineScripts);
    }
  });
});
