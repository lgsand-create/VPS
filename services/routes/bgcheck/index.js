/**
 * Routes: Bakgrundskontroll (/api/bgcheck)
 *
 * Monteras automatiskt av server.js via projekt-systemet.
 * API-nyckel + rate limiting appliceras INNAN dessa routes (via server.js).
 *
 * Säkerhetskedja (i ordning):
 *   1. validateApiKey    → autentisering, rate limit, loggning  (server.js)
 *   2. rateLimiter       → max req/min per nyckel               (server.js)
 *   3. verifyHmac        → payload-integritet + replay-skydd    (här)
 *
 * Endpoints:
 *   POST /api/bgcheck/verify    Verifiera utdrag
 *   GET  /api/bgcheck/status    Kö-status (diagnostik)
 */

import { Router } from 'express';
import { createHash } from 'crypto';
import { verifyHmac } from '../../middleware/hmac.js';
import { runCheck } from '../../background-check/check.js';
import { enqueue, queueStatus } from '../../background-check/queue.js';
import pool from '../../db/connection.js';

const router = Router();

// --- Endpoints ---

/**
 * POST /api/bgcheck/verify
 *
 * Headers:
 *   X-API-Key:   chub_...
 *   X-Timestamp: <unix-sekunder>
 *   X-Signature: HMAC-SHA256(timestamp.body, SHA256(apiKey))
 *
 * Body:
 * {
 *   "arendenummer":    "12345678",
 *   "personnummer":    "200001011234",
 *   "utfardandedatum": "2025-10-21",
 *   "utdragstyp":      "Arbete med barn i annan verksamhet än skola och barnomsorg"
 * }
 */
router.post('/verify', verifyHmac, async (req, res) => {
  // Förhindra cachning — svaret innehåller verifikations-PDF med PII
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const { arendenummer, personnummer, utfardandedatum, utdragstyp } = req.body;

  const missing = ['arendenummer', 'personnummer', 'utfardandedatum', 'utdragstyp']
    .filter(f => !req.body[f]);
  if (missing.length > 0) {
    return res.status(400).json({ error: 'Saknade fält', missing });
  }

  const pnrHash = createHash('sha256').update(personnummer).digest('hex').slice(0, 12);
  const keyId = req.apiKey?.id ?? null;
  const startMs = Date.now();

  console.log(`  [bgcheck] Kontroll initierad — ärende: ${arendenummer}, pnr: ${pnrHash}...`);

  try {
    const result = await enqueue(() =>
      runCheck({ arendenummer, personnummer, utfardandedatum, utdragstyp })
    );

    const responseMs = Date.now() - startMs;
    console.log(
      `  [bgcheck] Klar — ärende: ${arendenummer}, ` +
      `äkta: ${result.authentic}, varningar: ${result.warnings.join(',') || 'inga'}`
    );

    // Logga till bgc_verifications (icke-blockerande)
    // authentic: true→1, false→0, null→NULL (valideringsfel, aldrig skickat till Polisen)
    pool.execute(
      `INSERT INTO bgc_verifications
        (arendenummer, pnr_hash, utfardandedatum, authentic, verification_number, warnings, response_ms, key_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        arendenummer, pnrHash, utfardandedatum,
        result.authentic === true ? 1 : result.authentic === false ? 0 : null,
        result.verificationNumber,
        result.warnings.length > 0 ? result.warnings.join(',') : null,
        responseMs, keyId,
      ]
    ).catch(err => console.error('  [bgcheck] Loggningsfel:', err.message));

    res.json({
      authentic:          result.authentic,
      verificationNumber: result.verificationNumber,
      verificationPdf:    result.verificationPdf?.toString('base64') ?? null,
      checkedAt:          result.checkedAt,
      warnings:           result.warnings,
    });

  } catch (err) {
    const responseMs = Date.now() - startMs;

    // Logga fel till bgc_verifications
    pool.execute(
      `INSERT INTO bgc_verifications
        (arendenummer, pnr_hash, utfardandedatum, error_message, response_ms, key_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [arendenummer, pnrHash, utfardandedatum, (err.message || '').split('\n')[0].slice(0, 200), responseMs, keyId]
    ).catch(() => {});

    if (err.code === 'QUEUE_FULL' || err.code === 'QUEUE_TIMEOUT') {
      return res.status(503).json({ error: err.message });
    }
    if (err.code === 'CHECK_TIMEOUT') {
      return res.status(504).json({ error: err.message });
    }
    console.error(`  [bgcheck] Fel — ärende: ${arendenummer}:`, err.message);
    return res.status(500).json({ error: 'Internt fel vid bakgrundskontroll' });
  }
});

/**
 * GET /api/bgcheck/status
 * Diagnostik — visar kö-status. Ingen PII.
 */
router.get('/status', (req, res) => {
  res.json({
    service: 'bgcheck',
    queue: queueStatus(),
  });
});

/**
 * GET /api/bgcheck/stats
 * Aggregerad statistik från bgc_verifications (dashboard).
 * Kräver ingen HMAC — skyddas av dashboard-auth (same-origin bypass).
 */
router.get('/stats', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
        COUNT(*) AS verifieringar,
        SUM(authentic = 1) AS lyckade,
        SUM(authentic = 0) AS misslyckade,
        SUM(authentic IS NULL AND error_message IS NULL) AS ej_kontrollerade,
        SUM(error_message IS NOT NULL) AS fel,
        ROUND(AVG(response_ms)) AS snitt_ms,
        SUM(created_at >= CURDATE()) AS idag
      FROM bgc_verifications
    `);

    const queue = queueStatus();

    res.json({
      data: {
        verifieringar:      Number(rows[0].verifieringar)      || 0,
        lyckade:            Number(rows[0].lyckade)            || 0,
        misslyckade:        Number(rows[0].misslyckade)        || 0,
        ej_kontrollerade:   Number(rows[0].ej_kontrollerade)   || 0,
        fel:                Number(rows[0].fel)                || 0,
        snitt_ms:           Number(rows[0].snitt_ms)           || 0,
        idag:               Number(rows[0].idag)               || 0,
        ko_aktiv:           queue.running,
        ko_vantande:        queue.waiting,
      },
    });
  } catch (err) {
    console.error('  [bgcheck] Stats-fel:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta statistik' });
  }
});

/**
 * GET /api/bgcheck/log
 * Senaste verifieringar med ärendenummer, resultat, varningar. Ingen PII.
 */
router.get('/log', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);
  try {
    const [rows] = await pool.execute(`
      SELECT
        v.created_at,
        v.arendenummer,
        v.authentic,
        v.verification_number,
        v.warnings,
        v.response_ms,
        v.error_message,
        k.label AS key_label
      FROM bgc_verifications v
      LEFT JOIN api_keys k ON v.key_id = k.id
      ORDER BY v.created_at DESC
      LIMIT ?
    `, [limit]);

    res.json({ data: rows });
  } catch (err) {
    console.error('  [bgcheck] Log-fel:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta logg' });
  }
});

export default router;
