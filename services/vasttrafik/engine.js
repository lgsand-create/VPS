/**
 * Västtrafik Engine — Pollingloop för avgångar
 *
 * Modellerad efter monitor/engine.js. Körs inuti server.js,
 * startas vid boot och hämtar avgångar varje minut.
 */

import cron from 'node-cron';
import pool from '../db/connection.js';
import { getProject } from '../projects/index.js';
import { fetchDepartures, getDepartureCache } from './api.js';
import { getSettings } from '../db/settings.js';

let rollupDailyMetrics, notifySubscribers;

const activeTasks = [];
let cachedStops = [];
let lastStopReload = 0;

/**
 * Starta Västtrafik-pollingen
 */
export async function startVasttrafik() {
  let config;
  try {
    config = getProject('vasttrafik');
  } catch {
    console.log('  [VASTTRAFIK] Projekt ej registrerat — hoppar över');
    return;
  }

  // Kolla om pollingen är aktiverad i settings
  try {
    const settings = await getSettings('vasttrafik');
    if (settings?.enabled !== 'true') {
      console.log('  [VASTTRAFIK] Inaktiverad i inställningar — hoppar över');
      console.log('  [VASTTRAFIK] Aktivera via Dashboard → Inställningar → Västtrafik');
      return;
    }
  } catch {
    console.log('  [VASTTRAFIK] Kunde inte läsa inställningar — kör migration 029 först');
    return;
  }

  // Kolla att API-credentials finns i DB
  {
    const settings = await getSettings('vasttrafik');
    if (!settings?.client_id || !settings?.client_secret) {
      console.log('  [VASTTRAFIK] Client ID/Secret saknas — konfigurera under Inställningar → Västtrafik');
      return;
    }
  }

  // Ladda hållplatser
  await reloadStops();

  if (cachedStops.length === 0) {
    console.log('  [VASTTRAFIK] Inga hållplatser konfigurerade');
    console.log('  [VASTTRAFIK] Lägg till via Dashboard → Västtrafik → Hållplatser');
  } else {
    console.log(`  [VASTTRAFIK] ${cachedStops.length} hållplatser: ${cachedStops.map(s => s.name).join(', ')}`);
  }

  // Huvudtick — varje minut
  const mainTask = cron.schedule(config.intervals.departures, () => {
    pollDepartures();
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(mainTask);

  // Live rollup (var 15:e min) — löpande statistik för idag
  const liveRollupTask = cron.schedule(config.intervals.liveRollup, async () => {
    try {
      if (!rollupDailyMetrics) {
        const mod = await import('./metrics.js');
        rollupDailyMetrics = mod.rollupDailyMetrics;
      }
      const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
      await rollupDailyMetrics(today);
    } catch (err) {
      console.error(`  [VASTTRAFIK] Live rollup-fel: ${err.message}`);
    }
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(liveRollupTask);

  // Nattlig rollup (00:05) — slutgiltig aggregering av igår
  const rollupTask = cron.schedule(config.intervals.rollup, async () => {
    try {
      if (!rollupDailyMetrics) {
        const mod = await import('./metrics.js');
        rollupDailyMetrics = mod.rollupDailyMetrics;
      }
      await rollupDailyMetrics();
    } catch (err) {
      console.error(`  [VASTTRAFIK] Rollup-fel: ${err.message}`);
    }
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(rollupTask);

  // Daglig cleanup (00:15) — radera avgångar äldre än retention_days
  const cleanupTask = cron.schedule(config.intervals.cleanup, async () => {
    try {
      const settings = await getSettings('vasttrafik');
      const days = parseInt(settings?.retention_days || '90');

      const [result] = await pool.execute(
        `DELETE FROM vt_departures WHERE fetched_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [days]
      );
      if (result.affectedRows > 0) {
        console.log(`  [VASTTRAFIK] Cleanup: ${result.affectedRows} avgångar raderade (>${days}d)`);
      }

      // Tracking-data: behåll max 7 dagar (växer snabbt)
      const [trackResult] = await pool.execute(
        'DELETE FROM vt_departure_tracking WHERE observed_at < DATE_SUB(NOW(), INTERVAL 7 DAY)'
      );
      if (trackResult.affectedRows > 0) {
        console.log(`  [VASTTRAFIK] Tracking cleanup: ${trackResult.affectedRows} rader raderade (>7d)`);
      }

      // Rensa passerade bevakningar (scheduled_at + 30 min)
      const [watchResult] = await pool.execute(
        'DELETE FROM vt_watched_departures WHERE scheduled_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)'
      );
      if (watchResult.affectedRows > 0) {
        console.log(`  [VASTTRAFIK] Watch cleanup: ${watchResult.affectedRows} passerade bevakningar raderade`);
      }
    } catch (err) {
      console.error(`  [VASTTRAFIK] Cleanup-fel: ${err.message}`);
    }
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(cleanupTask);

  // Veckovis push-prenumerations-cleanup
  const subCleanupTask = cron.schedule(config.intervals.subscriptionCleanup, async () => {
    try {
      const [result] = await pool.execute(
        'DELETE FROM vt_push_subscriptions WHERE consecutive_failures > 3'
      );
      if (result.affectedRows > 0) {
        console.log(`  [VASTTRAFIK] Push-cleanup: ${result.affectedRows} misslyckade prenumerationer borttagna`);
      }
    } catch (err) {
      console.error(`  [VASTTRAFIK] Push-cleanup-fel: ${err.message}`);
    }
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(subCleanupTask);

  console.log('  [VASTTRAFIK] Polling startad\n');
}

/**
 * Stoppa alla tasks
 */
export function stopVasttrafik() {
  for (const task of activeTasks) task.stop();
  activeTasks.length = 0;
  cachedStops = [];
  lastStopReload = 0;
  console.log('  [VASTTRAFIK] Stoppad');
}

/**
 * Ladda om hållplatser från DB (var 5:e minut)
 */
async function reloadStops() {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM vt_stops WHERE enabled = TRUE ORDER BY sort_order, name'
    );
    cachedStops = rows;
    lastStopReload = Date.now();
  } catch (err) {
    console.log(`  [VASTTRAFIK] Kunde inte ladda hållplatser: ${err.message}`);
  }
}

/**
 * Hämta och spara avgångar för alla hållplatser
 */
async function pollDepartures() {
  const now = Date.now();

  // Ladda om hållplatser var 5:e minut
  if (now - lastStopReload > 5 * 60_000) {
    await reloadStops();
  }

  if (cachedStops.length === 0) return;

  for (const stop of cachedStops) {
    try {
      const data = await fetchDepartures(stop.stop_area_gid);
      if (data) {
        await storeDepartures(stop, data);
      }
    } catch (err) {
      console.error(`  [VASTTRAFIK] ${stop.name}: ${err.message}`);
    }
  }
}

/**
 * Spara avgångar till DB (upsert)
 */
async function storeDepartures(stop, apiResponse) {
  // Västtrafik v4 returnerar { results: [...] }
  const departures = apiResponse?.results || apiResponse?.departures || [];
  if (departures.length === 0) return;

  let stored = 0;
  const notifiedJourneys = new Set();

  for (const dep of departures) {
    try {
      const journeyId = dep.detailsReference || dep.journeyId || null;
      const line = dep.serviceJourney?.line || dep.line || {};
      const lineName = line.shortName || line.designation || dep.sname || line.name || '?';
      const lineShortName = line.shortName || dep.sname || null;
      const direction = dep.serviceJourney?.direction || dep.direction || null;
      const scheduledAt = parseVtTime(dep.plannedTime || dep.time || dep.date);
      const estimatedAt = parseVtTime(dep.estimatedTime || dep.rtTime);
      const isCancelled = dep.isCancelled || false;
      const isDeviation = dep.isPartCancelled || false;
      const track = dep.stopPoint?.platform || dep.track || null;
      const fgColor = line.foregroundColor || dep.fgColor || null;
      const bgColor = line.backgroundColor || dep.bgColor || null;
      const transportType = line.transportMode || dep.type || null;

      // Beräkna försening i sekunder
      let delaySeconds = 0;
      if (scheduledAt && estimatedAt) {
        delaySeconds = Math.round((new Date(estimatedAt) - new Date(scheduledAt)) / 1000);
      }

      if (!scheduledAt) continue;

      await pool.execute(`
        INSERT INTO vt_departures
          (stop_id, journey_id, line_name, line_short_name, direction,
           scheduled_at, estimated_at, delay_seconds, is_cancelled, is_deviation,
           track, fg_color, bg_color, transport_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          estimated_at = VALUES(estimated_at),
          delay_seconds = VALUES(delay_seconds),
          is_cancelled = VALUES(is_cancelled),
          is_deviation = VALUES(is_deviation),
          track = VALUES(track),
          fetched_at = CURRENT_TIMESTAMP
      `, [
        stop.id, journeyId, lineName, lineShortName, direction,
        scheduledAt, estimatedAt, delaySeconds, isCancelled, isDeviation,
        track, fgColor, bgColor, transportType,
      ]);

      stored++;

      // Logga observation för delay-tidslinje
      if (journeyId) {
        await pool.execute(`
          INSERT INTO vt_departure_tracking
            (stop_id, journey_id, line_name, direction, scheduled_at, estimated_at, delay_seconds, is_cancelled)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [stop.id, journeyId, lineName, direction, scheduledAt, estimatedAt, delaySeconds, isCancelled]);
      }

      // Kolla om denna avgång bevakas av någon
      if (journeyId && !notifiedJourneys.has(journeyId)) {
        notifiedJourneys.add(journeyId);
        checkWatchedDeparture(journeyId, stop.id, {
          lineName, direction, scheduledAt, estimatedAt, delaySeconds, isCancelled,
        });
      }
    } catch (err) {
      // Ignorera enskilda duplikat-fel
      if (!err.message.includes('Duplicate')) {
        console.error(`  [VASTTRAFIK] Spara avgång: ${err.message}`);
      }
    }
  }
}

/**
 * Kolla om en specifik avgång bevakas och pusha vid försening
 */
async function checkWatchedDeparture(journeyId, stopId, departure) {
  try {
    // Hitta alla som bevakar denna journey
    const [watchers] = await pool.execute(`
      SELECT w.id, w.endpoint, w.delay_threshold, w.notified_at,
             s.p256dh, s.auth_key
      FROM vt_watched_departures w
      JOIN vt_push_subscriptions s ON s.endpoint = w.endpoint
      WHERE w.journey_id = ? AND w.stop_id = ?
        AND s.consecutive_failures <= 3
    `, [journeyId, stopId]);

    if (watchers.length === 0) return;

    if (!notifySubscribers) {
      const mod = await import('./push.js');
      notifySubscribers = mod.notifySubscribers;
    }

    const { sendWatchNotification } = await import('./push.js');

    for (const w of watchers) {
      const shouldNotify = departure.delaySeconds >= (w.delay_threshold || 180)
        || departure.isCancelled;

      if (!shouldNotify) continue;
      if (w.notified_at) continue; // Redan notifierad

      await sendWatchNotification(w, departure);

      // Markera som notifierad
      await pool.execute(
        'UPDATE vt_watched_departures SET notified_at = NOW() WHERE id = ?',
        [w.id]
      );
    }
  } catch {
    // Push-modul kanske inte är konfigurerad — ignorera
  }
}

/**
 * Parsa Västtrafik-tidsformat till MySQL DATETIME
 * Stöder: ISO 8601 (2026-02-21T14:30:00+01:00) och VT-format (2026-02-21 14:30)
 */
function parseVtTime(timeStr) {
  if (!timeStr) return null;

  try {
    const d = new Date(timeStr);
    if (isNaN(d.getTime())) return null;

    // Formatera som YYYY-MM-DD HH:MM:SS
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return null;
  }
}
