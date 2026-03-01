/**
 * Monitor Incidents — GET/POST /api/monitor/incidents
 */

import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/monitor/incidents — Incidenter med filter
router.get('/', async (req, res) => {
  try {
    const { site, status, limit = 30 } = req.query;

    let sql = 'SELECT * FROM mon_incidents WHERE 1=1';
    const params = [];

    if (site) { sql += ' AND site_id = ?'; params.push(site); }
    if (status) { sql += ' AND status = ?'; params.push(status); }

    sql += ' ORDER BY opened_at DESC LIMIT ?';
    params.push(parseInt(limit) || 30);

    const [rows] = await pool.execute(sql, params);
    res.json({ data: rows, meta: { count: rows.length } });
  } catch (err) {
    console.error('  [MONITOR] Incidents-fel:', err.message);
    res.status(500).json({ error: 'Kunde inte hamta incidenter' });
  }
});

// POST /api/monitor/incidents/:id/acknowledge — Kvittera incident
router.post('/:id/acknowledge', async (req, res) => {
  try {
    const [result] = await pool.execute(
      `UPDATE mon_incidents SET status = 'acknowledged', acknowledged_at = NOW()
       WHERE id = ? AND status = 'open'`,
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Incident ej funnen eller redan kvitterad' });
    }

    res.json({ ok: true, message: 'Incident kvitterad' });
  } catch (err) {
    console.error('  [MONITOR] Acknowledge-fel:', err.message);
    res.status(500).json({ error: 'Kunde inte kvittera incident' });
  }
});

export default router;
