/**
 * Monitor Engine — Huvudloop för uptime-kontroll
 *
 * Kör en tick per minut och kollar varje sajts individuella intervall
 * för att avgöra vilka checks som ska köras.
 *
 * Laddar om sajter från DB var 5:e minut för att fånga config-ändringar.
 */

import cron from 'node-cron';
import { readdirSync, unlinkSync, statSync, rmSync, rmdirSync } from 'fs';
import { resolve } from 'path';
import pool from '../db/connection.js';
import { getProject } from '../projects/index.js';
import { runHttpCheck } from './checks/http.js';
import { runSslCheck } from './checks/ssl.js';
import { processCheckResult } from './incidents.js';

// Lazy-imports för moduler som kanske inte behövs direkt vid start
let runHealthCheck, runDnsCheck, runIntegrityCheck, runDeepCheck, runHeadersCheck, runContentCheck, rollupDailyMetrics;

const activeTasks = [];
const locks = new Map();
const lastRunTimes = new Map();
let cachedSites = [];
let lastSiteReload = 0;
let wasQuiet = null; // Spårar dag/natt-övergångar för loggning

const CHECK_TYPES = ['http', 'ssl', 'health', 'deep', 'integrity', 'dns', 'headers', 'content'];

const DEFAULT_INTERVALS = {
  http: 1,
  ssl: 360,
  health: 1,
  deep: 5,
  integrity: 360,
  dns: 60,
  headers: 360,
  content: 60,
};

/**
 * Starta monitor — seeda sajter, ladda från DB, schemalägg checks
 */
export async function startMonitor() {
  let config;
  try {
    config = getProject('monitor');
  } catch {
    console.log('  [MONITOR] Monitor-projekt ej registrerat — hoppar över');
    return;
  }

  // Seeda sajter till DB från konfig
  await seedSites(config.sites);

  // Ladda aktiva sajter från DB
  await reloadSites();

  if (cachedSites.length === 0) {
    console.log('  [MONITOR] Inga sajter aktiverade');
    return;
  }

  console.log(`  [MONITOR] ${cachedSites.length} sajter aktiverade`);

  // Huvudtick — varje minut, kör checks baserat på per-sajt intervall
  const mainTask = cron.schedule('* * * * *', () => {
    runScheduledChecks();
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(mainTask);

  // Logga intervall per sajt
  for (const site of cachedSites) {
    const intervals = CHECK_TYPES
      .filter(t => site[`check_${t}`])
      .map(t => `${t}:${site[`interval_${t}`] || DEFAULT_INTERVALS[t]}min`)
      .join(', ');
    console.log(`  [MONITOR] ${site.name}: ${intervals}`);
  }

  // Daglig rollup (00:05)
  const rollupTask = cron.schedule(config.intervals.rollup, async () => {
    try {
      if (!rollupDailyMetrics) {
        const mod = await import('./metrics.js');
        rollupDailyMetrics = mod.rollupDailyMetrics;
      }
      await rollupDailyMetrics();
    } catch (err) {
      console.error(`  [MONITOR] Rollup-fel: ${err.message}`);
    }
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(rollupTask);

  // Daglig cleanup (00:10) — radera checks äldre än 30 dagar
  const cleanupTask = cron.schedule(config.intervals.cleanup, async () => {
    try {
      const [result] = await pool.execute(
        'DELETE FROM mon_checks WHERE checked_at < DATE_SUB(NOW(), INTERVAL 30 DAY)'
      );
      if (result.affectedRows > 0) {
        console.log(`  [MONITOR] Cleanup: ${result.affectedRows} gamla checks raderade`);
      }

      // Rensa screenshots aldre an 7 dagar (hanterar bade platta filer och mappar)
      const screenshotDir = resolve(import.meta.dirname, '..', 'public', 'screenshots');
      try {
        const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
        let removed = 0;
        const topItems = readdirSync(screenshotDir, { withFileTypes: true });

        for (const item of topItems) {
          const fullPath = resolve(screenshotDir, item.name);

          if (item.isFile()) {
            // Gamla platta screenshots (bakatkompat)
            if (statSync(fullPath).mtimeMs < cutoff) {
              unlinkSync(fullPath);
              removed++;
            }
          } else if (item.isDirectory()) {
            // Site-mappar (t.ex. screenshots/backatorpif/)
            const siteDirItems = readdirSync(fullPath, { withFileTypes: true });
            for (const runDir of siteDirItems) {
              if (!runDir.isDirectory()) continue;
              const runPath = resolve(fullPath, runDir.name);
              if (statSync(runPath).mtimeMs < cutoff) {
                rmSync(runPath, { recursive: true });
                removed++;
              }
            }
            // Ta bort site-mappen om den ar tom
            try {
              const remaining = readdirSync(fullPath);
              if (remaining.length === 0) rmdirSync(fullPath);
            } catch { /* Ignorera */ }
          }
        }

        if (removed > 0) {
          console.log(`  [MONITOR] Cleanup: ${removed} gamla screenshots/mappar raderade`);
        }
      } catch {
        // Mappen kanske inte finns an — ignorera
      }
    } catch (err) {
      console.error(`  [MONITOR] Cleanup-fel: ${err.message}`);
    }
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(cleanupTask);

  // Logga quiet period-config
  if (config.quietPeriod) {
    const qp = config.quietPeriod;
    const quiet = isQuietPeriod();
    wasQuiet = quiet;
    console.log(`  [MONITOR] Tyst period: ${qp.startHour}:00–${String(qp.endHour).padStart(2, '0')}:00 (intervall x${qp.multiplier})${quiet ? ' — AKTIV NU' : ''}`);
  }

  console.log('  [MONITOR] Scheman startade\n');
}

/**
 * Stoppa alla monitor-tasks
 */
export function stopMonitor() {
  for (const task of activeTasks) task.stop();
  activeTasks.length = 0;
  cachedSites = [];
  lastRunTimes.clear();
  console.log('  [MONITOR] Stoppad');
}

/**
 * Ladda om sajter från DB (cachad, max var 5:e minut)
 */
async function reloadSites() {
  try {
    const [rows] = await pool.execute('SELECT * FROM mon_sites WHERE enabled = TRUE');
    cachedSites = rows;
    lastSiteReload = Date.now();
  } catch (err) {
    console.log(`  [MONITOR] Kunde inte ladda sajter från DB: ${err.message}`);
    if (cachedSites.length === 0) {
      console.log('  [MONITOR] Kör migration 006_monitor.sql + 008_site_intervals.sql först');
    }
  }
}

/**
 * Kolla om vi är i tyst period (reducerad frekvens nattetid)
 */
function isQuietPeriod() {
  const config = getProject('monitor');
  const qp = config.quietPeriod;
  if (!qp) return false;

  const now = new Date();
  const hour = now.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: 'numeric', hour12: false });
  const h = parseInt(hour, 10);

  // Hanterar intervall som korsar midnatt (t.ex. 23-06)
  if (qp.startHour > qp.endHour) {
    return h >= qp.startHour || h < qp.endHour;
  }
  return h >= qp.startHour && h < qp.endHour;
}

/**
 * Kör schemalagda checks — anropas varje minut
 */
async function runScheduledChecks() {
  const now = Date.now();

  // Ladda om sajter var 5:e minut för att fånga config-ändringar
  if (now - lastSiteReload > 5 * 60 * 1000) {
    await reloadSites();
  }

  // Quiet period — logga övergångar
  const quiet = isQuietPeriod();
  if (wasQuiet !== null && quiet !== wasQuiet) {
    const config = getProject('monitor');
    const m = config.quietPeriod?.multiplier || 1;
    console.log(`  [MONITOR] ${quiet ? `Tyst period aktiv (intervall x${m})` : 'Normal drift återupptagen'}`);
  }
  wasQuiet = quiet;

  const multiplier = quiet ? (getProject('monitor').quietPeriod?.multiplier || 1) : 1;

  for (const site of cachedSites) {
    for (const type of CHECK_TYPES) {
      // Hoppa över om checken är avslagen
      if (!site[`check_${type}`]) continue;

      // Hämta sajt-specifikt intervall (eller default), applicera quiet-multiplikator
      const baseMinutes = site[`interval_${type}`] || DEFAULT_INTERVALS[type];
      const intervalMinutes = baseMinutes * multiplier;
      const intervalMs = intervalMinutes * 60 * 1000;

      // Kolla om det är dags
      const key = `${site.id}:${type}`;
      const lastRun = lastRunTimes.get(key) || 0;
      if (now - lastRun < intervalMs) continue;

      // Markera som startad (innan await, förhindrar dubbletter)
      lastRunTimes.set(key, now);
      runCheckForSite(site, type);
    }
  }
}

/**
 * Kör en enskild check för en sajt (med lock)
 */
async function runCheckForSite(site, type) {
  // Per-sajt-per-typ lock
  const lockKey = `${site.id}:${type}`;
  if (locks.get(lockKey)) return;
  locks.set(lockKey, true);

  try {
    const result = await executeCheck(site, type);
    if (result) {
      await saveCheck(result);
      await processCheckResult(result);
      await updateSiteStatus(site.id);
    }
  } catch (err) {
    console.error(`  [MONITOR] ${site.id}/${type}: ${err.message}`);
  } finally {
    locks.set(lockKey, false);
  }
}

/**
 * Körfunktion — väljer rätt check-modul
 */
async function executeCheck(site, type) {
  switch (type) {
    case 'http':
      return runHttpCheck(site);

    case 'ssl':
      return runSslCheck(site);

    case 'health':
      if (!site.health_url) return null;
      if (!runHealthCheck) {
        const mod = await import('./checks/health.js');
        runHealthCheck = mod.runHealthCheck;
      }
      return runHealthCheck(site);

    case 'dns':
      if (!runDnsCheck) {
        const mod = await import('./checks/dns.js');
        runDnsCheck = mod.runDnsCheck;
      }
      return runDnsCheck(site);

    case 'integrity':
      if (!runIntegrityCheck) {
        const mod = await import('./checks/integrity.js');
        runIntegrityCheck = mod.runIntegrityCheck;
      }
      return runIntegrityCheck(site);

    case 'deep':
      if (!runDeepCheck) {
        const mod = await import('./checks/playwright.js');
        runDeepCheck = mod.runDeepCheck;
      }
      return runDeepCheck(site);

    case 'headers':
      if (!runHeadersCheck) {
        const mod = await import('./checks/headers.js');
        runHeadersCheck = mod.runHeadersCheck;
      }
      return runHeadersCheck(site);

    case 'content':
      if (!runContentCheck) {
        const mod = await import('./checks/content.js');
        runContentCheck = mod.runContentCheck;
      }
      return runContentCheck(site);

    default:
      console.error(`  [MONITOR] Okänd check-typ: ${type}`);
      return null;
  }
}

/**
 * Spara check-resultat till DB
 */
async function saveCheck(result) {
  try {
    await pool.execute(
      `INSERT INTO mon_checks (site_id, check_type, status, response_ms, status_code, message, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        result.siteId,
        result.type,
        result.status,
        result.responseMs || null,
        result.statusCode || null,
        result.message || null,
        result.details ? JSON.stringify(result.details) : null,
      ]
    );
  } catch (err) {
    console.error(`  [MONITOR] Kunde inte spara check: ${err.message}`);
  }
}

/**
 * Uppdatera sajtens övergripande status baserat på senaste checks
 */
async function updateSiteStatus(siteId) {
  try {
    const [recent] = await pool.execute(
      `SELECT status FROM mon_checks
       WHERE site_id = ? AND check_type = 'http'
       ORDER BY checked_at DESC LIMIT 5`,
      [siteId]
    );

    let newStatus = 'up';
    const failures = recent.filter(r => r.status === 'critical' || r.status === 'error').length;

    if (failures >= 3) newStatus = 'down';
    else if (failures >= 1) newStatus = 'degraded';

    await pool.execute(
      'UPDATE mon_sites SET status = ?, last_check_at = NOW(), consecutive_failures = ? WHERE id = ?',
      [newStatus, failures, siteId]
    );
  } catch (err) {
    console.error(`  [MONITOR] Statusuppdatering misslyckades: ${err.message}`);
  }
}

/**
 * Seeda sajter från projektkonfig till DB (upsert)
 */
async function seedSites(siteConfigs) {
  for (const site of siteConfigs) {
    try {
      const [existing] = await pool.execute(
        'SELECT id FROM mon_sites WHERE id = ?',
        [site.id]
      );

      if (existing.length === 0) {
        await pool.execute(
          `INSERT INTO mon_sites (id, name, url, health_url, health_secret_env,
            ssh_host, ssh_port, ssh_user_env, ssh_key_env, ssh_password_env, ssh_method, webroot,
            check_http, check_ssl, check_health, check_deep, check_integrity, check_dns, check_headers, check_content)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            site.id, site.name, site.url,
            site.healthUrl || null, site.healthSecretEnv || null,
            site.ssh?.host || null, site.ssh?.port || 22,
            site.ssh?.userEnv || null, site.ssh?.keyEnv || null,
            site.ssh?.passwordEnv || null,
            site.ssh?.method || null, site.ssh?.webroot || null,
            site.checks.http, site.checks.ssl, site.checks.health,
            site.checks.deep, site.checks.integrity, site.checks.dns,
            site.checks.headers ?? true, site.checks.content ?? false,
          ]
        );
        console.log(`  [MONITOR] Seedade sajt: ${site.name} (${site.id})`);
      }
    } catch (err) {
      console.error(`  [MONITOR] Seed-fel ${site.id}: ${err.message}`);
    }
  }
}
