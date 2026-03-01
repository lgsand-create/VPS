/**
 * Västtrafik Metrics — Aggregering av avgångsstatistik
 *
 * Två lägen:
 *  - Nattlig (00:05): slutgiltig aggregering av gårdagen
 *  - Live (var 15 min): löpande aggregering av dagens data
 */

import pool from '../db/connection.js';

/**
 * Aggregera avgångar till daglig statistik
 * @param {string} [date] — YYYY-MM-DD, default = igår
 */
export async function rollupDailyMetrics(date) {
  let dateStr;
  if (date) {
    dateStr = date;
  } else {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dateStr = yesterday.toISOString().slice(0, 10);
  }

  console.log(`  [VASTTRAFIK] Rollup för ${dateStr}...`);

  try {
    // Hämta aggregerad data grupperad per stop + linje
    const [rows] = await pool.execute(`
      SELECT
        stop_id,
        line_name,
        COUNT(*) AS total_departures,
        SUM(is_cancelled) AS cancelled_count,
        SUM(CASE WHEN delay_seconds >= 180 THEN 1 ELSE 0 END) AS delayed_count,
        ROUND(AVG(delay_seconds)) AS avg_delay_seconds,
        MAX(delay_seconds) AS max_delay_seconds,
        ROUND(
          SUM(CASE WHEN ABS(delay_seconds) <= 120 AND is_cancelled = FALSE THEN 1 ELSE 0 END)
          * 100.0 / NULLIF(SUM(CASE WHEN is_cancelled = FALSE THEN 1 ELSE 0 END), 0),
          2
        ) AS on_time_pct
      FROM vt_departures
      WHERE DATE(scheduled_at) = ?
      GROUP BY stop_id, line_name
    `, [dateStr]);

    if (rows.length === 0) {
      console.log(`  [VASTTRAFIK] Rollup: inga avgångar för ${dateStr}`);
      return;
    }

    // Upsert varje kombination
    let inserted = 0;
    for (const row of rows) {
      await pool.execute(`
        INSERT INTO vt_daily_metrics
          (stop_id, line_name, date, total_departures, cancelled_count,
           delayed_count, avg_delay_seconds, max_delay_seconds, on_time_pct)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          total_departures = VALUES(total_departures),
          cancelled_count = VALUES(cancelled_count),
          delayed_count = VALUES(delayed_count),
          avg_delay_seconds = VALUES(avg_delay_seconds),
          max_delay_seconds = VALUES(max_delay_seconds),
          on_time_pct = VALUES(on_time_pct)
      `, [
        row.stop_id, row.line_name, dateStr,
        row.total_departures, row.cancelled_count || 0,
        row.delayed_count || 0, row.avg_delay_seconds || 0,
        row.max_delay_seconds || 0, row.on_time_pct,
      ]);
      inserted++;
    }

    console.log(`  [VASTTRAFIK] Rollup klar: ${inserted} rader för ${dateStr}`);
  } catch (err) {
    console.error(`  [VASTTRAFIK] Rollup-fel: ${err.message}`);
  }
}
