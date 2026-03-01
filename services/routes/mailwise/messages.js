/**
 * Meddelande-routes — Inkorg, meddelandedetaljer, trådvy, omanalys
 */

import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

/**
 * GET /api/mailwise/messages — Lista meddelanden (paginerad + filterbar)
 *
 * Query: mailbox_id, category, priority, sentiment, q, unanalyzed, page, limit
 */
router.get('/', async (req, res) => {
  try {
    const {
      mailbox_id,
      category,
      priority,
      sentiment,
      q,
      unanalyzed,
      page = 1,
      limit = 50,
    } = req.query;

    const conditions = [];
    const values = [];

    if (mailbox_id) { conditions.push('m.mailbox_id = ?'); values.push(parseInt(mailbox_id)); }
    if (category) { conditions.push('m.category = ?'); values.push(category); }
    if (priority) { conditions.push('m.priority = ?'); values.push(priority); }
    if (sentiment) { conditions.push('m.sentiment = ?'); values.push(sentiment); }
    if (unanalyzed === 'true') { conditions.push('m.analyzed_at IS NULL'); }
    if (q) {
      conditions.push('(m.subject LIKE ? OR m.from_name LIKE ? OR m.from_address LIKE ? OR m.snippet LIKE ?)');
      const like = `%${q}%`;
      values.push(like, like, like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Räkna totalt
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM mw_messages m ${where}`,
      values
    );

    // Hämta meddelanden
    const [rows] = await pool.execute(`
      SELECT m.id, m.mailbox_id, m.gmail_id, m.thread_id, m.subject,
             m.from_address, m.from_name, m.date, m.snippet,
             m.labels, m.is_read, m.is_starred, m.has_attachments,
             m.category, m.priority, m.sentiment, m.summary, m.analyzed_at,
             mb.email as mailbox_email, mb.display_name as mailbox_name
      FROM mw_messages m
      LEFT JOIN mw_mailboxes mb ON mb.id = m.mailbox_id
      ${where}
      ORDER BY m.date DESC
      LIMIT ? OFFSET ?
    `, [...values, parseInt(limit), offset]);

    res.json({
      messages: rows,
      total: countResult[0].total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(countResult[0].total / parseInt(limit)),
    });
  } catch (err) {
    console.error('  [MAILWISE] GET /messages:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta meddelanden' });
  }
});

/**
 * GET /api/mailwise/messages/:id — Fullständigt meddelande med analys
 */
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT m.*, mb.email as mailbox_email, mb.display_name as mailbox_name
      FROM mw_messages m
      LEFT JOIN mw_mailboxes mb ON mb.id = m.mailbox_id
      WHERE m.id = ?
    `, [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Meddelande finns inte' });
    }

    // Hämta eventuella svarsförslag
    const [drafts] = await pool.execute(
      'SELECT id, draft_text, tone, confidence, used, created_at FROM mw_draft_replies WHERE message_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );

    res.json({ ...rows[0], drafts });
  } catch (err) {
    console.error('  [MAILWISE] GET /messages/:id:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta meddelande' });
  }
});

/**
 * GET /api/mailwise/messages/:id/thread — Hela tråden
 */
router.get('/:id/thread', async (req, res) => {
  try {
    // Hämta meddelandets thread_id
    const [msg] = await pool.execute(
      'SELECT mailbox_id, thread_id FROM mw_messages WHERE id = ?',
      [req.params.id]
    );

    if (msg.length === 0) {
      return res.status(404).json({ error: 'Meddelande finns inte' });
    }

    if (!msg[0].thread_id) {
      return res.json({ messages: [], thread: null });
    }

    // Hämta alla meddelanden i tråden
    const [messages] = await pool.execute(`
      SELECT id, gmail_id, subject, from_address, from_name, date,
             snippet, body_text, category, priority, sentiment, summary, analyzed_at
      FROM mw_messages
      WHERE mailbox_id = ? AND thread_id = ?
      ORDER BY date ASC
    `, [msg[0].mailbox_id, msg[0].thread_id]);

    // Hämta tråd-metadata
    const [thread] = await pool.execute(
      'SELECT * FROM mw_threads WHERE mailbox_id = ? AND gmail_thread_id = ?',
      [msg[0].mailbox_id, msg[0].thread_id]
    );

    res.json({
      messages,
      thread: thread[0] || null,
    });
  } catch (err) {
    console.error('  [MAILWISE] GET /messages/:id/thread:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta tråd' });
  }
});

/**
 * POST /api/mailwise/messages/:id/analyze — Trigger omanalys
 */
router.post('/:id/analyze', async (req, res) => {
  try {
    const messageId = parseInt(req.params.id);

    // Kolla att meddelandet finns
    const [msg] = await pool.execute(
      'SELECT id, mailbox_id FROM mw_messages WHERE id = ?',
      [messageId]
    );
    if (msg.length === 0) {
      return res.status(404).json({ error: 'Meddelande finns inte' });
    }

    // Skapa analysjobb
    const [result] = await pool.execute(
      `INSERT INTO mw_jobs (mailbox_id, type, status, total_items, input_data)
       VALUES (?, 'analyze_message', 'pending', 1, ?)`,
      [msg[0].mailbox_id, JSON.stringify({ messageIds: [messageId] })]
    );

    res.json({ ok: true, job_id: result.insertId });
  } catch (err) {
    console.error('  [MAILWISE] POST /messages/:id/analyze:', err.message);
    res.status(500).json({ error: 'Kunde inte skapa analysjobb' });
  }
});

/**
 * GET /api/mailwise/messages/:id/drafts — Hämta svarsförslag
 */
router.get('/:id/drafts', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, draft_text, tone, confidence, used, created_at FROM mw_draft_replies WHERE message_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('  [MAILWISE] GET /messages/:id/drafts:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta svarsförslag' });
  }
});

/**
 * POST /api/mailwise/messages/:id/draft — Generera nytt svarsförslag
 */
router.post('/:id/draft', async (req, res) => {
  try {
    const messageId = parseInt(req.params.id);
    const tone = req.body.tone || 'friendly';

    const [msg] = await pool.execute(
      'SELECT id, mailbox_id FROM mw_messages WHERE id = ?',
      [messageId]
    );
    if (msg.length === 0) {
      return res.status(404).json({ error: 'Meddelande finns inte' });
    }

    // Skapa jobb för svargenerering
    const [result] = await pool.execute(
      `INSERT INTO mw_jobs (mailbox_id, type, status, total_items, input_data)
       VALUES (?, 'analyze_message', 'pending', 1, ?)`,
      [msg[0].mailbox_id, JSON.stringify({ messageIds: [messageId], generateDraft: true, tone })]
    );

    res.json({ ok: true, job_id: result.insertId });
  } catch (err) {
    console.error('  [MAILWISE] POST /messages/:id/draft:', err.message);
    res.status(500).json({ error: 'Kunde inte skapa svarsjobb' });
  }
});

export default router;
