/**
 * Monitor Checks — GET /api/monitor/checks
 */

import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/monitor/checks — Senaste checks med filter
router.get('/', async (req, res) => {
  try {
    const { site, type, status, limit = 50 } = req.query;

    let sql = 'SELECT * FROM mon_checks WHERE 1=1';
    const params = [];

    if (site) { sql += ' AND site_id = ?'; params.push(site); }
    if (type) { sql += ' AND check_type = ?'; params.push(type); }
    if (status) { sql += ' AND status = ?'; params.push(status); }

    sql += ' ORDER BY checked_at DESC LIMIT ?';
    params.push(parseInt(limit) || 50);

    const [rows] = await pool.execute(sql, params);
    res.json({ data: rows, meta: { count: rows.length } });
  } catch (err) {
    console.error('  [MONITOR] Checks-fel:', err.message);
    res.status(500).json({ error: 'Kunde inte hamta checks' });
  }
});

export default router;
