/**
 * PWA Monitor — /api/pwa
 *
 * PIN-baserad autentisering + read-only monitor-endpoints
 * för PWA-mobilappen. Helt skild från dashboard-sessioner
 * och API-nyckel-systemet.
 */

import { Router } from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import pool from '../db/connection.js';
import { getSettings } from '../db/settings.js';

const router = Router();

// --- Session-hantering ---

const sessions = new Map();
const SESSION_COOKIE = 'pwa_session';
const DEFAULT_SESSION_DAYS = 30;

function getSessionTtl(settings) {
  const days = parseInt(settings?.session_days) || DEFAULT_SESSION_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

// Rensa utgångna sessioner var 6:e timme
setInterval(async () => {
  const now = Date.now();
  let ttl;
  try {
    const s = await getSettings('pwa');
    ttl = getSessionTtl(s);
  } catch { ttl = DEFAULT_SESSION_DAYS * 24 * 60 * 60 * 1000; }
  for (const [token, session] of sessions) {
    if (now - session.created > ttl) sessions.delete(token);
  }
}, 6 * 60 * 60 * 1000);

// --- Brute-force-skydd ---

const loginAttempts = new Map(); // ip → { count, firstAttempt }
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW = 10 * 60 * 1000;  // 10 min
const LOCKOUT_TIME = 15 * 60 * 1000;    // 15 min

function isLockedOut(ip) {
  const record = loginAttempts.get(ip);
  if (!record) return false;
  const elapsed = Date.now() - record.firstAttempt;
  // Rensa gamla records
  if (elapsed > ATTEMPT_WINDOW + LOCKOUT_TIME) {
    loginAttempts.delete(ip);
    return false;
  }
  return record.count >= MAX_ATTEMPTS && elapsed < ATTEMPT_WINDOW + LOCKOUT_TIME;
}

function recordFailedAttempt(ip) {
  const record = loginAttempts.get(ip);
  const now = Date.now();
  if (!record || now - record.firstAttempt > ATTEMPT_WINDOW + LOCKOUT_TIME) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    record.count++;
  }
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

// --- Hjälpfunktioner ---

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return cookies;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function hashPin(pin) {
  return createHash('sha256').update(String(pin)).digest('hex');
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token || !sessions.has(token)) return false;
  const session = sessions.get(token);
  const ttl = getSessionTtl(session.settings);
  if (Date.now() - session.created > ttl) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requirePwaAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'Ej inloggad' });
}

// --- Auth-endpoints ---

// POST /api/pwa/auth — PIN-inloggning
router.post('/auth', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;

    if (isLockedOut(ip)) {
      return res.status(429).json({ error: 'För många försök — vänta 15 minuter' });
    }

    // Kolla att PWA är aktiverad
    const pwaSettings = await getSettings('pwa');
    if (pwaSettings.enabled !== 'true') {
      return res.status(403).json({ error: 'Monitorappen är inte aktiverad' });
    }

    const storedHash = pwaSettings.pin_hash;
    if (!storedHash) {
      return res.status(403).json({ error: 'Ingen PIN-kod har konfigurerats' });
    }

    const { pin } = req.body || {};
    if (!pin) {
      return res.status(400).json({ error: 'PIN-kod saknas' });
    }

    const inputHash = hashPin(pin);

    if (!safeEqual(inputHash, storedHash)) {
      recordFailedAttempt(ip);
      return res.status(401).json({ error: 'Fel PIN-kod' });
    }

    // Lyckad inloggning
    clearAttempts(ip);
    const token = randomBytes(32).toString('hex');
    const ttl = getSessionTtl(pwaSettings);
    sessions.set(token, { created: Date.now(), settings: pwaSettings });

    res.setHeader('Set-Cookie',
      `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(ttl / 1000)}`
    );
    res.json({
      ok: true,
      config: { refresh_seconds: parseInt(pwaSettings.refresh_seconds) || 60 },
    });
  } catch (err) {
    console.error('  [PWA] Auth-fel:', err.message);
    res.status(500).json({ error: 'Inloggning misslyckades' });
  }
});

// GET /api/pwa/auth/status
router.get('/auth/status', async (req, res) => {
  const authed = isAuthenticated(req);
  if (authed) {
    try {
      const s = await getSettings('pwa');
      return res.json({
        authenticated: true,
        config: { refresh_seconds: parseInt(s.refresh_seconds) || 60 },
      });
    } catch { /* fallback */ }
  }
  res.json({ authenticated: authed });
});

// POST /api/pwa/auth/logout
router.post('/auth/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);

  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
  res.json({ ok: true });
});

// --- Data-endpoints (kräver PWA-session) ---

// GET /api/pwa/sites — Alla sajter med status
router.get('/sites', requirePwaAuth, async (req, res) => {
  try {
    const [sites] = await pool.execute(`
      SELECT s.id, s.name, s.url, s.status,
        (SELECT COUNT(*) FROM mon_incidents WHERE site_id = s.id AND status = 'open') AS open_incidents,
        (SELECT response_ms FROM mon_checks WHERE site_id = s.id AND check_type = 'http'
         ORDER BY checked_at DESC LIMIT 1) AS last_response_ms,
        (SELECT checked_at FROM mon_checks WHERE site_id = s.id AND check_type = 'http'
         ORDER BY checked_at DESC LIMIT 1) AS last_http_check
      FROM mon_sites s
      WHERE s.enabled = TRUE
      ORDER BY s.name
    `);

    res.json({ data: sites });
  } catch (err) {
    console.error('  [PWA] Sites-fel:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta sajter' });
  }
});

// GET /api/pwa/sites/:id — Detaljerad sajtstatus
router.get('/sites/:id', requirePwaAuth, async (req, res) => {
  try {
    const [sites] = await pool.execute(
      'SELECT * FROM mon_sites WHERE id = ?',
      [req.params.id]
    );

    if (sites.length === 0) {
      return res.status(404).json({ error: 'Sajt ej funnen' });
    }

    // Senaste check per typ
    const [latestChecks] = await pool.execute(`
      SELECT c.* FROM mon_checks c
      INNER JOIN (
        SELECT check_type, MAX(id) AS max_id
        FROM mon_checks WHERE site_id = ?
        GROUP BY check_type
      ) latest ON c.id = latest.max_id
    `, [req.params.id]);

    // Öppna incidenter
    const [openIncidents] = await pool.execute(
      `SELECT * FROM mon_incidents
       WHERE site_id = ? AND status IN ('open', 'acknowledged')
       ORDER BY opened_at DESC`,
      [req.params.id]
    );

    // Senaste 24h HTTP-checks (för svarstidsgraf)
    const [recentChecks] = await pool.execute(`
      SELECT checked_at, response_ms, status
      FROM mon_checks
      WHERE site_id = ? AND check_type = 'http'
        AND checked_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY checked_at ASC
    `, [req.params.id]);

    // Uptime-statistik (24h, 7d, 30d)
    const uptimeStats = {};
    for (const [label, interval] of [['24h', '24 HOUR'], ['7d', '7 DAY'], ['30d', '30 DAY']]) {
      const [rows] = await pool.execute(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok_count,
          ROUND(AVG(response_ms)) AS avg_ms,
          MAX(response_ms) AS max_ms,
          MIN(response_ms) AS min_ms
        FROM mon_checks
        WHERE site_id = ? AND check_type = 'http'
          AND checked_at > DATE_SUB(NOW(), INTERVAL ${interval})
      `, [req.params.id]);
      const r = rows[0];
      uptimeStats[label] = {
        total: r.total || 0,
        ok: r.ok_count || 0,
        pct: r.total > 0 ? ((r.ok_count / r.total) * 100).toFixed(2) : null,
        avgMs: r.avg_ms,
        maxMs: r.max_ms,
        minMs: r.min_ms,
      };
    }

    // Dagliga metrics (senaste 30 dagar)
    const [dailyMetrics] = await pool.execute(`
      SELECT date, uptime_pct, avg_response_ms, max_response_ms, min_response_ms,
             total_checks, failed_checks, incidents
      FROM mon_daily_metrics
      WHERE site_id = ?
      ORDER BY date DESC
      LIMIT 30
    `, [req.params.id]);

    res.json({
      data: {
        site: sites[0],
        latestChecks,
        openIncidents,
        recentChecks,
        uptimeStats,
        dailyMetrics: dailyMetrics.reverse(),
      },
    });
  } catch (err) {
    console.error('  [PWA] Site-detalj-fel:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta sajtdetaljer' });
  }
});

export default router;
