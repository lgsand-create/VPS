/**
 * Incident-hantering — oppna, eskalera och stang incidenter
 *
 * Larmlogik:
 *   1 failure  → logga, oppna incident
 *   3 i rad    → skicka larm
 *   Aterhamtad → stang incident, skicka all-clear
 *   Filintegritet/Content/DNS hijack → omedelbart larm oavsett count
 */

import pool from '../db/connection.js';
import { sendAlert, sendRecovery } from './alerter.js';
import { getProject } from '../projects/index.js';

// Hamta threshold fran konfig (default 3)
function getThreshold() {
  try {
    return getProject('monitor').alerting.consecutiveFailuresBeforeAlert || 3;
  } catch {
    return 3;
  }
}

// Korrelation: tracka skickade korrelationslarm per sajt
// { siteId: timestamp } — skicka max en korrelation per sajt per timme
const correlationSent = new Map();
const CORRELATION_WINDOW_MIN = 10;
const CORRELATION_COOLDOWN_MS = 3600000; // 1 timme

/**
 * Bearbeta ett check-resultat — oppna/stang incident beroende pa status
 */
export async function processCheckResult(result) {
  try {
    if (result.status === 'ok') {
      await handleRecovery(result);
    } else {
      await handleFailure(result);
    }
  } catch (err) {
    console.error(`  [MONITOR] Incident-fel ${result.siteId}/${result.type}: ${err.message}`);
  }
}

/**
 * Hantera misslyckad check
 */
async function handleFailure(result) {
  // Hitta oppet incident for denna sajt+typ
  const [open] = await pool.execute(
    `SELECT * FROM mon_incidents
     WHERE site_id = ? AND check_type = ? AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1`,
    [result.siteId, result.type]
  );

  if (open.length > 0) {
    // Uppdatera befintligt incident — oka failure_count
    const incident = open[0];
    const newCount = incident.failure_count + 1;

    await pool.execute(
      'UPDATE mon_incidents SET failure_count = ?, message = ? WHERE id = ?',
      [newCount, result.message, incident.id]
    );

    // Skicka larm om threshold uppnatt och inte redan skickat
    const threshold = getThreshold();
    if (newCount >= threshold && !incident.alert_sent) {
      await sendAlert({ ...incident, failure_count: newCount }, result);
      await pool.execute(
        'UPDATE mon_incidents SET alert_sent = TRUE WHERE id = ?',
        [incident.id]
      );
    }
  } else {
    // Skapa nytt incident
    const severity = result.status === 'critical' ? 'critical' : 'warning';
    const title = `${result.type.toUpperCase()} ${result.status}: ${result.siteId}`;

    const [insertResult] = await pool.execute(
      `INSERT INTO mon_incidents (site_id, check_type, severity, title, message, failure_count)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [result.siteId, result.type, severity, title, result.message]
    );

    console.log(`  [MONITOR] Nytt incident: ${result.siteId}/${result.type} — ${result.message}`);

    // Sakerhetshot → omedelbart larm (filintegritet, injektioner, DNS hijack, canary)
    const immediateAlert = result.status !== 'ok' && (
      result.type === 'integrity' ||
      result.type === 'content' ||
      result.type === 'canary' ||
      (result.type === 'dns' && result.details?.hijack)
    );
    if (immediateAlert) {
      const incident = {
        id: insertResult.insertId,
        site_id: result.siteId,
        check_type: result.type,
        severity: 'critical',
        title,
        failure_count: 1,
      };
      await sendAlert(incident, result);
      await pool.execute(
        'UPDATE mon_incidents SET alert_sent = TRUE, severity = ? WHERE id = ?',
        ['critical', insertResult.insertId]
      );
    }
  }

  // Korrelationsanalys — kolla om flera check-typer failar samtidigt
  await checkCorrelation(result);
}

/**
 * Korrelationsanalys — kolla om flera check-typer failar samtidigt
 *
 * Om 2+ olika check-typer har öppna incidenter för samma sajt
 * inom CORRELATION_WINDOW_MIN minuter → eskalerat larm.
 */
async function checkCorrelation(result) {
  try {
    const now = Date.now();
    const lastSent = correlationSent.get(result.siteId) || 0;
    if (now - lastSent < CORRELATION_COOLDOWN_MS) return;

    const [rows] = await pool.execute(
      `SELECT DISTINCT check_type FROM mon_incidents
       WHERE site_id = ? AND status = 'open'
         AND opened_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [result.siteId, CORRELATION_WINDOW_MIN]
    );

    if (rows.length < 2) return;

    const types = rows.map(r => r.check_type);
    correlationSent.set(result.siteId, now);

    // Bygg eskalerat larm
    const correlatedIncident = {
      id: null,
      site_id: result.siteId,
      check_type: 'korrelation',
      severity: 'critical',
      title: `KORRELERAT HOT: ${result.siteId} — ${types.length} check-typer failar`,
      failure_count: types.length,
    };

    const correlatedResult = {
      ...result,
      message: `Möjligt koordinerat angrepp: ${types.join(', ')} failar inom ${CORRELATION_WINDOW_MIN} min`,
      details: { ...result.details, correlatedTypes: types },
    };

    console.log(`\n  [MONITOR] [KORRELATION] ${result.siteId}: ${types.join(' + ')} — möjligt intrång!\n`);
    await sendAlert(correlatedIncident, correlatedResult);
  } catch (err) {
    console.error(`  [MONITOR] Korrelationsfel: ${err.message}`);
  }
}

/**
 * Hantera aterhamtning — stang incident och skicka all-clear
 */
async function handleRecovery(result) {
  const [open] = await pool.execute(
    `SELECT * FROM mon_incidents
     WHERE site_id = ? AND check_type = ? AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1`,
    [result.siteId, result.type]
  );

  if (open.length === 0) return;

  const incident = open[0];

  // Stang incidentet
  await pool.execute(
    `UPDATE mon_incidents SET status = 'resolved', resolved_at = NOW(), resolved_message = ?
     WHERE id = ?`,
    [result.message, incident.id]
  );

  // Skicka recovery-notis om larm skickats
  if (incident.alert_sent && !incident.recovery_sent) {
    await sendRecovery(incident, result);
    await pool.execute(
      'UPDATE mon_incidents SET recovery_sent = TRUE WHERE id = ?',
      [incident.id]
    );
  }

  console.log(`  [MONITOR] Aterhamtning: ${result.siteId}/${result.type}`);
}
