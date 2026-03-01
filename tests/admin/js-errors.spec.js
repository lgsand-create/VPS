import { test, expect } from '@playwright/test';
import { collectJsErrors } from '../helpers/assertions.js';
import { getActiveSite } from '../../sites/index.js';

const site = getActiveSite();

test.describe(`[${site.name}] JavaScript-felkontroll`, () => {
  for (const path of site.criticalPages || []) {
    test(`${path} – inga kritiska JS-fel`, async ({ page }) => {
      const { status, criticalErrors } = await collectJsErrors(
        page,
        `${site.baseURL}${path}`
      );

      if (status === 403) {
        test.skip();
        return;
      }

      expect(
        criticalErrors,
        `JS-fel på ${path}:\n${criticalErrors.join('\n')}`
      ).toHaveLength(0);
    });
  }
});
