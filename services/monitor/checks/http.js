/**
 * HTTP Check — kontrollerar HTTP-status och svarstid
 *
 * Gör HEAD-request först (snabbare), fallback till GET vid 404/405.
 * Timeout: 10 sekunder.
 */

const TIMEOUT_MS = 10000;
const SLOW_THRESHOLD_MS = 5000;

export async function runHttpCheck(site) {
  const start = Date.now();

  try {
    // Försök HEAD först (snabbare, ingen body)
    let res = await fetch(site.url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // Fallback till GET om servern inte stödjer HEAD (404/405 vanligt i PHP)
    if (res.status === 404 || res.status === 405) {
      res = await fetch(site.url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    }

    const ms = Date.now() - start;
    const accepted = site.accepted_statuses ? JSON.parse(site.accepted_statuses) : null;
    const ok = accepted
      ? accepted.includes(res.status)
      : (res.status >= 200 && res.status < 400);

    let status = 'ok';
    if (!ok) status = 'critical';
    else if (ms > SLOW_THRESHOLD_MS) status = 'warning';

    return {
      siteId: site.id,
      type: 'http',
      status,
      responseMs: ms,
      statusCode: res.status,
      message: `HTTP ${res.status} (${ms}ms)`,
      details: {
        method: res.status === 405 ? 'GET' : 'HEAD',
        redirected: res.redirected,
        finalUrl: res.url,
      },
    };
  } catch (err) {
    const ms = Date.now() - start;
    const isTimeout = err.name === 'TimeoutError' || err.code === 'UND_ERR_CONNECT_TIMEOUT';

    return {
      siteId: site.id,
      type: 'http',
      status: 'critical',
      responseMs: ms,
      statusCode: null,
      message: isTimeout
        ? `Timeout efter ${ms}ms`
        : `Anslutningsfel: ${err.code || err.message}`,
      details: {
        error: err.code || err.message,
        timeout: isTimeout,
      },
    };
  }
}
