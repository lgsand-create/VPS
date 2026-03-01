/**
 * Security Headers Check — kontrollerar säkerhetsrelaterade HTTP-headers
 *
 * Kollar: HSTS, CSP, X-Frame-Options, X-Content-Type-Options,
 *         Referrer-Policy, Permissions-Policy
 *
 * Betygsätter A-F baserat på antal headers som finns.
 */

const TIMEOUT_MS = 10000;

const SECURITY_HEADERS = [
  {
    name: 'Strict-Transport-Security',
    key: 'hsts',
    description: 'Tvingar HTTPS',
    critical: true,
  },
  {
    name: 'Content-Security-Policy',
    key: 'csp',
    description: 'Skyddar mot XSS/injection',
    critical: true,
  },
  {
    name: 'X-Frame-Options',
    key: 'x_frame',
    description: 'Skyddar mot clickjacking',
    critical: false,
  },
  {
    name: 'X-Content-Type-Options',
    key: 'x_content_type',
    description: 'Förhindrar MIME-sniffing',
    critical: false,
  },
  {
    name: 'Referrer-Policy',
    key: 'referrer',
    description: 'Kontrollerar referrer-info',
    critical: false,
  },
  {
    name: 'Permissions-Policy',
    key: 'permissions',
    description: 'Begränsar browser-API:er',
    critical: false,
  },
];

export async function runHeadersCheck(site) {
  const start = Date.now();

  try {
    const res = await fetch(site.url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - start;

    const results = {};
    let present = 0;
    let criticalMissing = 0;

    for (const header of SECURITY_HEADERS) {
      const value = res.headers.get(header.name);
      results[header.key] = {
        present: !!value,
        value: value ? (value.length > 200 ? value.slice(0, 200) + '...' : value) : null,
        critical: header.critical,
        description: header.description,
      };
      if (value) present++;
      else if (header.critical) criticalMissing++;
    }

    // Kolla också efter farliga headers som bör saknas
    const serverHeader = res.headers.get('Server');
    const poweredBy = res.headers.get('X-Powered-By');
    results.info_leak = {
      server: serverHeader || null,
      powered_by: poweredBy || null,
      leaking: !!(serverHeader || poweredBy),
    };

    const total = SECURITY_HEADERS.length;
    const score = Math.round((present / total) * 100);

    // Betygsättning
    let grade, status;
    if (score >= 83) { grade = 'A'; status = 'ok'; }
    else if (score >= 67) { grade = 'B'; status = 'ok'; }
    else if (score >= 50) { grade = 'C'; status = 'warning'; }
    else if (score >= 33) { grade = 'D'; status = 'warning'; }
    else { grade = 'F'; status = 'critical'; }

    // Uppgradera till critical om viktiga headers saknas
    if (criticalMissing > 0 && status === 'ok') status = 'warning';

    const missing = SECURITY_HEADERS.filter(h => !res.headers.get(h.name)).map(h => h.name);

    return {
      siteId: site.id,
      type: 'headers',
      status,
      responseMs: ms,
      statusCode: res.status,
      message: `Säkerhetsheaders: ${grade} (${present}/${total}) ${missing.length > 0 ? '— saknar: ' + missing.join(', ') : ''}`,
      details: {
        grade,
        score,
        present,
        total,
        missing,
        headers: results,
      },
    };
  } catch (err) {
    const ms = Date.now() - start;
    return {
      siteId: site.id,
      type: 'headers',
      status: 'error',
      responseMs: ms,
      statusCode: null,
      message: `Headers-check misslyckades: ${err.message}`,
      details: { error: err.message },
    };
  }
}
