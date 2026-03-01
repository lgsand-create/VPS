/**
 * Canary Webhook — tar emot larm fran honeypots, canary tokens och klon-detektion
 *
 * OPPEN ENDPOINT (ingen API-nyckel) — valideras med per-sajt canary_token.
 * Monteras i server.js FORE API-key middleware.
 *
 * POST /webhooks/canary
 * Body: { token, type, meta }
 *   token  — canary_token fran mon_sites
 *   type   — 'honeypot' | 'clone' | 'dns' | 'canarytokens'
 *   meta   — { ip, path, userAgent, domain, ... }
 *
 * GET /webhooks/canary?memo=compuna:{siteId}:{token}&...
 *   Canarytokens.org webhook-format (skickar GET med query params)
 */

import { Router } from 'express';
import pool from '../../db/connection.js';
import { processCheckResult } from '../../monitor/incidents.js';

const router = Router();

// Enkel rate limit per IP — max 30 anrop per minut
const ipCounts = new Map();
setInterval(() => ipCounts.clear(), 60000);

/**
 * Karnlogik — validera token, spara check, trigga larm
 */
async function handleCanary(token, type, meta, sourceIp, userAgent) {
  // Validera token mot mon_sites
  const [sites] = await pool.execute(
    'SELECT id, name, url FROM mon_sites WHERE canary_token = ?',
    [token]
  );

  if (sites.length === 0) return null;

  const site = sites[0];
  const safeType = ['honeypot', 'clone', 'dns', 'canarytokens'].includes(type) ? type : 'unknown';

  const messages = {
    honeypot: `Honeypot traffad: ${meta?.path || 'okand sokvag'} fran IP ${meta?.ip || sourceIp}`,
    clone: `Sajtklon detekterad! ${site.name} laddades fran obehorig doman: ${meta?.domain || 'okand'}`,
    dns: `DNS canary token utlost — nagon har last konfigurationsfiler`,
    canarytokens: `Canarytoken utlost: ${meta?.memo || meta?.type || 'okand typ'}`,
    unknown: `Canary-larm: ${JSON.stringify(meta || {})}`,
  };

  const result = {
    siteId: site.id,
    type: 'canary',
    status: 'critical',
    responseMs: null,
    statusCode: null,
    message: messages[safeType],
    details: {
      canaryType: safeType,
      sourceIp: meta?.ip || sourceIp,
      userAgent: userAgent,
      path: meta?.path || null,
      domain: meta?.domain || null,
      raw: meta || null,
      receivedAt: new Date().toISOString(),
    },
  };

  // Spara som check-resultat
  await pool.execute(
    `INSERT INTO mon_checks (site_id, check_type, status, response_ms, status_code, message, details)
     VALUES (?, 'canary', 'critical', NULL, NULL, ?, ?)`,
    [site.id, result.message, JSON.stringify(result.details)]
  );

  // Bearbeta via incident-systemet (omedelbart larm)
  await processCheckResult(result);

  console.log(`  [CANARY] ${safeType} — ${site.id}: ${messages[safeType]}`);
  return site;
}

/**
 * POST /webhooks/canary — anropas fran honeypot-filer och JS-snippets
 *
 * Accepterar tva payload-format:
 *   Nested:  { token, type, meta: { ip, path, ... } }
 *   Flat:    { token, type, ip, request_uri, user_agent, domain, ... }
 */
router.post('/', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  const count = (ipCounts.get(ip) || 0) + 1;
  ipCounts.set(ip, count);
  if (count > 30) return res.status(429).json({ error: 'Rate limit' });

  const body = req.body || {};
  const { token, type } = body;
  if (!token || !type) return res.status(404).json({ error: 'Not found' });

  // Normalisera: flat payload → meta-objekt
  const meta = body.meta || {
    ip: body.ip || null,
    path: body.request_uri || body.path || null,
    userAgent: body.user_agent || body.userAgent || null,
    domain: body.domain || body.host || null,
    fullUrl: body.url || null,
    referer: body.referrer || body.referer || null,
    method: body.method || null,
    timestamp: body.timestamp || null,
  };

  try {
    const site = await handleCanary(token, type, meta, ip, req.headers['user-agent']);
    if (!site) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(`  [CANARY] Webhook-fel: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /webhooks/canary — canarytokens.org skickar GET med query params
 * memo-format: "compuna:{canaryToken}"
 */
router.get('/', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  const count = (ipCounts.get(ip) || 0) + 1;
  ipCounts.set(ip, count);
  if (count > 30) return res.status(429).json({ error: 'Rate limit' });

  const { memo, src_data, token_type } = req.query;
  if (!memo || !memo.startsWith('compuna:')) {
    return res.status(404).json({ error: 'Not found' });
  }

  const token = memo.replace('compuna:', '');
  if (!token) return res.status(404).json({ error: 'Not found' });

  try {
    const meta = { type: token_type, memo, srcData: src_data };
    const site = await handleCanary(token, 'canarytokens', meta, ip, req.headers['user-agent']);
    if (!site) return res.status(404).json({ error: 'Not found' });
    // Canarytokens forvanter en 200 (annars retry)
    res.send('ok');
  } catch (err) {
    console.error(`  [CANARY] Canarytokens webhook-fel: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
