/**
 * Västtrafik Departures — Avgångsdata för dashboard
 */

import { Router } from 'express';
import pool from '../../db/connection.js';
import { getCachedDepartures } from '../../vasttrafik/api.js';

const router = Router();

// GET /api/vasttrafik/departures — Filtrerade avgångar från DB
router.get('/', async (req, res) => {
  try {
    const { stop, line, from, to, limit } = req.query;
    const conditions = [];
    const values = [];

    if (stop) { conditions.push('stop_id = ?'); values.push(stop); }
    if (line) { conditions.push('line_name = ?'); values.push(line); }
    if (from) { conditions.push('scheduled_at >= ?'); values.push(from); }
    if (to) { conditions.push('scheduled_at <= ?'); values.push(to); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const maxRows = Math.min(parseInt(limit || '200'), 1000);

    const [rows] = await pool.execute(
      `SELECT * FROM vt_departures ${where} ORDER BY scheduled_at DESC LIMIT ${maxRows}`,
      values
    );

    res.json({ data: rows, meta: { count: rows.length } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vasttrafik/departures/live — Realtid från memory-cache
router.get('/live', async (req, res) => {
  try {
    const stopIds = req.query.stop ? [].concat(req.query.stop) : [];

    if (stopIds.length === 0) {
      // Hämta alla cachade stops
      const [stops] = await pool.execute(
        'SELECT id, stop_area_gid, name FROM vt_stops WHERE enabled = TRUE ORDER BY sort_order'
      );
      for (const stop of stops) {
        stopIds.push(stop.id);
      }
    }

    // Hämta GIDs
    const [stopRows] = await pool.execute(
      `SELECT id, stop_area_gid, name FROM vt_stops WHERE id IN (${stopIds.map(() => '?').join(',') || "''"})`,
      stopIds
    );

    const result = {};
    for (const stop of stopRows) {
      const cached = getCachedDepartures(stop.stop_area_gid);
      result[stop.id] = {
        name: stop.name,
        departures: cached?.results || cached?.departures || [],
        cached: !!cached,
      };
    }

    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vasttrafik/departures/delays — Förseningsstatistik
router.get('/delays', async (req, res) => {
  try {
    const { stop, line, period } = req.query;
    const days = period === '30d' ? 30 : period === '24h' ? 1 : 7;

    const conditions = [`scheduled_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`];
    const values = [];

    if (stop) { conditions.push('stop_id = ?'); values.push(stop); }
    if (line) { conditions.push('line_name = ?'); values.push(line); }

    const where = conditions.join(' AND ');

    // Per linje + hållplats (pool.query istället för pool.execute — undviker BigInt/prepared stmt-problem)
    const whereAliasedLine = where
      .replace(/\bstop_id\b/g, 'd.stop_id')
      .replace(/\bline_name\b/g, 'd.line_name')
      .replace(/\bscheduled_at\b/g, 'd.scheduled_at');

    const [byLine] = await pool.query(`
      SELECT
        d.line_name,
        d.stop_id,
        s.name AS stop_name,
        COUNT(*) AS total,
        SUM(CASE WHEN d.delay_seconds >= 180 THEN 1 ELSE 0 END) AS delayed_count,
        SUM(CASE WHEN d.is_cancelled = 1 THEN 1 ELSE 0 END) AS cancelled,
        ROUND(AVG(d.delay_seconds)) AS avg_delay,
        MAX(d.delay_seconds) AS max_delay,
        ROUND(
          SUM(CASE WHEN ABS(d.delay_seconds) <= 120 AND d.is_cancelled = 0 THEN 1 ELSE 0 END)
          * 100.0 / NULLIF(COUNT(*), 0), 1
        ) AS on_time_pct
      FROM vt_departures d
      JOIN vt_stops s ON s.id = d.stop_id
      WHERE ${whereAliasedLine}
      GROUP BY d.line_name, d.stop_id, s.name
      ORDER BY d.line_name, total DESC
    `, values);

    // Per hållplats
    const whereAliased = where
      .replace(/\bstop_id\b/g, 'd.stop_id')
      .replace(/\bline_name\b/g, 'd.line_name')
      .replace(/\bscheduled_at\b/g, 'd.scheduled_at');

    const [byStop] = await pool.query(`
      SELECT
        d.stop_id,
        s.name AS stop_name,
        COUNT(*) AS total,
        SUM(CASE WHEN d.delay_seconds >= 180 THEN 1 ELSE 0 END) AS delayed_count,
        SUM(CASE WHEN d.is_cancelled = 1 THEN 1 ELSE 0 END) AS cancelled,
        ROUND(AVG(d.delay_seconds)) AS avg_delay,
        ROUND(
          SUM(CASE WHEN ABS(d.delay_seconds) <= 120 AND d.is_cancelled = 0 THEN 1 ELSE 0 END)
          * 100.0 / NULLIF(COUNT(*), 0), 1
        ) AS on_time_pct
      FROM vt_departures d
      JOIN vt_stops s ON s.id = d.stop_id
      WHERE ${whereAliased}
      GROUP BY d.stop_id, s.name
      ORDER BY total DESC
    `, values);

    // Trend per dag
    const [trend] = await pool.query(`
      SELECT
        DATE(scheduled_at) AS date,
        ROUND(AVG(delay_seconds)) AS avg_delay,
        COUNT(*) AS total,
        SUM(CASE WHEN delay_seconds >= 180 THEN 1 ELSE 0 END) AS delayed_count
      FROM vt_departures
      WHERE ${where}
      GROUP BY DATE(scheduled_at)
      ORDER BY date
    `, values);

    res.json({ data: { byLine, byStop, trend }, meta: { period: `${days}d` } });
  } catch (err) {
    console.error('  [VASTTRAFIK] delays error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vasttrafik/departures/line-history — Historik för en linje vid en hållplats
router.get('/line-history', async (req, res) => {
  try {
    const { stop, line } = req.query;
    if (!stop || !line) {
      return res.status(400).json({ error: 'stop och line krävs' });
    }

    // Daglig statistik senaste 7 dagarna
    const [daily] = await pool.execute(`
      SELECT date, total_departures, cancelled_count, delayed_count,
             avg_delay_seconds, max_delay_seconds, on_time_pct
      FROM vt_daily_metrics
      WHERE stop_id = ? AND line_name = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      ORDER BY date DESC
    `, [stop, line]);

    // Senaste 10 avgångarna för denna linje+hållplats
    const [recent] = await pool.execute(`
      SELECT scheduled_at, estimated_at, delay_seconds, is_cancelled, direction, track
      FROM vt_departures
      WHERE stop_id = ? AND line_name = ?
      ORDER BY scheduled_at DESC
      LIMIT 10
    `, [stop, line]);

    // Totalt snitt (alla dagar)
    const [summary] = await pool.execute(`
      SELECT
        ROUND(AVG(avg_delay_seconds)) AS avg_delay,
        ROUND(AVG(on_time_pct), 1) AS avg_on_time,
        SUM(total_departures) AS total_deps,
        SUM(cancelled_count) AS total_cancelled
      FROM vt_daily_metrics
      WHERE stop_id = ? AND line_name = ?
    `, [stop, line]);

    // Per timme (senaste 7 dagarna)
    const [byHour] = await pool.execute(`
      SELECT
        HOUR(scheduled_at) AS hour,
        COUNT(*) AS total,
        SUM(CASE WHEN delay_seconds >= 180 THEN 1 ELSE 0 END) AS delayed_count,
        SUM(CASE WHEN is_cancelled = 1 THEN 1 ELSE 0 END) AS cancelled,
        ROUND(AVG(delay_seconds)) AS avg_delay,
        ROUND(
          SUM(CASE WHEN ABS(delay_seconds) <= 120 AND is_cancelled = 0 THEN 1 ELSE 0 END)
          * 100.0 / NULLIF(COUNT(*), 0), 1
        ) AS on_time_pct
      FROM vt_departures
      WHERE stop_id = ? AND line_name = ? AND scheduled_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY HOUR(scheduled_at)
      ORDER BY hour
    `, [stop, line]);

    res.json({
      data: {
        daily,
        recent,
        summary: summary[0] || null,
        byHour,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
