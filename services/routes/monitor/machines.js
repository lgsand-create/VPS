/**
 * Monitor Machines — GET/PUT /api/monitor/machines
 */

import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/monitor/machines — Alla maskiner med aktuell status
router.get('/', async (req, res) => {
  try {
    const [machines] = await pool.execute(`
      SELECT m.*,
        (SELECT COUNT(*) FROM mon_machine_incidents WHERE machine_id = m.id AND status = 'open') AS open_incidents,
        (SELECT response_ms FROM mon_machine_checks WHERE machine_id = m.id AND check_type = 'ping'
         ORDER BY checked_at DESC LIMIT 1) AS last_ping_ms,
        (SELECT checked_at FROM mon_machine_checks WHERE machine_id = m.id
         ORDER BY checked_at DESC LIMIT 1) AS last_check
      FROM mon_machines m
      WHERE m.enabled = TRUE
      ORDER BY m.name
    `);

    res.json({ data: machines, meta: { count: machines.length } });
  } catch (err) {
    console.error('  [MACHINES] Machines-fel:', err.message);
    res.status(500).json({ error: 'Kunde inte hamta maskiner' });
  }
});

// GET /api/monitor/machines/:id — Detaljerad maskinstatus
router.get('/:id', async (req, res) => {
  try {
    const [machines] = await pool.execute(
      'SELECT * FROM mon_machines WHERE id = ?',
      [req.params.id]
    );

    if (machines.length === 0) {
      return res.status(404).json({ error: 'Maskin ej funnen' });
    }

    // Senaste check per typ
    const [latestChecks] = await pool.execute(`
      SELECT c.* FROM mon_machine_checks c
      INNER JOIN (
        SELECT check_type, MAX(id) AS max_id
        FROM mon_machine_checks WHERE machine_id = ?
        GROUP BY check_type
      ) latest ON c.id = latest.max_id
    `, [req.params.id]);

    // Oppna incidenter
    const [openIncidents] = await pool.execute(
      `SELECT * FROM mon_machine_incidents
       WHERE machine_id = ? AND status IN ('open', 'acknowledged')
       ORDER BY opened_at DESC`,
      [req.params.id]
    );

    // Senaste 24h system-checks (for CPU/RAM-graf)
    const [recentSystemChecks] = await pool.execute(`
      SELECT checked_at, response_ms, status, details
      FROM mon_machine_checks
      WHERE machine_id = ? AND check_type = 'system'
        AND checked_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY checked_at ASC
    `, [req.params.id]);

    // Uptime-statistik (24h, 7d, 30d)
    const uptimeStats = {};
    for (const [label, interval] of [['24h', '24 HOUR'], ['7d', '7 DAY'], ['30d', '30 DAY']]) {
      const [rows] = await pool.execute(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok_count
        FROM mon_machine_checks
        WHERE machine_id = ?
          AND checked_at > DATE_SUB(NOW(), INTERVAL ${interval})
      `, [req.params.id]);
      const r = rows[0];
      uptimeStats[label] = {
        total: r.total || 0,
        ok: r.ok_count || 0,
        pct: r.total > 0 ? ((r.ok_count / r.total) * 100).toFixed(2) : null,
      };
    }

    // Dagliga metrics (senaste 30 dagar)
    const [dailyMetrics] = await pool.execute(`
      SELECT date, avg_cpu_pct, max_cpu_pct, avg_ram_pct, max_ram_pct,
             avg_disk_pct, max_disk_pct, uptime_pct, total_checks, failed_checks, incidents
      FROM mon_machine_daily_metrics
      WHERE machine_id = ?
      ORDER BY date DESC
      LIMIT 30
    `, [req.params.id]);

    res.json({
      data: {
        machine: machines[0],
        latestChecks,
        openIncidents,
        recentSystemChecks,
        uptimeStats,
        dailyMetrics: dailyMetrics.reverse(),
      },
    });
  } catch (err) {
    console.error('  [MACHINES] Maskin-detalj-fel:', err.message);
    res.status(500).json({ error: 'Kunde inte hamta maskindetaljer' });
  }
});

// PUT /api/monitor/machines/:id — Uppdatera maskin-konfiguration
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute('SELECT id FROM mon_machines WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Maskin ej funnen' });
    }

    const ALLOWED_FIELDS = {
      name: 'string',
      host: 'string',
      description: 'string',
      ssh_port: 'number',
      ssh_user: 'string',
      ssh_key_env: 'string',
      ssh_password_env: 'string',
      check_ping: 'boolean',
      check_system: 'boolean',
      check_services: 'boolean',
      services: 'string',
      disk_paths: 'string',
      interval_minutes: 'number',
      threshold_cpu_warn: 'number',
      threshold_cpu_crit: 'number',
      threshold_ram_warn: 'number',
      threshold_ram_crit: 'number',
      threshold_disk_warn: 'number',
      threshold_disk_crit: 'number',
      enabled: 'boolean',
    };

    const updates = [];
    const values = [];

    for (const [field, type] of Object.entries(ALLOWED_FIELDS)) {
      if (req.body[field] === undefined || req.body[field] === null) continue;

      let val = req.body[field];
      if (type === 'boolean') {
        val = val === true || val === 'true' ? 1 : 0;
      } else if (type === 'number') {
        val = parseInt(val, 10);
        if (isNaN(val) || val < 1) continue;
      } else if (type === 'string') {
        val = String(val || '').trim();
      }

      updates.push(`${field} = ?`);
      values.push(val);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Inga giltiga falt att uppdatera' });
    }

    values.push(id);
    await pool.execute(
      `UPDATE mon_machines SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    console.log(`  [MACHINES] Maskin ${id} uppdaterad: ${updates.map(u => u.split(' =')[0]).join(', ')}`);
    res.json({ ok: true, message: `Maskin "${id}" uppdaterad`, fields: updates.length });
  } catch (err) {
    console.error('  [MACHINES] Maskin-uppdatering fel:', err.message);
    res.status(500).json({ error: 'Kunde inte uppdatera maskin', detail: err.message });
  }
});

// GET /api/monitor/machine-checks — Check-historik
router.get('/:id/checks', async (req, res) => {
  try {
    const type = req.query.type || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

    let query = `SELECT * FROM mon_machine_checks WHERE machine_id = ?`;
    const params = [req.params.id];

    if (type) {
      query += ' AND check_type = ?';
      params.push(type);
    }

    query += ' ORDER BY checked_at DESC LIMIT ?';
    params.push(limit);

    const [checks] = await pool.execute(query, params);
    res.json({ data: checks });
  } catch (err) {
    console.error('  [MACHINES] Check-historik-fel:', err.message);
    res.status(500).json({ error: 'Kunde inte hamta check-historik' });
  }
});

export default router;
