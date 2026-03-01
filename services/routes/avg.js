/**
 * Västtrafik PWA Routes — Öppna endpoints för /avg/ appen
 *
 * Ingen auth krävs. Avgångsdata serveras från memory-cache
 * (inga extra API-anrop triggas). Enkel IP-rate-limit.
 */

import { Router } from 'express';
import pool from '../db/connection.js';
import { getCachedDepartures, fetchDepartures, fetchJourneyDetails, searchStops } from '../vasttrafik/api.js';
import { getVapidPublicKey } from '../vasttrafik/push.js';

const router = Router();

// --- Enkel IP-baserad rate limiting ---
const ipRequests = new Map();
const IP_LIMIT = 120;  // max anrop per minut
const IP_WINDOW = 60_000;

function rateLimitByIp(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();

  let entry = ipRequests.get(ip);
  if (!entry || now - entry.windowStart > IP_WINDOW) {
    entry = { windowStart: now, count: 0 };
    ipRequests.set(ip, entry);
  }

  entry.count++;
  if (entry.count > IP_LIMIT) {
    return res.status(429).json({ error: 'För många förfrågningar — vänta en minut' });
  }

  next();
}

// Rensa gamla IP-entries var 5:e minut
setInterval(() => {
  const cutoff = Date.now() - IP_WINDOW * 2;
  for (const [ip, entry] of ipRequests) {
    if (entry.windowStart < cutoff) ipRequests.delete(ip);
  }
}, 5 * 60_000);

router.use(rateLimitByIp);

// GET /api/avg/stops — Lista aktiva hållplatser
router.get('/stops', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, stop_area_gid, latitude, longitude FROM vt_stops WHERE enabled = TRUE ORDER BY sort_order, name'
    );
    const data = rows.map(r => ({ ...r, name: r.name.replace(/, Göteborg$/i, '') }));
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte hämta hållplatser' });
  }
});

// GET /api/avg/stops/search — Sök hållplatser (proxy till Västtrafik)
router.get('/stops/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Sökord krävs (minst 2 tecken)' });
    }

    const results = await searchStops(q);
    const stops = results
      .filter(r => r.gid && r.name)
      .map(r => ({ gid: r.gid, name: r.name }));

    res.json({ data: stops });
  } catch (err) {
    res.status(500).json({ error: 'Sökning misslyckades' });
  }
});

// Helper: Mappa Västtrafik departure till enklare format
function mapDeparture(d) {
  const line = d.serviceJourney?.line || d.line || {};
  const scheduledAt = d.plannedTime || d.time;
  const estimatedAt = d.estimatedTime || d.rtTime;
  let delaySeconds = 0;
  if (scheduledAt && estimatedAt) {
    delaySeconds = Math.round((new Date(estimatedAt) - new Date(scheduledAt)) / 1000);
  }

  return {
    journeyId: d.detailsReference || d.journeyId || null,
    line: line.shortName || line.designation || d.sname || line.name || '?',
    direction: d.serviceJourney?.direction || d.direction || '',
    scheduledAt,
    estimatedAt,
    delaySeconds,
    isCancelled: d.isCancelled || false,
    track: d.stopPoint?.platform || d.track || null,
    fgColor: line.foregroundColor || d.fgColor || null,
    bgColor: line.backgroundColor || d.bgColor || null,
    transportType: line.transportMode || d.type || null,
  };
}

// GET /api/avg/departures — Avgångar från memory-cache
router.get('/departures', async (req, res) => {
  try {
    const stopIds = req.query.stop ? [].concat(req.query.stop) : [];

    // Om inga stops angetts, hämta alla aktiva
    let stopRows;
    if (stopIds.length === 0) {
      const [rows] = await pool.execute(
        'SELECT id, stop_area_gid, name FROM vt_stops WHERE enabled = TRUE ORDER BY sort_order'
      );
      stopRows = rows;
    } else {
      const placeholders = stopIds.map(() => '?').join(',');
      const [rows] = await pool.execute(
        `SELECT id, stop_area_gid, name FROM vt_stops WHERE id IN (${placeholders})`,
        stopIds
      );
      stopRows = rows;
    }

    const result = {};
    for (const stop of stopRows) {
      const cached = getCachedDepartures(stop.stop_area_gid);
      const departures = cached?.results || cached?.departures || [];

      result[stop.id] = {
        name: stop.name.replace(/, Göteborg$/i, ''),
        departures: departures.map(mapDeparture),
      };
    }

    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte hämta avgångar' });
  }
});

// GET /api/avg/departures/gid — Avgångar via stop_area_gid (on-demand, för egna hållplatser)
router.get('/departures/gid', async (req, res) => {
  try {
    const gids = req.query.gid ? [].concat(req.query.gid) : [];
    if (gids.length === 0) {
      return res.status(400).json({ error: 'Minst en gid krävs' });
    }
    if (gids.length > 5) {
      return res.status(400).json({ error: 'Max 5 hållplatser per anrop' });
    }

    // Validera GID-format
    for (const gid of gids) {
      if (!/^\d{10,20}$/.test(gid)) {
        return res.status(400).json({ error: `Ogiltigt gid: ${gid}` });
      }
    }

    const result = {};
    for (const gid of gids) {
      let cached = getCachedDepartures(gid);
      if (!cached) {
        cached = await fetchDepartures(gid);
      }
      const departures = cached?.results || cached?.departures || [];

      result[gid] = {
        name: gid,
        departures: departures.map(mapDeparture),
      };
    }

    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte hämta avgångar' });
  }
});

// GET /api/avg/journey-details — Hämta alla hållplatser längs sträckan med tider
router.get('/journey-details', async (req, res) => {
  try {
    const { stop, ref } = req.query;
    if (!stop || !ref) {
      return res.status(400).json({ error: 'stop och ref krävs' });
    }

    // stop kan vara ett DB-id (preset) eller ett GID (custom)
    let stopAreaGid = stop;

    // Om det inte ser ut som ett GID, slå upp från DB
    if (!/^\d{10,20}$/.test(stop)) {
      const [rows] = await pool.execute(
        'SELECT stop_area_gid FROM vt_stops WHERE id = ?', [stop]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Hållplats ej hittad' });
      }
      stopAreaGid = rows[0].stop_area_gid;
    }

    const data = await fetchJourneyDetails(stopAreaGid, ref);

    // Extrahera callsOnServiceJourney (alla hållplatser längs sträckan)
    // API returnerar: { serviceJourneys: [{ callsOnServiceJourney: [...], line: {...}, ... }] }
    const journey = data?.serviceJourneys?.[0] || data?.serviceJoureys?.[0] || null;
    const calls = journey?.callsOnServiceJourney || [];
    const line = journey?.line || {};

    const stops = calls.map(c => ({
      name: (c.stopPoint?.stopArea?.name || c.stopPoint?.name || '—').replace(/, Göteborg$/i, ''),
      gid: c.stopPoint?.stopArea?.gid || null,
      plannedArrival: c.plannedArrivalTime || null,
      plannedDeparture: c.plannedDepartureTime || null,
      estimatedArrival: c.estimatedArrivalTime || null,
      estimatedDeparture: c.estimatedDepartureTime || null,
      isCancelled: c.isCancelled || false,
      platform: c.plannedPlatform || null,
    }));

    res.json({
      data: {
        line: line.shortName || line.designation || line.name || '?',
        direction: journey?.direction || '',
        bgColor: line.backgroundColor || null,
        fgColor: line.foregroundColor || null,
        stops,
      },
    });
  } catch (err) {
    console.error('Journey details error:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta sträckan' });
  }
});

// POST /api/avg/stops/favorite — Logga att en hållplats lagts till som favorit (statistik)
router.post('/stops/favorite', async (req, res) => {
  try {
    const { gid, name } = req.body || {};
    if (!gid || !name) {
      return res.status(400).json({ error: 'gid och name krävs' });
    }
    if (!/^\d{10,20}$/.test(gid)) {
      return res.status(400).json({ error: 'Ogiltigt gid' });
    }

    await pool.execute(`
      INSERT INTO vt_stop_favorites (stop_area_gid, stop_name, added_count, last_added_at)
      VALUES (?, ?, 1, NOW())
      ON DUPLICATE KEY UPDATE added_count = added_count + 1, last_added_at = NOW()
    `, [gid, name.substring(0, 200)]);

    res.json({ ok: true });
  } catch (err) {
    // Misslyckas tyst — statistik ska inte blocka UX
    res.json({ ok: true });
  }
});

// GET /api/avg/line-history — Historik för en linje vid en hållplats
router.get('/line-history', async (req, res) => {
  try {
    const { stop, line } = req.query;
    if (!stop || !line) {
      return res.status(400).json({ error: 'stop och line krävs' });
    }

    // Daglig statistik senaste 7 dagarna
    const [daily] = await pool.execute(`
      SELECT date, total_departures, delayed_count,
             avg_delay_seconds, on_time_pct
      FROM vt_daily_metrics
      WHERE stop_id = ? AND line_name = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      ORDER BY date DESC
    `, [stop, line]);

    // Senaste 5 avgångarna
    const [recent] = await pool.execute(`
      SELECT scheduled_at, delay_seconds, is_cancelled
      FROM vt_departures
      WHERE stop_id = ? AND line_name = ?
      ORDER BY scheduled_at DESC
      LIMIT 5
    `, [stop, line]);

    // Totalt snitt
    const [summary] = await pool.execute(`
      SELECT
        ROUND(AVG(avg_delay_seconds)) AS avg_delay,
        ROUND(AVG(on_time_pct), 1) AS avg_on_time
      FROM vt_daily_metrics
      WHERE stop_id = ? AND line_name = ?
    `, [stop, line]);

    res.json({
      data: {
        daily,
        recent,
        summary: summary[0] || null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte hämta historik' });
  }
});

// GET /api/avg/departure-tracking — Delay-tidslinje för en specifik avgång
router.get('/departure-tracking', async (req, res) => {
  try {
    const { journey, stop } = req.query;
    if (!journey || !stop) {
      return res.status(400).json({ error: 'journey och stop krävs' });
    }

    const [rows] = await pool.execute(`
      SELECT delay_seconds, is_cancelled, observed_at, scheduled_at, estimated_at
      FROM vt_departure_tracking
      WHERE journey_id = ? AND stop_id = ?
      ORDER BY observed_at ASC
    `, [journey, stop]);

    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte hämta tracking-data' });
  }
});

// GET /api/avg/push/vapid-key — VAPID public key för push-prenumeration
router.get('/push/vapid-key', async (req, res) => {
  try {
    const key = await getVapidPublicKey();
    if (!key) {
      return res.status(503).json({ error: 'Push-notiser ej konfigurerade' });
    }
    res.json({ publicKey: key });
  } catch {
    res.status(503).json({ error: 'Push-notiser ej konfigurerade' });
  }
});

// POST /api/avg/push/subscribe — Registrera push-prenumeration
router.post('/push/subscribe', async (req, res) => {
  try {
    const { subscription, stopIds, lineFilters, delayThreshold } = req.body;

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: 'Ogiltig prenumeration' });
    }

    const threshold = Math.max(60, Math.min(600, parseInt(delayThreshold || '180')));

    await pool.execute(`
      INSERT INTO vt_push_subscriptions (endpoint, p256dh, auth_key, stop_ids, line_filters, delay_threshold)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        p256dh = VALUES(p256dh),
        auth_key = VALUES(auth_key),
        stop_ids = VALUES(stop_ids),
        line_filters = VALUES(line_filters),
        delay_threshold = VALUES(delay_threshold),
        consecutive_failures = 0,
        last_used_at = NOW()
    `, [
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      JSON.stringify(stopIds || []),
      JSON.stringify(lineFilters || []),
      threshold,
    ]);

    res.json({ ok: true, message: 'Prenumeration registrerad' });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte spara prenumeration' });
  }
});

// POST /api/avg/push/unsubscribe — Avregistrera
router.post('/push/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint krävs' });
    }

    await pool.execute(
      'DELETE FROM vt_push_subscriptions WHERE endpoint = ?',
      [endpoint]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte avregistrera' });
  }
});

// POST /api/avg/watch — Bevaka en avgång
router.post('/watch', async (req, res) => {
  try {
    const { endpoint, journeyId, stopId, lineName, direction, scheduledAt, delayThreshold } = req.body;
    if (!endpoint || !journeyId || !stopId || !scheduledAt) {
      return res.status(400).json({ error: 'endpoint, journeyId, stopId och scheduledAt krävs' });
    }

    const threshold = Math.max(60, Math.min(600, parseInt(delayThreshold || '180')));

    await pool.execute(`
      INSERT INTO vt_watched_departures (endpoint, journey_id, stop_id, line_name, direction, scheduled_at, delay_threshold)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        delay_threshold = VALUES(delay_threshold),
        notified_at = NULL
    `, [endpoint, journeyId, stopId, lineName || null, direction || null, scheduledAt, threshold]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte bevaka avgång' });
  }
});

// DELETE /api/avg/watch — Sluta bevaka
router.delete('/watch', async (req, res) => {
  try {
    const { endpoint, journeyId } = req.body;
    if (!endpoint || !journeyId) {
      return res.status(400).json({ error: 'endpoint och journeyId krävs' });
    }

    await pool.execute(
      'DELETE FROM vt_watched_departures WHERE endpoint = ? AND journey_id = ?',
      [endpoint, journeyId]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte ta bort bevakning' });
  }
});

// GET /api/avg/watched — Lista bevakade avgångar för en endpoint
router.get('/watched', async (req, res) => {
  try {
    const { endpoint } = req.query;
    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint krävs' });
    }

    const [rows] = await pool.execute(
      `SELECT journey_id, stop_id, line_name, direction, scheduled_at, delay_threshold, notified_at
       FROM vt_watched_departures
       WHERE endpoint = ? AND scheduled_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
       ORDER BY scheduled_at ASC`,
      [endpoint]
    );

    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte hämta bevakningar' });
  }
});

export default router;
