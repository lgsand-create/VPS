/**
 * Monitor Metrics — GET /api/monitor/metrics/:siteId
 */

import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/monitor/metrics/:siteId — Dagliga metrics for grafer
router.get('/:siteId', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const limitDays = Math.min(parseInt(days) || 30, 365);

    const [rows] = await pool.execute(`
      SELECT * FROM mon_daily_metrics
      WHERE site_id = ?
      ORDER BY date DESC
      LIMIT ?
    `, [req.params.siteId, limitDays]);

    // Returnera i kronologisk ordning (aldst forst)
    res.json({
      data: rows.reverse(),
      meta: { count: rows.length, siteId: req.params.siteId },
    });
  } catch (err) {
    console.error('  [MONITOR] Metrics-fel:', err.message);
    res.status(500).json({ error: 'Kunde inte hamta metrics' });
  }
});

export default router;
