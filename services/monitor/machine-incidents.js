/**
 * Machine Incident-hantering — oppna, eskalera och stang incidenter
 *
 * Samma logik som incidents.js men for maskiner:
 *   1 failure  → logga, oppna incident
 *   3 i rad    → skicka larm
 *   Aterhamtad → stang incident, skicka all-clear
 *   Tjanst nere → omedelbart larm
 */

import pool from '../db/connection.js';
import { sendAlert, sendRecovery } from './alerter.js';
import { getProject } from '../projects/index.js';

function getThreshold() {
  try {
    return getProject('monitor').alerting.consecutiveFailuresBeforeAlert || 3;
  } catch {
    return 3;
  }
}

/**
 * Bearbeta ett maskin-check-resultat
 */
export async function processMachineCheckResult(result) {
  try {
    if (result.status === 'ok') {
      await handleRecovery(result);
    } else {
      await handleFailure(result);
    }
  } catch (err) {
    console.error(`  [MACHINES] Incident-fel ${result.machineId}/${result.type}: ${err.message}`);
  }
}

async function handleFailure(result) {
  const [open] = await pool.execute(
    `SELECT * FROM mon_machine_incidents
     WHERE machine_id = ? AND check_type = ? AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1`,
    [result.machineId, result.type]
  );

  if (open.length > 0) {
    const incident = open[0];
    const newCount = incident.failure_count + 1;

    await pool.execute(
      'UPDATE mon_machine_incidents SET failure_count = ?, message = ? WHERE id = ?',
      [newCount, result.message, incident.id]
    );

    const threshold = getThreshold();
    if (newCount >= threshold && !incident.alert_sent) {
      await sendAlert(
        { ...incident, site_id: `machine:${result.machineId}` },
        { ...result, siteId: `machine:${result.machineId}` }
      );
      await pool.execute(
        'UPDATE mon_machine_incidents SET alert_sent = TRUE WHERE id = ?',
        [incident.id]
      );
    }
  } else {
    const severity = result.status === 'critical' ? 'critical' : 'warning';
    const title = `${result.type.toUpperCase()} ${result.status}: ${result.machineId}`;

    const [insertResult] = await pool.execute(
      `INSERT INTO mon_machine_incidents (machine_id, check_type, severity, title, message, failure_count)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [result.machineId, result.type, severity, title, result.message]
    );

    console.log(`  [MACHINES] Nytt incident: ${result.machineId}/${result.type} — ${result.message}`);

    // Tjanst nere → omedelbart larm
    if (result.type === 'services' && result.status === 'critical') {
      const incident = {
        id: insertResult.insertId,
        site_id: `machine:${result.machineId}`,
        check_type: result.type,
        severity: 'critical',
        title,
        failure_count: 1,
      };
      await sendAlert(incident, { ...result, siteId: `machine:${result.machineId}` });
      await pool.execute(
        'UPDATE mon_machine_incidents SET alert_sent = TRUE WHERE id = ?',
        [insertResult.insertId]
      );
    }
  }
}

async function handleRecovery(result) {
  const [open] = await pool.execute(
    `SELECT * FROM mon_machine_incidents
     WHERE machine_id = ? AND check_type = ? AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1`,
    [result.machineId, result.type]
  );

  if (open.length === 0) return;

  const incident = open[0];

  await pool.execute(
    `UPDATE mon_machine_incidents SET status = 'resolved', resolved_at = NOW(), resolved_message = ?
     WHERE id = ?`,
    [result.message, incident.id]
  );

  if (incident.alert_sent && !incident.recovery_sent) {
    await sendRecovery(
      { ...incident, site_id: `machine:${result.machineId}` },
      { ...result, siteId: `machine:${result.machineId}` }
    );
    await pool.execute(
      'UPDATE mon_machine_incidents SET recovery_sent = TRUE WHERE id = ?',
      [incident.id]
    );
  }

  console.log(`  [MACHINES] Aterhamtning: ${result.machineId}/${result.type}`);
}
