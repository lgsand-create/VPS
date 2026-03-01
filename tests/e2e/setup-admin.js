/**
 * E2E Setup – Admin
 *
 * Loggar in som admin-användare och sparar sessionen.
 * Används av e2e-admin-projektet.
 */
import { test as setup, expect } from '@playwright/test';
import { login, validateCredentials } from '../helpers/auth.js';
import { getActiveSite } from '../../sites/index.js';
import { mkdirSync } from 'fs';

const AUTH_DIR = './tests/.auth';

setup.setTimeout(60_000);

setup('authenticate as admin', async ({ page }) => {
  const site = getActiveSite();
  mkdirSync(AUTH_DIR, { recursive: true });

  if (!site.adminAuth) {
    throw new Error(`Site "${site.id}" saknar adminAuth-konfiguration`);
  }

  // Skapa en tillfällig site-config med adminAuth som primary auth
  const adminSite = { ...site, auth: site.adminAuth };
  validateCredentials(adminSite);
  await login(page, adminSite);

  // Bekräfta inloggning
  await expect(page).toHaveURL(site.adminAuth.postLoginPattern);

  const authFile = `${AUTH_DIR}/${site.id}-admin.json`;
  await page.context().storageState({ path: authFile });
});
