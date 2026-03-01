/**
 * E2E Setup – Portal
 *
 * Loggar in som portal-användare och sparar sessionen.
 * Används av e2e-portal-projektet.
 */
import { test as setup, expect } from '@playwright/test';
import { login, validateCredentials } from '../helpers/auth.js';
import { getActiveSite } from '../../sites/index.js';
import { mkdirSync } from 'fs';

const AUTH_DIR = './tests/.auth';

setup.setTimeout(60_000);

setup('authenticate as portal user', async ({ page }) => {
  const site = getActiveSite();
  mkdirSync(AUTH_DIR, { recursive: true });

  validateCredentials(site);
  await login(page, site);

  // Bekräfta inloggning
  await expect(page).toHaveURL(site.auth.postLoginPattern);

  const authFile = `${AUTH_DIR}/${site.id}.json`;
  await page.context().storageState({ path: authFile });
});
