/**
 * Metrics — daglig rollup av mon_checks till mon_daily_metrics
 *
 * Kors 00:05 varje natt. Aggregerar gardagens HTTP-checks
 * till uptime-procent, svarstider och felantal.
 */

import pool from '../db/connection.js';

export async function rollupDailyMetrics() {
  // Berakna for gardagen
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  let sites;
  try {
    [sites] = await pool.execute('SELECT id FROM mon_sites WHERE enabled = TRUE');
  } catch (err) {
    console.error(`  [MONITOR] Rollup: Kunde inte hamta sajter: ${err.message}`);
    return;
  }

  let processed = 0;

  for (const site of sites) {
    try {
      // Aggregera HTTP-checks for gardagen
      const [agg] = await pool.execute(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status IN ('critical','error') THEN 1 ELSE 0 END) AS failed,
          ROUND(AVG(response_ms)) AS avg_ms,
          MAX(response_ms) AS max_ms,
          MIN(response_ms) AS min_ms
        FROM mon_checks
        WHERE site_id = ? AND check_type = 'http'
          AND DATE(checked_at) = ?
      `, [site.id, dateStr]);

      const row = agg[0];
      if (!row || row.total === 0) continue;

      const uptime = ((row.total - row.failed) / row.total * 100).toFixed(2);

      // Rakna incidenter for gardagen
      const [incidentCount] = await pool.execute(`
        SELECT COUNT(*) AS cnt FROM mon_incidents
        WHERE site_id = ? AND DATE(opened_at) = ?
      `, [site.id, dateStr]);

      await pool.execute(`
        INSERT INTO mon_daily_metrics
          (site_id, date, uptime_pct, avg_response_ms, max_response_ms, min_response_ms,
           total_checks, failed_checks, incidents)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          uptime_pct = VALUES(uptime_pct),
          avg_response_ms = VALUES(avg_response_ms),
          max_response_ms = VALUES(max_response_ms),
          min_response_ms = VALUES(min_response_ms),
          total_checks = VALUES(total_checks),
          failed_checks = VALUES(failed_checks),
          incidents = VALUES(incidents)
      `, [
        site.id, dateStr, uptime,
        row.avg_ms, row.max_ms, row.min_ms,
        row.total, row.failed, incidentCount[0].cnt,
      ]);

      processed++;
    } catch (err) {
      console.error(`  [MONITOR] Rollup ${site.id}: ${err.message}`);
    }
  }

  console.log(`  [MONITOR] Daglig rollup klar for ${dateStr} (${processed} sajter)`);
}
