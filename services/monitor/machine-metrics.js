/**
 * Machine Metrics — daglig rollup av mon_machine_checks
 *
 * Kors 00:15 varje natt. Aggregerar gardagens maskin-checks
 * till CPU/RAM/disk-medelvarden och uptime-procent.
 */

import pool from '../db/connection.js';

export async function rollupMachineDailyMetrics() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  let machines;
  try {
    [machines] = await pool.execute('SELECT id FROM mon_machines WHERE enabled = TRUE');
  } catch (err) {
    console.error(`  [MACHINES] Rollup: Kunde inte hamta maskiner: ${err.message}`);
    return;
  }

  let processed = 0;

  for (const machine of machines) {
    try {
      // Aggregera system-checks (innehaller CPU/RAM/disk i details JSON)
      const [systemChecks] = await pool.execute(`
        SELECT details FROM mon_machine_checks
        WHERE machine_id = ? AND check_type = 'system' AND DATE(checked_at) = ?
      `, [machine.id, dateStr]);

      let cpuValues = [], ramValues = [], diskValues = [];
      let gpuValues = [], vramValues = [], gpuTempValues = [];
      for (const row of systemChecks) {
        try {
          const d = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
          if (d?.cpu?.pct != null) cpuValues.push(d.cpu.pct);
          if (d?.ram?.pct != null) ramValues.push(d.ram.pct);
          if (d?.disk?.worstPct != null) diskValues.push(d.disk.worstPct);
          if (d?.gpu?.utilPct != null) gpuValues.push(d.gpu.utilPct);
          if (d?.gpu?.vramPct != null) vramValues.push(d.gpu.vramPct);
          if (d?.gpu?.tempC != null) gpuTempValues.push(d.gpu.tempC);
        } catch { /* ignorera parsningsfel */ }
      }

      // Uptime baserat pa alla checks
      const [allChecks] = await pool.execute(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN status IN ('critical','error') THEN 1 ELSE 0 END) AS failed
        FROM mon_machine_checks
        WHERE machine_id = ? AND DATE(checked_at) = ?
      `, [machine.id, dateStr]);

      const row = allChecks[0];
      if (!row || row.total === 0) continue;

      const uptimePct = ((row.total - row.failed) / row.total * 100).toFixed(2);

      // Incidenter
      const [incidentCount] = await pool.execute(`
        SELECT COUNT(*) AS cnt FROM mon_machine_incidents
        WHERE machine_id = ? AND DATE(opened_at) = ?
      `, [machine.id, dateStr]);

      const avg = arr => arr.length > 0 ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null;
      const max = arr => arr.length > 0 ? Math.max(...arr) : null;

      await pool.execute(`
        INSERT INTO mon_machine_daily_metrics
          (machine_id, date, avg_cpu_pct, max_cpu_pct, avg_ram_pct, max_ram_pct,
           avg_disk_pct, max_disk_pct, avg_gpu_pct, max_gpu_pct, avg_vram_pct, max_vram_pct,
           avg_gpu_temp, max_gpu_temp, uptime_pct, total_checks, failed_checks, incidents)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          avg_cpu_pct = VALUES(avg_cpu_pct), max_cpu_pct = VALUES(max_cpu_pct),
          avg_ram_pct = VALUES(avg_ram_pct), max_ram_pct = VALUES(max_ram_pct),
          avg_disk_pct = VALUES(avg_disk_pct), max_disk_pct = VALUES(max_disk_pct),
          avg_gpu_pct = VALUES(avg_gpu_pct), max_gpu_pct = VALUES(max_gpu_pct),
          avg_vram_pct = VALUES(avg_vram_pct), max_vram_pct = VALUES(max_vram_pct),
          avg_gpu_temp = VALUES(avg_gpu_temp), max_gpu_temp = VALUES(max_gpu_temp),
          uptime_pct = VALUES(uptime_pct),
          total_checks = VALUES(total_checks), failed_checks = VALUES(failed_checks),
          incidents = VALUES(incidents)
      `, [
        machine.id, dateStr,
        avg(cpuValues), max(cpuValues),
        avg(ramValues), max(ramValues),
        avg(diskValues), max(diskValues),
        avg(gpuValues), max(gpuValues),
        avg(vramValues), max(vramValues),
        avg(gpuTempValues), max(gpuTempValues),
        uptimePct, row.total, row.failed, incidentCount[0].cnt,
      ]);

      processed++;
    } catch (err) {
      console.error(`  [MACHINES] Rollup ${machine.id}: ${err.message}`);
    }
  }

  console.log(`  [MACHINES] Daglig rollup klar for ${dateStr} (${processed} maskiner)`);
}
