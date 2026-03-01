/**
 * MailWise Metrics — Daglig statistikrollup
 *
 * Aggregerar meddelande- och analysdata till mw_daily_metrics.
 */

import pool from '../db/connection.js';

/**
 * Skapa/uppdatera daglig statistik
 *
 * @param {string} dateStr - YYYY-MM-DD (default: igår)
 */
export async function rollupDailyMetrics(dateStr) {
  if (!dateStr) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dateStr = yesterday.toISOString().slice(0, 10);
  }

  // Hämta alla aktiva brevlådor
  const [mailboxes] = await pool.execute(
    'SELECT id FROM mw_mailboxes WHERE enabled = TRUE'
  );

  for (const mailbox of mailboxes) {
    try {
      await rollupForMailbox(mailbox.id, dateStr);
    } catch (err) {
      console.error(`  [MAILWISE] Rollup brevlåda ${mailbox.id}: ${err.message}`);
    }
  }
}

/**
 * Rollup för en enskild brevlåda
 */
async function rollupForMailbox(mailboxId, dateStr) {
  // Räkna mottagna meddelanden
  const [received] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM mw_messages WHERE mailbox_id = ? AND DATE(date) = ?`,
    [mailboxId, dateStr]
  );

  // Räkna analyserade meddelanden
  const [analyzed] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM mw_messages WHERE mailbox_id = ? AND DATE(analyzed_at) = ?`,
    [mailboxId, dateStr]
  );

  // Räkna extraherade FAQs
  const [faqs] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM mw_faqs WHERE mailbox_id = ? AND DATE(created_at) = ?`,
    [mailboxId, dateStr]
  );

  // Räkna genererade svar
  const [drafts] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM mw_draft_replies WHERE mailbox_id = ? AND DATE(created_at) = ?`,
    [mailboxId, dateStr]
  );

  // Kategorifördelning
  const [categories] = await pool.execute(
    `SELECT category, COUNT(*) as cnt FROM mw_messages
     WHERE mailbox_id = ? AND DATE(date) = ? AND category IS NOT NULL
     GROUP BY category`,
    [mailboxId, dateStr]
  );
  const categoryBreakdown = {};
  for (const row of categories) {
    categoryBreakdown[row.category] = row.cnt;
  }

  // Prioritetsfördelning
  const [priorities] = await pool.execute(
    `SELECT priority, COUNT(*) as cnt FROM mw_messages
     WHERE mailbox_id = ? AND DATE(date) = ? AND priority IS NOT NULL
     GROUP BY priority`,
    [mailboxId, dateStr]
  );
  const priorityBreakdown = {};
  for (const row of priorities) {
    priorityBreakdown[row.priority] = row.cnt;
  }

  // Sentimentfördelning
  const [sentiments] = await pool.execute(
    `SELECT sentiment, COUNT(*) as cnt FROM mw_messages
     WHERE mailbox_id = ? AND DATE(date) = ? AND sentiment IS NOT NULL
     GROUP BY sentiment`,
    [mailboxId, dateStr]
  );
  const sentimentBreakdown = {};
  for (const row of sentiments) {
    sentimentBreakdown[row.sentiment] = row.cnt;
  }

  // Upsert daglig statistik
  await pool.execute(`
    INSERT INTO mw_daily_metrics
      (mailbox_id, date, messages_received, messages_analyzed, faqs_extracted,
       drafts_generated, category_breakdown, priority_breakdown, sentiment_breakdown)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      messages_received = VALUES(messages_received),
      messages_analyzed = VALUES(messages_analyzed),
      faqs_extracted = VALUES(faqs_extracted),
      drafts_generated = VALUES(drafts_generated),
      category_breakdown = VALUES(category_breakdown),
      priority_breakdown = VALUES(priority_breakdown),
      sentiment_breakdown = VALUES(sentiment_breakdown)
  `, [
    mailboxId, dateStr,
    received[0].cnt, analyzed[0].cnt, faqs[0].cnt, drafts[0].cnt,
    JSON.stringify(categoryBreakdown),
    JSON.stringify(priorityBreakdown),
    JSON.stringify(sentimentBreakdown),
  ]);
}
