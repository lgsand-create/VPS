/**
 * Generisk autentisering – fungerar med vilken site-config som helst.
 *
 * OBS om lösenord med specialtecken:
 * - " (citattecken) och # (hash) kräver escaping i .env
 * - Wrappa i enkla citattecken i .env: ADMIN_PASSWORD='"h999ztkp#'
 */
import dotenv from 'dotenv';
dotenv.config();

export async function login(page, site) {
  const { auth, baseURL } = site;
  const { credentials, selectors, extraFields = [] } = auth;

  await page.goto(`${baseURL}${auth.loginPath}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector(selectors.username, { timeout: 10_000 });

  await page.fill(selectors.username, credentials.username);
  await page.fill(selectors.password, credentials.password);

  for (const field of extraFields) {
    switch (field.action) {
      case 'select':
        await page.selectOption(field.selector, field.value);
        break;
      case 'fill':
        await page.fill(field.selector, field.value);
        break;
      case 'check':
        await page.check(field.selector);
        break;
      default:
        await page.fill(field.selector, field.value);
    }
  }

  await page.click(selectors.submit);

  // Vänta på att login lyckas: URL-mönster eller logoutSelector
  if (auth.postLoginPattern) {
    await page.waitForURL(auth.postLoginPattern, { timeout: 15_000, waitUntil: 'domcontentloaded' });
  } else {
    await page.waitForSelector(auth.logoutSelector, { timeout: 15_000 });
  }

  // Navigera vidare efter login om konfigurerat (t.ex. till /admin)
  if (auth.postLoginNavigate) {
    await page.goto(`${baseURL}${auth.postLoginNavigate}`);
    await page.waitForLoadState('domcontentloaded');
  }

  return page;
}

export async function logout(page, site) {
  const { auth } = site;
  await page.click(auth.logoutSelector);
  await page.waitForURL(auth.loginRedirectPattern);
}

export function validateCredentials(site) {
  const { username, password } = site.auth.credentials;
  const issues = [];

  if (!username) issues.push('Username saknas');
  if (!password) issues.push('Password saknas');
  if (password && password.includes('\\')) {
    issues.push('Password innehåller backslash – troligen felescapat i .env');
  }

  if (issues.length > 0) {
    console.warn(`⚠️  Credentials-problem för ${site.name}:`, issues.join(', '));
    return false;
  }
  return true;
}
