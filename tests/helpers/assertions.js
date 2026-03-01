export const VALID_STATUS_CODES = [200, 302, 303, 403];

export async function assertPageLoads(page, url, options = {}) {
  const validStatuses = options.validStatuses || VALID_STATUS_CODES;

  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });

  if (!response) {
    throw new Error(`Inget svar från ${url}`);
  }

  const status = response.status();
  const skipped = status === 403;

  if (!validStatuses.includes(status)) {
    throw new Error(
      `${url} svarade med ${status} (förväntat: ${validStatuses.join(', ')})`
    );
  }

  return { status, url: page.url(), skipped };
}

export async function assertNoHorizontalOverflow(page) {
  return page.evaluate(() => {
    const hasOverflow =
      document.documentElement.scrollWidth > document.documentElement.clientWidth;

    const overflowing = [];
    if (hasOverflow) {
      const vw = window.innerWidth;
      for (const el of document.querySelectorAll('body *')) {
        const rect = el.getBoundingClientRect();
        if (rect.right > vw + 20 && rect.width > 0) {
          overflowing.push({
            tag: el.tagName,
            class: el.className?.toString().slice(0, 60),
            right: Math.round(rect.right),
          });
          if (overflowing.length >= 5) break;
        }
      }
    }

    return { hasOverflow, overflowing };
  });
}

export async function collectJsErrors(page, url, options = {}) {
  const errors = [];
  const ignorePatterns = options.ignorePatterns || [
    'favicon', 'net::ERR_', 'Mixed Content', 'third-party', 'Failed to load resource',
  ];

  const onConsole = (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  };
  const onError = (err) => {
    errors.push(err.message);
  };

  page.on('console', onConsole);
  page.on('pageerror', onError);

  const response = await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  page.off('console', onConsole);
  page.off('pageerror', onError);

  const critical = errors.filter(
    (e) => !ignorePatterns.some((p) => e.includes(p))
  );

  return {
    status: response?.status(),
    allErrors: errors,
    criticalErrors: critical,
  };
}
