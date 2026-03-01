import { chromium } from 'playwright';
import { login } from '../../tests/helpers/auth.js';
import { getSite } from '../../sites/index.js';
import dotenv from 'dotenv';
dotenv.config();

export async function createBrowser(options = {}) {
  const { headless = true, viewport = 'desktop' } = options;

  const browser = await chromium.launch({ headless });

  const contextOptions = viewport === 'mobile'
    ? { viewport: { width: 375, height: 812 } }
    : { viewport: { width: 1280, height: 720 } };

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  return { browser, context, page };
}

export async function createAuthenticatedPage(siteId, options = {}) {
  const site = getSite(siteId);
  const { browser, context, page } = await createBrowser(options);

  await login(page, site);

  return { browser, context, page, site };
}
