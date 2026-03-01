/**
 * Health Check — pollar /api/health.php pa varje sajt
 *
 * Skickar nyckel som HTTP-header (X-Monitor-Key), aldrig som query param.
 * Skickar check-instruktioner (admin_users, watch_tables) som POST-body.
 * Health-endpointen returnerar JSON med serverstatus.
 */

import { getProject } from '../../projects/index.js';

const TIMEOUT_MS = 15000;

/**
 * Hamta healthConfig for en sajt fran projektkonfig
 * Mergar in expected fran DB (site.health_expected_admins) om det finns
 */
function getHealthConfig(siteId, site) {
  try {
    const project = getProject('monitor');
    const siteConfig = project.sites.find(s => s.id === siteId);
    const config = JSON.parse(JSON.stringify(siteConfig?.healthConfig || {}));

    // Overskrid expected med vardet fran DB (editerbart via dashboarden)
    if (config.admin_users && site.health_expected_admins > 0) {
      config.admin_users.expected = site.health_expected_admins;
    }

    return config;
  } catch {
    return {};
  }
}

export async function runHealthCheck(site) {
  const secret = site.health_secret;
  if (!secret) {
    return {
      siteId: site.id,
      type: 'health',
      status: 'error',
      responseMs: null,
      statusCode: null,
      message: `Health-nyckel ej konfigurerad`,
      details: { hint: 'Ange nyckel i dashboarden eller via env-variabel' },
    };
  }

  const start = Date.now();

  try {
    // Hamta check-instruktioner fran projektkonfig (expected fran DB)
    const healthConfig = getHealthConfig(site.id, site);
    const hasInstructions = Object.keys(healthConfig).length > 0;

    const fetchOptions = {
      headers: { 'X-Monitor-Key': secret },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    };

    // POST med instruktioner om det finns, annars GET
    if (hasInstructions) {
      fetchOptions.method = 'POST';
      fetchOptions.headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(healthConfig);
    } else {
      fetchOptions.method = 'GET';
    }

    const res = await fetch(site.health_url, fetchOptions);

    const ms = Date.now() - start;

    // 404 = endpointen finns inte annu (ej deployerad)
    if (res.status === 404) {
      return {
        siteId: site.id,
        type: 'health',
        status: 'warning',
        responseMs: ms,
        statusCode: 404,
        message: `Health-endpoint ej deployerad (404)`,
        details: { url: site.health_url },
      };
    }

    if (!res.ok) {
      return {
        siteId: site.id,
        type: 'health',
        status: 'critical',
        responseMs: ms,
        statusCode: res.status,
        message: `Health-endpoint svarade ${res.status}`,
        details: { statusCode: res.status },
      };
    }

    const data = await res.json();

    // health.php returnerar { status: 'ok'|'warning'|'critical', checks: {...} }
    const healthStatus = data.status || 'ok';

    return {
      siteId: site.id,
      type: 'health',
      status: healthStatus,
      responseMs: ms,
      statusCode: res.status,
      message: `Health: ${healthStatus} (${ms}ms)`,
      details: data,
    };
  } catch (err) {
    const ms = Date.now() - start;
    const isTimeout = err.name === 'TimeoutError';

    return {
      siteId: site.id,
      type: 'health',
      status: 'critical',
      responseMs: ms,
      statusCode: null,
      message: isTimeout
        ? `Health-endpoint timeout (${ms}ms)`
        : `Health-endpoint otillganglig: ${err.code || err.message}`,
      details: { error: err.code || err.message, timeout: isTimeout },
    };
  }
}
