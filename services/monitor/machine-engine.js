/**
 * Machine Monitor Engine — huvudloop for maskinovervakning
 *
 * Kor en tick per minut och kollar varje maskins individuella intervall.
 * Laddar om maskiner fran DB var 5:e minut for att fanga config-andringar.
 */

import cron from 'node-cron';
import pool from '../db/connection.js';
import { getProject } from '../projects/index.js';
import { runMachineChecks } from './checks/machine.js';
import { processMachineCheckResult } from './machine-incidents.js';

let rollupMachineDailyMetrics;

const activeTasks = [];
const locks = new Map();
const lastRunTimes = new Map();
let cachedMachines = [];
let lastReload = 0;

/**
 * Starta maskinovervakning
 */
export async function startMachineMonitor() {
  let config;
  try {
    config = getProject('monitor');
  } catch {
    console.log('  [MACHINES] Monitor-projekt ej registrerat — hoppar over');
    return;
  }

  if (!config.machines || config.machines.length === 0) {
    console.log('  [MACHINES] Inga maskiner konfigurerade');
    return;
  }

  // Seeda maskiner till DB fran konfig
  await seedMachines(config.machines);

  // Ladda aktiva maskiner fran DB
  await reloadMachines();

  if (cachedMachines.length === 0) {
    console.log('  [MACHINES] Inga maskiner aktiverade');
    return;
  }

  console.log(`  [MACHINES] ${cachedMachines.length} maskiner aktiverade`);
  for (const m of cachedMachines) {
    console.log(`  [MACHINES] ${m.name}: var ${m.interval_minutes}:e minut`);
  }

  // Huvudtick — varje minut
  const mainTask = cron.schedule('* * * * *', () => {
    runScheduledChecks();
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(mainTask);

  // Daglig rollup (00:15)
  const rollupTask = cron.schedule('15 0 * * *', async () => {
    try {
      if (!rollupMachineDailyMetrics) {
        const mod = await import('./machine-metrics.js');
        rollupMachineDailyMetrics = mod.rollupMachineDailyMetrics;
      }
      await rollupMachineDailyMetrics();
    } catch (err) {
      console.error(`  [MACHINES] Rollup-fel: ${err.message}`);
    }
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(rollupTask);

  // Daglig cleanup (00:20) — radera checks aldre an 30 dagar
  const cleanupTask = cron.schedule('20 0 * * *', async () => {
    try {
      const [result] = await pool.execute(
        'DELETE FROM mon_machine_checks WHERE checked_at < DATE_SUB(NOW(), INTERVAL 30 DAY)'
      );
      if (result.affectedRows > 0) {
        console.log(`  [MACHINES] Cleanup: ${result.affectedRows} gamla checks raderade`);
      }
    } catch (err) {
      console.error(`  [MACHINES] Cleanup-fel: ${err.message}`);
    }
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(cleanupTask);

  console.log('  [MACHINES] Scheman startade\n');
}

/**
 * Stoppa alla maskin-tasks
 */
export function stopMachineMonitor() {
  for (const task of activeTasks) task.stop();
  activeTasks.length = 0;
  cachedMachines = [];
  lastRunTimes.clear();
  console.log('  [MACHINES] Stoppad');
}

/**
 * Ladda om maskiner fran DB (cachad, max var 5:e minut)
 */
async function reloadMachines() {
  try {
    const [rows] = await pool.execute('SELECT * FROM mon_machines WHERE enabled = TRUE');
    cachedMachines = rows;
    lastReload = Date.now();
  } catch (err) {
    console.log(`  [MACHINES] Kunde inte ladda maskiner fran DB: ${err.message}`);
  }
}

/**
 * Kolla om vi ar i tyst period
 */
function isQuietPeriod() {
  try {
    const config = getProject('monitor');
    const qp = config.quietPeriod;
    if (!qp) return false;

    const now = new Date();
    const hour = now.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: 'numeric', hour12: false });
    const h = parseInt(hour, 10);

    if (qp.startHour > qp.endHour) {
      return h >= qp.startHour || h < qp.endHour;
    }
    return h >= qp.startHour && h < qp.endHour;
  } catch {
    return false;
  }
}

/**
 * Kor schemalagda checks — anropas varje minut
 */
async function runScheduledChecks() {
  const now = Date.now();

  // Ladda om maskiner var 5:e minut
  if (now - lastReload > 5 * 60 * 1000) {
    await reloadMachines();
  }

  const quiet = isQuietPeriod();
  const multiplier = quiet ? (getProject('monitor').quietPeriod?.multiplier || 1) : 1;

  for (const machine of cachedMachines) {
    const baseMinutes = machine.interval_minutes || 2;
    const intervalMs = baseMinutes * multiplier * 60 * 1000;

    const key = machine.id;
    const lastRun = lastRunTimes.get(key) || 0;
    if (now - lastRun < intervalMs) continue;

    lastRunTimes.set(key, now);
    runChecksForMachine(machine);
  }
}

/**
 * Kor alla checks for en maskin (med lock)
 */
async function runChecksForMachine(machine) {
  if (locks.get(machine.id)) return;
  locks.set(machine.id, true);

  try {
    const results = await runMachineChecks(machine);

    for (const result of results) {
      await saveCheck(result);
      await processMachineCheckResult(result);
    }

    await updateMachineStatus(machine.id);
  } catch (err) {
    console.error(`  [MACHINES] ${machine.id}: ${err.message}`);
  } finally {
    locks.set(machine.id, false);
  }
}

/**
 * Spara check-resultat till DB
 */
async function saveCheck(result) {
  try {
    await pool.execute(
      `INSERT INTO mon_machine_checks (machine_id, check_type, status, response_ms, message, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        result.machineId,
        result.type,
        result.status,
        result.responseMs || null,
        result.message || null,
        result.details ? JSON.stringify(result.details) : null,
      ]
    );
  } catch (err) {
    console.error(`  [MACHINES] Kunde inte spara check: ${err.message}`);
  }
}

/**
 * Uppdatera maskinens overgripande status
 */
async function updateMachineStatus(machineId) {
  try {
    // Kolla senaste 5 checks (alla typer)
    const [recent] = await pool.execute(
      `SELECT status FROM mon_machine_checks
       WHERE machine_id = ?
       ORDER BY checked_at DESC LIMIT 5`,
      [machineId]
    );

    let newStatus = 'up';
    const failures = recent.filter(r => r.status === 'critical' || r.status === 'error').length;

    if (failures >= 3) newStatus = 'down';
    else if (failures >= 1) newStatus = 'degraded';

    await pool.execute(
      'UPDATE mon_machines SET status = ?, last_check_at = NOW(), consecutive_failures = ? WHERE id = ?',
      [newStatus, failures, machineId]
    );
  } catch (err) {
    console.error(`  [MACHINES] Statusuppdatering misslyckades: ${err.message}`);
  }
}

/**
 * Seeda maskiner fran projektkonfig till DB (upsert)
 */
async function seedMachines(machineConfigs) {
  for (const m of machineConfigs) {
    try {
      const [existing] = await pool.execute(
        'SELECT id FROM mon_machines WHERE id = ?',
        [m.id]
      );

      if (existing.length === 0) {
        await pool.execute(
          `INSERT INTO mon_machines (id, name, host, description, collect_method,
            ssh_port, ssh_user, ssh_key_env, ssh_password_env,
            check_ping, check_system, check_services, check_gpu,
            services, disk_paths, interval_minutes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.id, m.name, m.host,
            m.description || null,
            m.collectMethod || 'ssh',
            m.sshPort || 22,
            m.sshUser || 'root',
            m.sshKeyEnv || null,
            m.sshPasswordEnv || null,
            m.collectMethod === 'local' ? false : (m.checks?.ping ?? true),
            m.checks?.system ?? true,
            m.checks?.services ?? true,
            !!m.checkGpu,
            JSON.stringify(m.services || []),
            JSON.stringify(m.diskPaths || ['/']),
            m.interval || 2,
          ]
        );
        console.log(`  [MACHINES] Seedade maskin: ${m.name} (${m.id})`);
      } else if (m.checkGpu !== undefined) {
        // Synka check_gpu for befintliga maskiner
        await pool.execute(
          'UPDATE mon_machines SET check_gpu = ? WHERE id = ?',
          [!!m.checkGpu, m.id]
        );
      }
    } catch (err) {
      console.error(`  [MACHINES] Seed-fel ${m.id}: ${err.message}`);
    }
  }
}
