/**
 * Jobb-routes — Lista, detaljer, loggar, skapa, avbryt
 */

import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

/**
 * GET /api/mailwise/jobs — Lista jobb
 *
 * Query: status, type, mailbox_id, page, limit
 */
router.get('/', async (req, res) => {
  try {
    const { status, type, mailbox_id, page = 1, limit = 50 } = req.query;

    const conditions = [];
    const values = [];

    if (status) { conditions.push('j.status = ?'); values.push(status); }
    if (type) { conditions.push('j.type = ?'); values.push(type); }
    if (mailbox_id) { conditions.push('j.mailbox_id = ?'); values.push(parseInt(mailbox_id)); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [countResult] = await pool.execute(`SELECT COUNT(*) as total FROM mw_jobs j ${where}`, values);

    const [rows] = await pool.execute(`
      SELECT j.*, mb.email as mailbox_email
      FROM mw_jobs j
      LEFT JOIN mw_mailboxes mb ON mb.id = j.mailbox_id
      ${where}
      ORDER BY j.created_at DESC
      LIMIT ? OFFSET ?
    `, [...values, parseInt(limit), offset]);

    res.json({
      jobs: rows,
      total: countResult[0].total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('  [MAILWISE] GET /jobs:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta jobb' });
  }
});

/**
 * GET /api/mailwise/jobs/:id — Jobbdetaljer
 */
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT j.*, mb.email as mailbox_email
      FROM mw_jobs j
      LEFT JOIN mw_mailboxes mb ON mb.id = j.mailbox_id
      WHERE j.id = ?
    `, [req.params.id]);

    if (rows.length === 0) return res.status(404).json({ error: 'Jobb finns inte' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte hämta jobb' });
  }
});

/**
 * GET /api/mailwise/jobs/:id/logs — Jobbloggar
 */
router.get('/:id/logs', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, level, message, data, created_at FROM mw_job_logs WHERE job_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte hämta jobbloggar' });
  }
});

/**
 * POST /api/mailwise/jobs — Skapa manuellt jobb
 *
 * Body: { type, mailbox_id, input_data }
 */
router.post('/', async (req, res) => {
  try {
    const { type, mailbox_id, input_data } = req.body;

    const validTypes = ['analyze_message', 'analyze_thread', 'extract_faq', 'batch_analyze', 'label_sync'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Ogiltig typ. Tillåtna: ${validTypes.join(', ')}` });
    }

    const [result] = await pool.execute(
      `INSERT INTO mw_jobs (mailbox_id, type, status, input_data) VALUES (?, ?, 'pending', ?)`,
      [mailbox_id || null, type, JSON.stringify(input_data || {})]
    );

    res.status(201).json({ ok: true, job_id: result.insertId });
  } catch (err) {
    console.error('  [MAILWISE] POST /jobs:', err.message);
    res.status(500).json({ error: 'Kunde inte skapa jobb' });
  }
});

/**
 * DELETE /api/mailwise/jobs/:id — Avbryt väntande jobb
 */
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.execute(
      `DELETE FROM mw_jobs WHERE id = ? AND status = 'pending'`,
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({ error: 'Jobbet kan inte avbrytas (inte pending)' });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte avbryta jobb' });
  }
});

export default router;
