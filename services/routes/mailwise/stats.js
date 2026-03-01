/**
 * Statistik-routes — Översikt, daglig, kategorier, trender
 */

import { Router } from 'express';
import pool from '../../db/connection.js';
import { testOllamaConnection } from '../../mailwise/llm.js';

const router = Router();

/**
 * GET /api/mailwise/stats — Översiktsstatistik (projektkortet + dashboard)
 */
router.get('/', async (req, res) => {
  try {
    // Brevlådor
    const [mbCount] = await pool.execute('SELECT COUNT(*) as total, SUM(enabled) as active FROM mw_mailboxes');

    // Meddelanden
    const [msgCount] = await pool.execute(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN analyzed_at IS NOT NULL THEN 1 ELSE 0 END) as analyzed,
             SUM(CASE WHEN analyzed_at IS NULL THEN 1 ELSE 0 END) as pending,
             SUM(CASE WHEN date > DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) as last_24h
      FROM mw_messages
    `);

    // FAQs
    const [faqCount] = await pool.execute(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN approved = TRUE THEN 1 ELSE 0 END) as approved,
             SUM(CASE WHEN approved = FALSE AND archived = FALSE THEN 1 ELSE 0 END) as pending
      FROM mw_faqs WHERE archived = FALSE
    `);

    // Jobb
    const [jobCount] = await pool.execute(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
             SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM mw_jobs
    `);

    // Kategorifördelning (alla meddelanden)
    const [categories] = await pool.execute(`
      SELECT category, COUNT(*) as cnt FROM mw_messages
      WHERE category IS NOT NULL
      GROUP BY category ORDER BY cnt DESC
    `);
    const categoryMap = {};
    for (const row of categories) categoryMap[row.category] = row.cnt;

    // Ollama-status (cachad — testa inte vid varje anrop)
    let llmStatus = 'unknown';
    try {
      const ollamaTest = await testOllamaConnection();
      llmStatus = ollamaTest.ok ? 'online' : 'offline';
    } catch {
      llmStatus = 'offline';
    }

    res.json({
      // Projektkortet
      active_mailboxes: mbCount[0].active || 0,
      total_messages: msgCount[0].total || 0,
      faqs_approved: faqCount[0].approved || 0,
      messages_24h: msgCount[0].last_24h || 0,

      // Detaljvy
      mailboxes: {
        total: mbCount[0].total || 0,
        active: mbCount[0].active || 0,
      },
      messages: {
        total: msgCount[0].total || 0,
        analyzed: msgCount[0].analyzed || 0,
        pending: msgCount[0].pending || 0,
        last_24h: msgCount[0].last_24h || 0,
      },
      faqs: {
        total: faqCount[0].total || 0,
        approved: faqCount[0].approved || 0,
        pending: faqCount[0].pending || 0,
      },
      jobs: jobCount[0],
      categories: categoryMap,
      llm_status: llmStatus,
    });
  } catch (err) {
    console.error('  [MAILWISE] GET /stats:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta statistik' });
  }
});

/**
 * GET /api/mailwise/stats/daily — Daglig statistik
 *
 * Query: mailbox_id, from, to
 */
router.get('/daily', async (req, res) => {
  try {
    const { mailbox_id, from, to } = req.query;

    const conditions = [];
    const values = [];

    if (mailbox_id) { conditions.push('d.mailbox_id = ?'); values.push(parseInt(mailbox_id)); }
    if (from) { conditions.push('d.date >= ?'); values.push(from); }
    if (to) { conditions.push('d.date <= ?'); values.push(to); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await pool.execute(`
      SELECT d.*, mb.email as mailbox_email
      FROM mw_daily_metrics d
      LEFT JOIN mw_mailboxes mb ON mb.id = d.mailbox_id
      ${where}
      ORDER BY d.date DESC
      LIMIT 365
    `, values);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte hämta daglig statistik' });
  }
});

/**
 * GET /api/mailwise/stats/categories — Kategorifördelning
 */
router.get('/categories', async (req, res) => {
  try {
    const { mailbox_id } = req.query;

    let query = `
      SELECT category, COUNT(*) as count,
             ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM mw_messages WHERE category IS NOT NULL), 1) as percentage
      FROM mw_messages
      WHERE category IS NOT NULL
    `;
    const values = [];

    if (mailbox_id) {
      query += ' AND mailbox_id = ?';
      values.push(parseInt(mailbox_id));
    }

    query += ' GROUP BY category ORDER BY count DESC';

    const [rows] = await pool.execute(query, values);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte hämta kategorier' });
  }
});

/**
 * GET /api/mailwise/stats/trends — Trender
 *
 * Query: period (7d, 30d, 90d)
 */
router.get('/trends', async (req, res) => {
  try {
    const period = req.query.period || '7d';
    const days = parseInt(period) || 7;

    const [daily] = await pool.execute(`
      SELECT date, SUM(messages_received) as messages,
             SUM(messages_analyzed) as analyzed,
             SUM(faqs_extracted) as faqs
      FROM mw_daily_metrics
      WHERE date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY date ORDER BY date ASC
    `, [days]);

    // Sentimenttrend
    const [sentimentTrend] = await pool.execute(`
      SELECT DATE(date) as day, sentiment, COUNT(*) as cnt
      FROM mw_messages
      WHERE date >= DATE_SUB(NOW(), INTERVAL ? DAY) AND sentiment IS NOT NULL
      GROUP BY DATE(date), sentiment
      ORDER BY day ASC
    `, [days]);

    res.json({ daily, sentimentTrend });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte hämta trender' });
  }
});

export default router;
