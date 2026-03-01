/**
 * Compuna Hub — CRON-schemaläggare (multi-projekt)
 *
 * Läser scheman från databasen (cron_schedules).
 * Vid start seedas defaults från projektkonfigfiler om rader saknas.
 * Stödjer reload via reloadScheduler() — anropas av dashboard vid schemaändringar.
 */

import cron from 'node-cron';
import { exec } from 'child_process';
import { resolve } from 'path';
import { promisify } from 'util';
import pool from '../db/connection.js';
import { getAllProjects, getProject } from '../projects/index.js';

const execAsync = promisify(exec);
const PROJECT_ROOT = resolve(import.meta.dirname, '../..');
const SERVICES_DIR = resolve(import.meta.dirname, '..');

// Per-projekt lock — förhindrar parallella körningar per projekt
const locks = new Map();

// Aktiva cron-tasks — sparas för att kunna stoppas vid reload
const activeTasks = [];

// Max körtid innan en körning anses stale (10 min)
const STALE_THRESHOLD_MS = 600000;

// Watchdog-intervall (var 2:a minut)
const WATCHDOG_INTERVAL_MS = 120000;

let watchdogTimer = null;

/**
 * Markera alla "running"-poster äldre än STALE_THRESHOLD_MS som failed.
 * Körs vid start och periodiskt av watchdog.
 */
async function cleanupStaleRuns() {
  try {
    const [stale] = await pool.execute(
      `UPDATE scrape_log
       SET status = 'failed',
           finished_at = NOW(),
           error_message = CONCAT(IFNULL(error_message, ''), '[stale — markerad av watchdog]')
       WHERE status = 'running'
         AND started_at < DATE_SUB(NOW(), INTERVAL ? SECOND)`,
      [Math.round(STALE_THRESHOLD_MS / 1000)]
    );
    if (stale.affectedRows > 0) {
      console.log(`  [CRON] Cleanup: ${stale.affectedRows} stale "running"-poster markerade som failed`);
    }
  } catch (err) {
    console.error('  [CRON] Cleanup-fel:', err.message);
  }
}

/**
 * Seeda defaults från projektkonfig till DB om rader saknas.
 * Körs vid start — befintliga rader rörs inte.
 */
async function seedDefaults() {
  const projects = getAllProjects();

  for (const project of Object.values(projects)) {
    if (project.type === 'webhook' || !project.schedules) continue;

    for (const [mode, schedule] of Object.entries(project.schedules)) {
      try {
        const [existing] = await pool.execute(
          'SELECT id FROM cron_schedules WHERE project_id = ? AND mode = ?',
          [project.id, mode]
        );

        if (existing.length === 0) {
          await pool.execute(
            'INSERT INTO cron_schedules (project_id, mode, cron_expr, label, args, enabled) VALUES (?, ?, ?, ?, ?, TRUE)',
            [project.id, mode, schedule.cron, schedule.label, schedule.args || '']
          );
          console.log(`  [CRON] Seedade default: ${project.id}/${mode} — ${schedule.cron}`);
        }
      } catch (err) {
        console.error(`  [CRON] Seed-fel ${project.id}/${mode}:`, err.message);
      }
    }
  }
}

/**
 * Normalisera användarvänliga args till CLI-flaggor.
 * "2026" eller "år 2026" → "--year 2026"
 * "år" → "--year"
 * "veckor 8" → "--weeks 8"
 * Redan formaterade flaggor (--year etc.) passerar igenom oförändrade.
 */
function normalizeArgs(args) {
  if (!args || args.startsWith('-')) return args;

  const s = args.trim();

  // Bara ett årtal: "2026" → "--year 2026"
  if (/^\d{4}$/.test(s)) return `--year ${s}`;

  // "år 2026" eller "year 2026" → "--year 2026"
  const yearMatch = s.match(/^(?:år|year)\s+(\d{4})$/i);
  if (yearMatch) return `--year ${yearMatch[1]}`;

  // Bara "år" eller "year" → "--year" (aktuellt år)
  if (/^(?:år|year)$/i.test(s)) return '--year';

  // "veckor 8" eller "weeks 8" → "--weeks 8"
  const weeksMatch = s.match(/^(?:veckor?|weeks?)\s+(\d+)$/i);
  if (weeksMatch) return `--weeks ${weeksMatch[1]}`;

  return args;
}

/**
 * Kör scraper → import pipeline för ett projekt
 */
async function runPipeline(projectId, mode = 'quick', args = '', scheduleLabel = '') {
  if (locks.get(projectId)) {
    console.log(`  [CRON] ${projectId}: Pipeline körs redan — hoppar över`);
    return;
  }

  let project;
  try {
    project = getProject(projectId);
  } catch {
    console.error(`  [CRON] Projekt "${projectId}" finns inte — hoppar över`);
    return;
  }

  locks.set(projectId, true);
  const startTime = Date.now();
  const logLabel = scheduleLabel || (mode === 'full' ? 'Fullscan' : 'Snabbkörning');
  console.log(`\n  [CRON] ${new Date().toLocaleString('sv-SE')} — ${projectId} ${logLabel}`);

  // Per-schedule override av scraper/importer (t.ex. horses-mode har egen scraper)
  const schedule = project.schedules?.[mode];
  const scraperPath = resolve(PROJECT_ROOT, schedule?.scraper || project.scraper.path);
  const importerPath = resolve(SERVICES_DIR, schedule?.importer || project.importer);

  let logId;
  try {
    const [result] = await pool.execute(
      'INSERT INTO scrape_log (scraper, status, project) VALUES (?, ?, ?)',
      [logLabel, 'running', projectId]
    );
    logId = result.insertId;
  } catch { /* DB kanske inte redo */ }

  try {
    // Steg 1: Kör scrapern
    let scraperArgs = normalizeArgs(args || '');

    // Dynamisk team-filtrering: om projektet har teamTable, kör bara aktiva lag
    if (project.teamTable && !scraperArgs.includes('--team')) {
      try {
        const [active] = await pool.execute(`SELECT id FROM ${project.teamTable} WHERE aktiv = TRUE`);
        const [all] = await pool.execute(`SELECT id FROM ${project.teamTable}`);
        if (active.length === 0) {
          console.log(`  [CRON] ${projectId}: Inga aktiva lag — hoppar över`);
          if (logId) await pool.execute('UPDATE scrape_log SET status = ?, finished_at = NOW() WHERE id = ?', ['skipped', logId]);
          return;
        }
        if (active.length < all.length) {
          scraperArgs += ` --team ${active.map(t => t.id).join(',')}`;
          console.log(`  [CRON] ${projectId}: ${active.length}/${all.length} lag aktiva`);
        }
      } catch (err) {
        console.log(`  [CRON] ${projectId}: Kunde inte läsa aktiva lag: ${err.message} — kör alla`);
      }
    }

    console.log(`  [CRON] ${projectId}: Steg 1: Kör scraper ${scraperArgs || '(aktuell vecka)'}...`);

    const { stdout, stderr } = await execAsync(
      `node "${scraperPath}" ${scraperArgs}`,
      {
        timeout: mode === 'full' ? 1800000 : 300000,
        cwd: PROJECT_ROOT,
        env: { ...process.env },
      }
    );

    if (stderr && !stderr.includes('ExperimentalWarning')) {
      console.log(`  [CRON] ${projectId}: Scraper stderr: ${stderr.slice(0, 200)}`);
    }

    // Logga sista 5 raderna av scraper-output för debugging
    const scraperLines = stdout.trim().split('\n');
    const scraperTail = scraperLines.slice(-5).map(l => l.trim()).join(' | ');
    console.log(`  [CRON] ${projectId}: Scraper klar (${scraperLines.length} rader output)`);
    console.log(`  [CRON] ${projectId}: Scraper tail: ${scraperTail.slice(0, 500)}`);

    // Steg 2: Importera
    console.log(`  [CRON] ${projectId}: Steg 2: Importerar till databas...`);
    const { stdout: importOut } = await execAsync(
      `node "${importerPath}" latest --no-log`,
      {
        timeout: 120000,
        cwd: SERVICES_DIR,
        env: { ...process.env },
      }
    );

    // Logga full import-output för debugging
    console.log(`  [CRON] ${projectId}: Import output: ${importOut.trim().slice(0, 500)}`);

    const records = importOut.match(/(\d+) (?:uppdaterade|närvaroposter)/)?.[1] || '?';
    const skipped = importOut.match(/(\d+) oförändrade/)?.[1] || '0';
    const changes = importOut.match(/(\d+) ändringar/)?.[1] || '0';
    console.log(`  [CRON] ${projectId}: Import: ${records} poster, ${skipped} oförändrade, ${changes} ändringar`);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (logId) {
      await pool.execute(
        'UPDATE scrape_log SET status = ?, finished_at = NOW(), records = ? WHERE id = ?',
        ['success', parseInt(records) || 0, logId]
      );
    }
    console.log(`  [CRON] ${projectId}: ${logLabel} klar på ${elapsed}s\n`);

  } catch (err) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.error(`  [CRON] ${projectId}: FEL efter ${elapsed}s: ${err.message}`);

    if (logId) {
      await pool.execute(
        'UPDATE scrape_log SET status = ?, finished_at = NOW(), error_message = ? WHERE id = ?',
        ['failed', err.message.slice(0, 500), logId]
      ).catch(dbErr => {
        console.error(`  [CRON] ${projectId}: Kunde inte uppdatera scrape_log: ${dbErr.message}`);
      });
    }
  } finally {
    locks.set(projectId, false);
  }
}

/**
 * Stoppa alla aktiva cron-tasks
 */
function stopAll() {
  for (const task of activeTasks) {
    task.stop();
  }
  activeTasks.length = 0;
}

// Parsa cron_expr — stödjer semikolon-separerade uttryck.
// T.ex. "var-15-min 07-20;hel-timme 21-06" som två separata cron-tasks.
function parseCronExprs(cronExpr) {
  return cronExpr.split(';').map(s => s.trim()).filter(Boolean);
}

/**
 * Validera cron_expr (enkel eller semikolon-separerad).
 * Returnerar { valid: true } eller { valid: false, invalid: '...' }.
 */
function validateCronExpr(cronExpr) {
  const exprs = parseCronExprs(cronExpr);
  if (exprs.length === 0) return { valid: false, invalid: cronExpr };
  for (const expr of exprs) {
    if (!cron.validate(expr)) return { valid: false, invalid: expr };
  }
  return { valid: true };
}

/**
 * Ladda scheman från DB och starta cron-tasks.
 * Stödjer semikolon-separerade cron-uttryck — skapar en task per uttryck.
 */
async function loadAndStart() {
  let scheduledCount = 0;

  try {
    const [rows] = await pool.execute(
      'SELECT * FROM cron_schedules WHERE enabled = TRUE ORDER BY project_id, mode'
    );

    for (const row of rows) {
      // Kontrollera att projektet fortfarande finns
      try {
        getProject(row.project_id);
      } catch {
        console.log(`  [CRON] ${row.project_id}: Projekt finns inte längre — hoppar över`);
        continue;
      }

      const check = validateCronExpr(row.cron_expr);
      if (!check.valid) {
        console.log(`  [CRON] ${row.project_id}: Ogiltigt schema "${check.invalid}" för ${row.mode}`);
        continue;
      }

      const exprs = parseCronExprs(row.cron_expr);
      for (const expr of exprs) {
        const task = cron.schedule(expr, () => runPipeline(row.project_id, row.mode, row.args, row.label), {
          timezone: 'Europe/Stockholm',
        });
        activeTasks.push(task);
      }

      const exprLabel = exprs.length > 1 ? `${exprs.join(' + ')} (${exprs.length} uttryck)` : row.cron_expr;
      console.log(`  [CRON] ${row.project_id}: ${row.label} — ${exprLabel}`);
      scheduledCount++;
    }
  } catch (err) {
    // Fallback: om DB-tabellen inte finns ännu, läs från config
    console.log(`  [CRON] Kunde inte läsa DB (${err.message}) — använder config-defaults`);

    const projects = getAllProjects();
    for (const project of Object.values(projects)) {
      if (project.type === 'webhook' || !project.schedules) continue;

      for (const [mode, schedule] of Object.entries(project.schedules)) {
        const exprs = parseCronExprs(schedule.cron);
        const valid = exprs.length > 0 && exprs.every(e => cron.validate(e));
        if (!valid) continue;

        for (const expr of exprs) {
          const task = cron.schedule(expr, () => runPipeline(project.id, mode, schedule.args || '', schedule.label), {
            timezone: 'Europe/Stockholm',
          });
          activeTasks.push(task);
        }

        console.log(`  [CRON] ${project.id}: ${schedule.label} — ${schedule.cron} (config-fallback)`);
        scheduledCount++;
      }
    }
  }

  if (scheduledCount === 0) {
    console.log('  [CRON] Inga schema registrerade');
  }
  console.log('');
}

/**
 * Starta scheduler — rensar stale, seedar defaults, laddar scheman, startar watchdog
 */
export async function startScheduler() {
  await cleanupStaleRuns();
  await seedDefaults();
  await loadAndStart();
  startExternalTriggers();

  // Watchdog: kontrollera stale körningar periodiskt
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(cleanupStaleRuns, WATCHDOG_INTERVAL_MS);
  console.log(`  [CRON] Watchdog aktiv (var ${WATCHDOG_INTERVAL_MS / 1000}s)\n`);
}

/**
 * Ladda om scheduler — stoppar alla tasks, läser DB på nytt, startar igen.
 * Anropas av dashboard vid schemaändringar.
 */
export async function reloadScheduler() {
  console.log('  [CRON] Laddar om scheman...');
  stopAll();
  await cleanupStaleRuns();
  await loadAndStart();
  console.log('  [CRON] Omladding klar');
}

/**
 * Starta externa cron-triggers (enkla HTTP GET-anrop på schema).
 * Läser URL:er från env-variabler. Loggar resultat till console.
 */
function startExternalTriggers() {
  const triggers = [
    { name: 'Stall Adams RF Portal', envKey: 'SARF_CRON_URL', cronExpr: '* * * * *' },
  ];

  for (const trigger of triggers) {
    const url = process.env[trigger.envKey];
    if (!url) continue;

    const task = cron.schedule(trigger.cronExpr, async () => {
      try {
        const res = await fetch(url);
        console.log(`  [TRIGGER] ${trigger.name}: ${res.status} ${res.statusText}`);
      } catch (err) {
        console.error(`  [TRIGGER] ${trigger.name}: FEL — ${err.message}`);
      }
    }, { timezone: 'Europe/Stockholm' });

    activeTasks.push(task);
    console.log(`  [TRIGGER] ${trigger.name}: ${trigger.cronExpr}`);
  }
}

export { runPipeline, validateCronExpr };
