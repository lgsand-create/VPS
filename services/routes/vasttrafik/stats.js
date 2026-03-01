/**
 * Västtrafik Stats — Projektöversikt för dashboard-kortet
 */

import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/vasttrafik/stats — Sammanfattning
router.get('/', async (req, res) => {
  try {
    // Aktiva hållplatser
    const [[{ active_stops }]] = await pool.execute(
      'SELECT COUNT(*) AS active_stops FROM vt_stops WHERE enabled = TRUE'
    );

    // Totalt avgångar (senaste 24h)
    const [[{ total_24h }]] = await pool.execute(
      'SELECT COUNT(*) AS total_24h FROM vt_departures WHERE fetched_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)'
    );

    // Punktlighet (senaste 24h) — andel inom 120s
    const [[pctRow]] = await pool.execute(`
      SELECT
        ROUND(
          SUM(CASE WHEN ABS(delay_seconds) <= 120 AND is_cancelled = FALSE THEN 1 ELSE 0 END)
          * 100.0 / NULLIF(SUM(CASE WHEN is_cancelled = FALSE THEN 1 ELSE 0 END), 0),
          1
        ) AS on_time_pct,
        ROUND(AVG(delay_seconds)) AS avg_delay,
        SUM(is_cancelled) AS cancelled_24h
      FROM vt_departures
      WHERE fetched_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);

    // Senaste poll
    const [[lastPoll]] = await pool.execute(
      'SELECT MAX(fetched_at) AS last_poll FROM vt_departures'
    );

    // Antal linjer som bevakas
    const [[{ line_count }]] = await pool.execute(`
      SELECT COUNT(DISTINCT line_name) AS line_count
      FROM vt_departures
      WHERE fetched_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);

    res.json({
      data: {
        aktiva_hallplatser: active_stops,
        avgangar_24h: total_24h,
        linjer: line_count,
        i_tid_pct: pctRow.on_time_pct || 0,
        genomsnittlig_forsening: pctRow.avg_delay ? `${Math.round(pctRow.avg_delay / 60)} min` : '—',
        installda_24h: pctRow.cancelled_24h || 0,
        senaste_poll: lastPoll.last_poll || null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
