/**
 * Playwright Worker — kors i child_process.fork() fran deep check
 *
 * Tva lagen:
 *   A) Standardtester (utan steg-config):
 *      1. Startsidan laddar (status < 400)
 *      2. Inga JavaScript-fel i konsolen
 *      3. Sidinnehall finns (body > 50 tecken)
 *
 *   B) Steg-baserade tester (med deep_steps config):
 *      Login-flode, navigation, assertions — screenshot per steg
 *
 * Kommunicerar resultat via process.send().
 */

import { mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const [, , siteId, siteUrl, acceptedStatusesRaw, stepsConfigRaw, thresholdsRaw] = process.argv;
const acceptedStatuses = acceptedStatusesRaw ? JSON.parse(acceptedStatusesRaw) : null;
const stepsConfig = stepsConfigRaw ? JSON.parse(stepsConfigRaw) : null;
const thresholds = thresholdsRaw ? JSON.parse(thresholdsRaw) : { maxStepMs: 10000, maxTotalMs: 30000 };

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_SCREENSHOT_DIR = resolve(__dirname, '..', '..', 'public', 'screenshots');

// Tidsstampel for denna korning (anvands i mappnamn)
const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');

/**
 * Ersatt {env:VAR_NAME} placeholders med process.env-varden
 */
function resolveEnvPlaceholders(value) {
  if (!value) return value;
  return value.replace(/\{env:([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || '';
  });
}

// =======================================================================
// Lage A: Standardtester (befintlig logik — inga steg konfigurerade)
// =======================================================================

async function runTests() {
  const { chromium } = await import('playwright');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const tests = [];
  const jsErrors = [];

  // Fanga JS-fel
  page.on('pageerror', (err) => jsErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      const isExpectedStatus = acceptedStatuses && acceptedStatuses.some(s => text.includes(`${s}`));
      if (!text.includes('favicon') && !text.includes('ERR_') && !text.includes('Mixed Content') && !isExpectedStatus) {
        jsErrors.push(text);
      }
    }
  });

  try {
    // Test 1: Startsidan laddar
    const start = Date.now();
    const response = await page.goto(siteUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const loadMs = Date.now() - start;
    const status = response?.status() || 0;
    tests.push({
      name: 'page_load',
      ok: acceptedStatuses
        ? acceptedStatuses.includes(status)
        : (status > 0 && status < 400),
      ms: loadMs,
      status,
    });

    // Vanta lite for att JS ska exekvera
    await page.waitForTimeout(2000);

    // Test 2: JS-fel
    tests.push({
      name: 'no_js_errors',
      ok: jsErrors.length === 0,
      errors: jsErrors,
    });

    // Test 3: Sidinnehall
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    tests.push({
      name: 'has_content',
      ok: bodyText.trim().length > 50,
      contentLength: bodyText.trim().length,
    });

  } catch (err) {
    tests.push({
      name: 'fatal_error',
      ok: false,
      error: err.message,
    });
  }

  const allOk = tests.every(t => t.ok);
  const failedTests = tests.filter(t => !t.ok);

  // Screenshot vid failure — tas INNAN browser stangs
  let screenshot = null;
  if (!allOk) {
    try {
      if (!existsSync(BASE_SCREENSHOT_DIR)) {
        mkdirSync(BASE_SCREENSHOT_DIR, { recursive: true });
      }
      const filename = `${siteId}_deep_${runTimestamp}.png`;
      const filepath = resolve(BASE_SCREENSHOT_DIR, filename);
      await page.screenshot({ path: filepath, fullPage: false });
      screenshot = { filename, path: `/screenshots/${filename}` };
    } catch (err) {
      screenshot = { error: err.message };
    }
  }

  await browser.close();

  process.send({
    siteId,
    type: 'deep',
    status: allOk ? 'ok' : 'critical',
    statusCode: null,
    message: allOk
      ? `${tests.length} deep tests OK`
      : `${failedTests.length}/${tests.length} test(er) misslyckades`,
    details: { tests, jsErrors, screenshot },
  });
}

// =======================================================================
// Lage B: Steg-baserade tester (med deep_steps config)
// =======================================================================

async function runStepTests() {
  const { chromium } = await import('playwright');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const steps = [];
  const jsErrors = [];
  const totalStart = Date.now();

  // Fanga JS-fel under hela testet
  page.on('pageerror', (err) => jsErrors.push(err.message));

  // Skapa screenshot-mapp for denna korning
  const screenshotDir = resolve(BASE_SCREENSHOT_DIR, siteId, `deep_${runTimestamp}`);
  if (!existsSync(screenshotDir)) {
    mkdirSync(screenshotDir, { recursive: true });
  }

  for (let i = 0; i < stepsConfig.length; i++) {
    const step = stepsConfig[i];
    const stepNum = String(i + 1).padStart(3, '0');
    const stepStart = Date.now();
    let ok = true;
    let error = null;

    try {
      const value = resolveEnvPlaceholders(step.value);

      switch (step.action) {
        case 'goto':
          await page.goto(value, { waitUntil: 'networkidle', timeout: 15000 });
          break;
        case 'fill':
          await page.fill(step.selector, value);
          break;
        case 'click':
          await page.click(step.selector, { timeout: 10000 });
          await page.waitForTimeout(300);
          break;
        case 'select':
          await page.selectOption(step.selector, value);
          break;
        case 'waitFor':
          await page.waitForSelector(step.selector, { timeout: 10000 });
          break;
        case 'assert_url': {
          const currentUrl = page.url();
          if (!currentUrl.match(new RegExp(value))) {
            throw new Error(`URL "${currentUrl}" matchar inte "${value}"`);
          }
          break;
        }
        case 'wait':
          await page.waitForTimeout(parseInt(value) || 1000);
          break;
        default:
          throw new Error(`Okand action: ${step.action}`);
      }
    } catch (err) {
      ok = false;
      error = err.message;
    }

    const ms = Date.now() - stepStart;
    const overThreshold = ms > thresholds.maxStepMs;

    // Screenshot efter varje steg
    const safeName = (step.name || step.action).replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    const filename = `${stepNum}_${safeName}.png`;
    let screenshotPath = null;
    try {
      await page.screenshot({ path: resolve(screenshotDir, filename), fullPage: false });
      screenshotPath = `/screenshots/${siteId}/deep_${runTimestamp}/${filename}`;
    } catch {
      // Screenshot misslyckades — inte kritiskt
    }

    steps.push({
      index: i + 1,
      name: step.name || `${step.action} ${step.selector || step.value || ''}`.trim(),
      action: step.action,
      ok,
      ms,
      overThreshold,
      error,
      screenshotPath,
    });

    // Stoppa vid failure — inga fler steg
    if (!ok) break;
  }

  await browser.close();

  const totalMs = Date.now() - totalStart;
  const allOk = steps.every(s => s.ok);
  const anyOverThreshold = steps.some(s => s.overThreshold) || totalMs > thresholds.maxTotalMs;

  const failedStep = steps.find(s => !s.ok);

  process.send({
    siteId,
    type: 'deep',
    status: !allOk ? 'critical' : anyOverThreshold ? 'warning' : 'ok',
    statusCode: null,
    message: !allOk
      ? `Steg ${failedStep.index}/${stepsConfig.length} misslyckades: ${failedStep.name}`
      : anyOverThreshold
        ? `${steps.length} steg OK men ${totalMs}ms (max ${thresholds.maxTotalMs}ms)`
        : `${steps.length} steg OK (${totalMs}ms)`,
    details: {
      mode: 'steps',
      steps,
      jsErrors,
      totalMs,
      thresholds,
      reportDir: `/screenshots/${siteId}/deep_${runTimestamp}/`,
    },
  });
}

// =======================================================================
// Main — valj lage baserat pa om steg-config finns
// =======================================================================

const mainFn = stepsConfig ? runStepTests : runTests;

mainFn()
  .then(() => process.exit(0))
  .catch((err) => {
    process.send({
      siteId,
      type: 'deep',
      status: 'error',
      statusCode: null,
      message: `Playwright kraschade: ${err.message}`,
      details: { error: err.message },
    });
    process.exit(1);
  });
