import { test as setup, expect } from '@playwright/test';
import { login, validateCredentials } from './helpers/auth.js';
import { getActiveSite } from '../sites/index.js';
import { mkdirSync } from 'fs';

const AUTH_DIR = './tests/.auth';

setup('authenticate', async ({ page }) => {
  const site = getActiveSite();
  mkdirSync(AUTH_DIR, { recursive: true });

  validateCredentials(site);

  await login(page, site);

  // Bekräfta inloggning: logoutSelector om den finns, annars URL-mönster
  if (site.auth.logoutSelector) {
    await expect(page.locator(site.auth.logoutSelector)).toBeVisible();
  } else {
    await expect(page).toHaveURL(site.auth.postLoginPattern);
  }

  const authFile = `${AUTH_DIR}/${site.id}.json`;
  await page.context().storageState({ path: authFile });
});
