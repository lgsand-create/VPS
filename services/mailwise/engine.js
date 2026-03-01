/**
 * MailWise Engine — Gmail-synkning och jobbbearbetning
 *
 * Modellerad efter vasttrafik/engine.js. Körs inuti server.js,
 * startas vid boot och synkar brevlådor periodiskt.
 */

import cron from 'node-cron';
import pool from '../db/connection.js';
import { getProject } from '../projects/index.js';
import { getSettings } from '../db/settings.js';

const activeTasks = [];
let cachedMailboxes = [];

/**
 * Starta MailWise-motorn
 */
export async function startMailWise() {
  let config;
  try {
    config = getProject('mailwise');
  } catch {
    console.log('  [MAILWISE] Projekt ej registrerat — hoppar över');
    return;
  }

  // Kolla om MailWise är aktiverad
  try {
    const settings = await getSettings('mailwise');
    if (settings?.enabled !== 'true') {
      console.log('  [MAILWISE] Inaktiverad i inställningar — hoppar över');
      console.log('  [MAILWISE] Aktivera via Dashboard → Inställningar → MailWise');
      return;
    }
  } catch {
    console.log('  [MAILWISE] Kunde inte läsa inställningar — kör migration 036 först');
    return;
  }

  // Ladda aktiva brevlådor
  await reloadMailboxes();

  if (cachedMailboxes.length === 0) {
    console.log('  [MAILWISE] Inga brevlådor konfigurerade');
    console.log('  [MAILWISE] Lägg till via Dashboard → MailWise → Brevlådor');
  } else {
    console.log(`  [MAILWISE] ${cachedMailboxes.length} brevlåd(or): ${cachedMailboxes.map(m => m.email || m.display_name || `#${m.id}`).join(', ')}`);
  }

  // Gmail-synk (var 5:e minut)
  const syncTask = cron.schedule(config.intervals.sync, () => {
    syncAllMailboxes();
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(syncTask);

  // Jobbbearbetning (var 15:e minut)
  const analysisTask = cron.schedule(config.intervals.analysis, () => {
    processAnalysisJobs();
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(analysisTask);

  // Daglig statistikrollup (00:05)
  const rollupTask = cron.schedule(config.intervals.rollup, async () => {
    try {
      const { rollupDailyMetrics } = await import('./metrics.js');
      await rollupDailyMetrics();
    } catch (err) {
      console.error(`  [MAILWISE] Rollup-fel: ${err.message}`);
    }
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(rollupTask);

  // Daglig cleanup (00:15)
  const cleanupTask = cron.schedule(config.intervals.cleanup, () => {
    cleanup();
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(cleanupTask);

  // Token-förnyelse (var 30:e minut)
  const tokenTask = cron.schedule(config.intervals.tokenRefresh, () => {
    checkTokenExpiry();
  }, { timezone: 'Europe/Stockholm' });
  activeTasks.push(tokenTask);

  console.log('  [MAILWISE] Engine startad\n');
}

/**
 * Stoppa alla cron-tasks
 */
export function stopMailWise() {
  for (const task of activeTasks) task.stop();
  activeTasks.length = 0;
  cachedMailboxes = [];
  console.log('  [MAILWISE] Stoppad');
}

/**
 * Ladda om aktiva brevlådor från DB
 */
async function reloadMailboxes() {
  try {
    const [rows] = await pool.execute(
      'SELECT id, email, display_name, history_id, enabled FROM mw_mailboxes WHERE enabled = TRUE'
    );
    cachedMailboxes = rows;
  } catch (err) {
    console.log(`  [MAILWISE] Kunde inte ladda brevlådor: ${err.message}`);
  }
}

/**
 * Synka alla aktiva brevlådor
 */
async function syncAllMailboxes() {
  await reloadMailboxes();
  if (cachedMailboxes.length === 0) return;

  for (const mailbox of cachedMailboxes) {
    try {
      await syncMailbox(mailbox);
    } catch (err) {
      console.error(`  [MAILWISE] Synk ${mailbox.email || mailbox.id}: ${err.message}`);
      await pool.execute(
        `UPDATE mw_mailboxes SET sync_status = 'error', sync_error = ? WHERE id = ?`,
        [err.message.slice(0, 500), mailbox.id]
      ).catch(() => {});
    }
  }
}

/**
 * Synka en enskild brevlåda
 */
async function syncMailbox(mailbox) {
  // Markera som synkande
  await pool.execute(
    `UPDATE mw_mailboxes SET sync_status = 'syncing' WHERE id = ?`,
    [mailbox.id]
  );

  const { initialSync, incrementalSync, syncLabels } = await import('./sync.js');

  let result;
  if (mailbox.history_id) {
    // Inkrementell synk
    result = await incrementalSync(mailbox.id, mailbox.history_id);

    if (result.needsFullSync) {
      // History ID ogiltigt — kör full synk
      console.log(`  [MAILWISE] ${mailbox.email}: Kör full omsynk`);
      result = await initialSync(mailbox.id);
    }
  } else {
    // Första synken
    result = await initialSync(mailbox.id);
  }

  // Synka etiketter
  await syncLabels(mailbox.id);

  // Uppdatera sync-status
  const historyId = result.historyId || result.newHistoryId || mailbox.history_id;
  await pool.execute(
    `UPDATE mw_mailboxes SET sync_status = 'idle', sync_error = NULL,
     last_sync_at = NOW(), history_id = ? WHERE id = ?`,
    [historyId, mailbox.id]
  );

  // Köa analysjobb om auto_analyze är aktiverad
  const settings = await getSettings('mailwise');
  if (settings?.auto_analyze === 'true') {
    await queueUnanalyzedMessages(mailbox.id);
  }
}

/**
 * Köa oanalyserade meddelanden för LLM-analys
 */
async function queueUnanalyzedMessages(mailboxId) {
  const [unanalyzed] = await pool.execute(
    `SELECT id, gmail_id FROM mw_messages
     WHERE mailbox_id = ? AND analyzed_at IS NULL
     ORDER BY date DESC LIMIT 50`,
    [mailboxId]
  );

  if (unanalyzed.length === 0) return;

  // Kolla om det redan finns ett väntande batch-jobb
  const [existing] = await pool.execute(
    `SELECT id FROM mw_jobs
     WHERE mailbox_id = ? AND type = 'batch_analyze' AND status IN ('pending', 'processing')
     LIMIT 1`,
    [mailboxId]
  );

  if (existing.length > 0) return;

  // Skapa batch-jobb
  const messageIds = unanalyzed.map(m => m.id);
  await pool.execute(
    `INSERT INTO mw_jobs (mailbox_id, type, status, total_items, input_data)
     VALUES (?, 'batch_analyze', 'pending', ?, ?)`,
    [mailboxId, messageIds.length, JSON.stringify({ messageIds })]
  );
}

/**
 * Bearbeta väntande analysjobb
 */
async function processAnalysisJobs() {
  try {
    const { processNextJob } = await import('./jobs.js');

    // Bearbeta upp till 5 jobb per omgång
    for (let i = 0; i < 5; i++) {
      const processed = await processNextJob();
      if (!processed) break;  // Inga fler jobb
    }
  } catch (err) {
    console.error(`  [MAILWISE] Jobbbearbetning: ${err.message}`);
  }
}

/**
 * Kontrollera token-utgång och förnya i förtid
 */
async function checkTokenExpiry() {
  try {
    const [expiring] = await pool.execute(
      `SELECT id, email FROM mw_mailboxes
       WHERE enabled = TRUE AND token_expires_at IS NOT NULL
       AND token_expires_at < DATE_ADD(NOW(), INTERVAL 30 MINUTE)`,
    );

    for (const mailbox of expiring) {
      try {
        const { getAccessToken } = await import('./gmail.js');
        await getAccessToken(mailbox.id);
      } catch (err) {
        console.warn(`  [MAILWISE] Token-förnyelse ${mailbox.email}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`  [MAILWISE] Token-check: ${err.message}`);
  }
}

/**
 * Städa gammal data enligt retention_days
 */
async function cleanup() {
  try {
    const settings = await getSettings('mailwise');
    const retentionDays = parseInt(settings?.retention_days || '365');

    // Radera gamla meddelanden
    const [msgResult] = await pool.execute(
      'DELETE FROM mw_messages WHERE date < DATE_SUB(NOW(), INTERVAL ? DAY)',
      [retentionDays]
    );
    if (msgResult.affectedRows > 0) {
      console.log(`  [MAILWISE] Cleanup: ${msgResult.affectedRows} meddelanden raderade (>${retentionDays}d)`);
    }

    // Radera tomma trådar
    await pool.execute(`
      DELETE t FROM mw_threads t
      LEFT JOIN mw_messages m ON m.mailbox_id = t.mailbox_id AND m.thread_id = t.gmail_thread_id
      WHERE m.id IS NULL AND t.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);

    // Radera gamla avslutade jobb (>30 dagar)
    await pool.execute(
      `DELETE FROM mw_jobs WHERE status IN ('completed', 'failed') AND finished_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );

    // Radera gamla jobbloggar (>7 dagar)
    await pool.execute(
      `DELETE FROM mw_job_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );

    // Radera gamla dagliga metrics (>retention)
    await pool.execute(
      'DELETE FROM mw_daily_metrics WHERE date < DATE_SUB(CURDATE(), INTERVAL ? DAY)',
      [retentionDays]
    );
  } catch (err) {
    console.error(`  [MAILWISE] Cleanup-fel: ${err.message}`);
  }
}
