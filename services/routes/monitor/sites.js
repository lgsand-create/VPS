/**
 * Monitor Sites — GET/PUT /api/monitor/sites
 */

import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/monitor/sites — Alla sajter med aktuell status
router.get('/', async (req, res) => {
  try {
    const [sites] = await pool.execute(`
      SELECT s.*,
        (SELECT COUNT(*) FROM mon_incidents WHERE site_id = s.id AND status = 'open') AS open_incidents,
        (SELECT response_ms FROM mon_checks WHERE site_id = s.id AND check_type = 'http'
         ORDER BY checked_at DESC LIMIT 1) AS last_response_ms,
        (SELECT checked_at FROM mon_checks WHERE site_id = s.id AND check_type = 'http'
         ORDER BY checked_at DESC LIMIT 1) AS last_http_check
      FROM mon_sites s
      WHERE s.enabled = TRUE
      ORDER BY s.name
    `);

    res.json({ data: sites, meta: { count: sites.length } });
  } catch (err) {
    console.error('  [MONITOR] Sites-fel:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta sajter' });
  }
});

// GET /api/monitor/sites/:id — Detaljerad sajtstatus
router.get('/:id', async (req, res) => {
  try {
    const [sites] = await pool.execute(
      'SELECT * FROM mon_sites WHERE id = ?',
      [req.params.id]
    );

    if (sites.length === 0) {
      return res.status(404).json({ error: 'Sajt ej funnen' });
    }

    // Senaste check per typ
    const [latestChecks] = await pool.execute(`
      SELECT c.* FROM mon_checks c
      INNER JOIN (
        SELECT check_type, MAX(id) AS max_id
        FROM mon_checks WHERE site_id = ?
        GROUP BY check_type
      ) latest ON c.id = latest.max_id
    `, [req.params.id]);

    // Öppna incidenter
    const [openIncidents] = await pool.execute(
      `SELECT * FROM mon_incidents
       WHERE site_id = ? AND status IN ('open', 'acknowledged')
       ORDER BY opened_at DESC`,
      [req.params.id]
    );

    // Senaste 24h HTTP-checks (för svarstidsgraf)
    const [recentChecks] = await pool.execute(`
      SELECT checked_at, response_ms, status
      FROM mon_checks
      WHERE site_id = ? AND check_type = 'http'
        AND checked_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY checked_at ASC
    `, [req.params.id]);

    // Uptime-statistik (24h, 7d, 30d)
    const uptimeStats = {};
    for (const [label, interval] of [['24h', '24 HOUR'], ['7d', '7 DAY'], ['30d', '30 DAY']]) {
      const [rows] = await pool.execute(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok_count,
          ROUND(AVG(response_ms)) AS avg_ms,
          MAX(response_ms) AS max_ms,
          MIN(response_ms) AS min_ms
        FROM mon_checks
        WHERE site_id = ? AND check_type = 'http'
          AND checked_at > DATE_SUB(NOW(), INTERVAL ${interval})
      `, [req.params.id]);
      const r = rows[0];
      uptimeStats[label] = {
        total: r.total || 0,
        ok: r.ok_count || 0,
        pct: r.total > 0 ? ((r.ok_count / r.total) * 100).toFixed(2) : null,
        avgMs: r.avg_ms,
        maxMs: r.max_ms,
        minMs: r.min_ms,
      };
    }

    // Dagliga metrics (senaste 30 dagar, för uptime-graf)
    const [dailyMetrics] = await pool.execute(`
      SELECT date, uptime_pct, avg_response_ms, max_response_ms, min_response_ms,
             total_checks, failed_checks, incidents
      FROM mon_daily_metrics
      WHERE site_id = ?
      ORDER BY date DESC
      LIMIT 30
    `, [req.params.id]);

    // Senaste 30 deep checks (for tidsgraf)
    const [recentDeepChecks] = await pool.execute(`
      SELECT checked_at, response_ms, status, message
      FROM mon_checks
      WHERE site_id = ? AND check_type = 'deep'
      ORDER BY checked_at DESC
      LIMIT 30
    `, [req.params.id]);

    res.json({
      data: {
        site: sites[0],
        latestChecks,
        openIncidents,
        recentChecks,
        uptimeStats,
        dailyMetrics: dailyMetrics.reverse(),
        recentDeepChecks: recentDeepChecks.reverse(),
      },
    });
  } catch (err) {
    console.error('  [MONITOR] Site-detalj-fel:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta sajtdetaljer' });
  }
});

// PUT /api/monitor/sites/:id — Uppdatera sajt-konfiguration
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Kontrollera att sajten finns
    const [existing] = await pool.execute('SELECT id FROM mon_sites WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Sajt ej funnen' });
    }

    // Tillåtna fält att uppdatera
    const ALLOWED_FIELDS = {
      name: 'string',
      url: 'string',
      health_url: 'string',
      ssh_host: 'string',
      ssh_port: 'number',
      ssh_method: 'string',
      webroot: 'string',
      ssh_user: 'string',
      ssh_key_path: 'string',
      ssh_user_env: 'string',
      ssh_key_env: 'string',
      ssh_password: 'string',
      ssh_password_env: 'string',
      health_secret_env: 'string',
      health_secret: 'string',
      check_http: 'boolean',
      check_ssl: 'boolean',
      check_health: 'boolean',
      check_deep: 'boolean',
      check_integrity: 'boolean',
      check_dns: 'boolean',
      check_headers: 'boolean',
      check_content: 'boolean',
      health_expected_admins: 'number',
      interval_http: 'number',
      interval_ssl: 'number',
      interval_health: 'number',
      interval_deep: 'number',
      interval_integrity: 'number',
      interval_dns: 'number',
      interval_headers: 'number',
      interval_content: 'number',
      enabled: 'boolean',
      integrity_files: 'string',
      accepted_statuses: 'string',
      deep_steps: 'json',
      deep_username_env: 'string',
      deep_password_env: 'string',
      deep_max_step_ms: 'number',
      deep_max_total_ms: 'number',
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
        const minVal = field === 'health_expected_admins' ? 0 : 1;
        if (isNaN(val) || val < minVal) continue;
      } else if (type === 'json') {
        if (val === null || val === '') { val = null; }
        else if (typeof val === 'string') {
          if (!val.trim()) { val = null; }
          else { try { JSON.parse(val); } catch { continue; } }
        } else {
          val = JSON.stringify(val);
        }
      } else if (type === 'string') {
        val = String(val || '').trim();
        // ssh_method: bara 'ssh', 'sftp' eller null
        if (field === 'ssh_method') {
          val = ['ssh', 'sftp'].includes(val) ? val : null;
        }
      }

      updates.push(`${field} = ?`);
      values.push(val);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Inga giltiga fält att uppdatera' });
    }

    values.push(id);
    await pool.execute(
      `UPDATE mon_sites SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    console.log(`  [MONITOR] Sajt ${id} uppdaterad: ${updates.map(u => u.split(' =')[0]).join(', ')}`);
    res.json({ ok: true, message: `Sajt "${id}" uppdaterad`, fields: updates.length });
  } catch (err) {
    console.error('  [MONITOR] Sajt-uppdatering fel:', err.message);
    res.status(500).json({ error: 'Kunde inte uppdatera sajt', detail: err.message });
  }
});

export default router;
