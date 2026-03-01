/**
 * FAQ-routes — CRUD + extraktion + export
 */

import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

/**
 * GET /api/mailwise/faqs — Lista FAQs
 *
 * Query: mailbox_id, approved, archived, tag, q, page, limit
 */
router.get('/', async (req, res) => {
  try {
    const { mailbox_id, approved, archived, tag, q, page = 1, limit = 50 } = req.query;

    const conditions = [];
    const values = [];

    if (mailbox_id) { conditions.push('f.mailbox_id = ?'); values.push(parseInt(mailbox_id)); }
    if (approved === 'true') conditions.push('f.approved = TRUE');
    if (approved === 'false') conditions.push('f.approved = FALSE');
    if (archived === 'true') conditions.push('f.archived = TRUE');
    if (archived !== 'true') conditions.push('f.archived = FALSE');  // Default: dölj arkiverade
    if (tag) { conditions.push('JSON_CONTAINS(f.tags, ?)'); values.push(JSON.stringify(tag)); }
    if (q) {
      conditions.push('(f.question LIKE ? OR f.answer LIKE ?)');
      values.push(`%${q}%`, `%${q}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [countResult] = await pool.execute(`SELECT COUNT(*) as total FROM mw_faqs f ${where}`, values);

    const [rows] = await pool.execute(`
      SELECT f.*, mb.email as mailbox_email
      FROM mw_faqs f
      LEFT JOIN mw_mailboxes mb ON mb.id = f.mailbox_id
      ${where}
      ORDER BY f.confidence DESC, f.created_at DESC
      LIMIT ? OFFSET ?
    `, [...values, parseInt(limit), offset]);

    res.json({
      faqs: rows,
      total: countResult[0].total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('  [MAILWISE] GET /faqs:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta FAQs' });
  }
});

/**
 * GET /api/mailwise/faqs/:id — Enskild FAQ
 */
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM mw_faqs WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'FAQ finns inte' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte hämta FAQ' });
  }
});

/**
 * PUT /api/mailwise/faqs/:id — Redigera FAQ
 */
router.put('/:id', async (req, res) => {
  try {
    const { question, answer, tags } = req.body;
    const updates = [];
    const values = [];

    if (question !== undefined) { updates.push('question = ?'); values.push(question); }
    if (answer !== undefined) { updates.push('answer = ?'); values.push(answer); }
    if (tags !== undefined) { updates.push('tags = ?'); values.push(JSON.stringify(tags)); }

    if (updates.length === 0) return res.status(400).json({ error: 'Inga fält att uppdatera' });

    values.push(req.params.id);
    await pool.execute(`UPDATE mw_faqs SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte uppdatera FAQ' });
  }
});

/**
 * PUT /api/mailwise/faqs/:id/approve — Godkänn FAQ
 */
router.put('/:id/approve', async (req, res) => {
  try {
    await pool.execute('UPDATE mw_faqs SET approved = TRUE WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte godkänna FAQ' });
  }
});

/**
 * PUT /api/mailwise/faqs/:id/archive — Arkivera FAQ
 */
router.put('/:id/archive', async (req, res) => {
  try {
    await pool.execute('UPDATE mw_faqs SET archived = TRUE WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte arkivera FAQ' });
  }
});

/**
 * DELETE /api/mailwise/faqs/:id — Ta bort FAQ
 */
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM mw_faqs WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'FAQ finns inte' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte ta bort FAQ' });
  }
});

/**
 * POST /api/mailwise/faqs/extract — Starta FAQ-extraktion för tråd(ar)
 *
 * Body: { mailbox_id, thread_ids: [...] }
 */
router.post('/extract', async (req, res) => {
  try {
    const { mailbox_id, thread_ids } = req.body;

    if (!mailbox_id || !thread_ids || !Array.isArray(thread_ids)) {
      return res.status(400).json({ error: 'mailbox_id och thread_ids[] krävs' });
    }

    const [result] = await pool.execute(
      `INSERT INTO mw_jobs (mailbox_id, type, status, total_items, input_data)
       VALUES (?, 'extract_faq', 'pending', ?, ?)`,
      [mailbox_id, thread_ids.length, JSON.stringify({ threadIds: thread_ids, mailboxId: mailbox_id })]
    );

    res.json({ ok: true, job_id: result.insertId });
  } catch (err) {
    console.error('  [MAILWISE] POST /faqs/extract:', err.message);
    res.status(500).json({ error: 'Kunde inte starta FAQ-extraktion' });
  }
});

/**
 * GET /api/mailwise/faqs/export — Exportera godkända FAQs
 */
router.get('/export', async (req, res) => {
  // Obs: denna route matchar före /:id pga "export" — ingen konflikt med parseInt
  try {
    const mailbox_id = req.query.mailbox_id;
    const conditions = ['f.approved = TRUE', 'f.archived = FALSE'];
    const values = [];

    if (mailbox_id) {
      conditions.push('f.mailbox_id = ?');
      values.push(parseInt(mailbox_id));
    }

    const [rows] = await pool.execute(`
      SELECT f.question, f.answer, f.tags, f.confidence, f.created_at,
             mb.email as mailbox_email
      FROM mw_faqs f
      LEFT JOIN mw_mailboxes mb ON mb.id = f.mailbox_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY f.confidence DESC
    `, values);

    res.json({
      exported_at: new Date().toISOString(),
      count: rows.length,
      faqs: rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte exportera FAQs' });
  }
});

export default router;
