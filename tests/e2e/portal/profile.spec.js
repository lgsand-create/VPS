/**
 * E2E – Min Profil (/portal/profile)
 *
 * Visa profil, redigera, byt lösenord.
 */
import { test, expect } from '../fixtures.js';
import { getActiveSite } from '../../../sites/index.js';
import { assertNo500, expectError } from '../helpers/e2e-helpers.js';

const site = getActiveSite();
const baseURL = site.baseURL;

test.describe('Min Profil', () => {
  test('profilsidan laddar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/profile`);
    await assertNo500(page);
  });

  test('användarinfo visas', async ({ page }) => {
    await page.goto(`${baseURL}/portal/profile`);

    const body = await page.textContent('body');
    // Minst namn eller email bör visas
    expect(body.length).toBeGreaterThan(50);
  });

  test('redigera-sidan laddar', async ({ page }) => {
    await page.goto(`${baseURL}/portal/profile/edit`);
    await assertNo500(page);

    const form = page.locator('form');
    await expect(form.first()).toBeVisible();
  });

  test('email-fält är skyddat', async ({ page }) => {
    await page.goto(`${baseURL}/portal/profile/edit`);

    const emailField = page.locator('#email, input[type="email"]').first();
    if (await emailField.isVisible().catch(() => false)) {
      const isReadonly = await emailField.getAttribute('readonly');
      const isDisabled = await emailField.isDisabled();
      // Email bör vara readonly eller disabled
      expect(isReadonly !== null || isDisabled, 'Email-fält borde vara skyddat').toBe(true);
    }
  });

  test('formulär visar befintlig data förifylld', async ({ page }) => {
    await page.goto(`${baseURL}/portal/profile/edit`);

    // Om vi hamnat på login (session expired), skippa
    if (page.url().includes('/login')) {
      test.skip(true, 'Portal-session har gått ut');
    }

    // Minst ett fält bör ha förifyllt värde (text, email, tel, eller hidden)
    const inputs = page.locator('input[type="text"], input[type="email"], input[type="tel"], input[type="hidden"]');
    const count = await inputs.count();

    let hasValue = false;
    for (let i = 0; i < Math.min(count, 10); i++) {
      const val = await inputs.nth(i).inputValue().catch(() => '');
      if (val.length > 0) {
        hasValue = true;
        break;
      }
    }
    expect(hasValue, 'Inga förifyllda fält').toBe(true);
  });

  test('byt lösenord: felaktigt nuvarande → fel', async ({ page }) => {
    await page.goto(`${baseURL}/portal/profile/edit`);

    const currentPw = page.locator('#current_password, input[name="current_password"]').first();
    const newPw = page.locator('#new_password, input[name="new_password"]').first();
    const confirmPw = page.locator('#password_confirm, input[name="password_confirm"]').first();

    if (await currentPw.isVisible().catch(() => false)) {
      await currentPw.fill('fel_lösenord_999');
      if (await newPw.isVisible().catch(() => false)) {
        await newPw.fill('NyttLösenord123!');
      }
      if (await confirmPw.isVisible().catch(() => false)) {
        await confirmPw.fill('NyttLösenord123!');
      }

      await page.click('button[type="submit"]');
      await page.waitForTimeout(2_000);

      // Borde visa fel eller stanna kvar
      const url = page.url();
      expect(url).toMatch(/profile/);
    }
  });
});
