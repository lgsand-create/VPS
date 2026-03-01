/**
 * API-nyckelhantering — CRUD-endpoints
 *
 * Monteras under /api/system/keys
 * Skyddas av VPN (inte av API-nycklar) — samma som övriga system-endpoints.
 */

import { Router } from 'express';
import pool from '../db/connection.js';
import { generateKey } from '../middleware/apikey.js';
import { getProject, getAllProjects } from '../projects/index.js';

const router = Router();

// --- POST /api/system/keys — Skapa ny API-nyckel ---

router.post('/', async (req, res) => {
  const { label, project_id, consumer_type, rate_limit, allowed_origins, expires_at } = req.body;

  // Validering
  if (!label || typeof label !== 'string' || label.trim().length === 0) {
    return res.status(400).json({ error: 'Fältet "label" krävs (max 100 tecken)' });
  }
  if (label.length > 100) {
    return res.status(400).json({ error: 'Label får vara max 100 tecken' });
  }

  if (!project_id || typeof project_id !== 'string') {
    return res.status(400).json({ error: 'Fältet "project_id" krävs' });
  }

  // Kontrollera att projektet finns
  try {
    getProject(project_id);
  } catch {
    const available = Object.keys(getAllProjects()).join(', ');
    return res.status(400).json({ error: `Projekt "${project_id}" finns inte. Tillgängliga: ${available}` });
  }

  // Valfria fält
  const validTypes = ['web', 'mobile', 'server', 'other'];
  const type = validTypes.includes(consumer_type) ? consumer_type : 'server';

  const limit = parseInt(rate_limit) || 100;
  if (limit < 1 || limit > 10000) {
    return res.status(400).json({ error: 'rate_limit måste vara mellan 1 och 10000' });
  }

  // Validera allowed_origins
  let originsJson = null;
  if (allowed_origins) {
    if (!Array.isArray(allowed_origins)) {
      return res.status(400).json({ error: 'allowed_origins måste vara en array av URL:er' });
    }
    originsJson = JSON.stringify(allowed_origins);
  }

  // Validera expires_at
  let expiresAt = null;
  if (expires_at) {
    const d = new Date(expires_at);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ error: 'Ogiltigt datumformat för expires_at' });
    }
    if (d <= new Date()) {
      return res.status(400).json({ error: 'expires_at måste vara ett framtida datum' });
    }
    expiresAt = d.toISOString().slice(0, 19).replace('T', ' ');
  }

  try {
    const { fullKey, prefix, hash } = generateKey();

    await pool.execute(
      `INSERT INTO api_keys (label, key_prefix, key_hash, project_id, consumer_type, rate_limit, allowed_origins, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [label.trim(), prefix, hash, project_id, type, limit, originsJson, expiresAt]
    );

    const [rows] = await pool.execute('SELECT * FROM api_keys WHERE key_hash = ?', [hash]);
    const created = rows[0];

    res.status(201).json({
      data: {
        id: created.id,
        label: created.label,
        key: fullKey,
        key_prefix: created.key_prefix,
        project_id: created.project_id,
        consumer_type: created.consumer_type,
        rate_limit: created.rate_limit,
        allowed_origins: originsJson ? JSON.parse(originsJson) : null,
        expires_at: created.expires_at,
        created_at: created.created_at,
      },
      warning: 'Spara nyckeln nu! Den visas bara en gång och kan inte återskapas.',
    });
  } catch (err) {
    console.error('  Fel vid skapande av API-nyckel:', err.message);
    res.status(500).json({ error: 'Kunde inte skapa API-nyckel' });
  }
});

// --- GET /api/system/keys — Lista alla nycklar (maskerade) ---

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, label, key_prefix, project_id, consumer_type, rate_limit,
              allowed_origins, expires_at, revoked, revoked_at, created_at,
              last_used_at, total_requests
       FROM api_keys
       ORDER BY revoked ASC, created_at DESC`
    );

    const data = rows.map(row => ({
      ...row,
      allowed_origins: row.allowed_origins ? JSON.parse(row.allowed_origins) : null,
    }));

    res.json({ data, meta: { count: data.length } });
  } catch (err) {
    console.error('  Fel vid listning av API-nycklar:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta API-nycklar' });
  }
});

// --- DELETE /api/system/keys/:id — Revokera nyckel (soft delete) ---

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id || id < 1) {
    return res.status(400).json({ error: 'Ogiltigt nyckel-ID' });
  }

  try {
    const [existing] = await pool.execute('SELECT id, label, revoked FROM api_keys WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'API-nyckel hittades inte' });
    }
    if (existing[0].revoked) {
      return res.status(400).json({ error: 'Nyckeln är redan revokerad' });
    }

    await pool.execute(
      'UPDATE api_keys SET revoked = TRUE, revoked_at = NOW() WHERE id = ?',
      [id]
    );

    res.json({
      data: { id, label: existing[0].label, revoked: true, revoked_at: new Date().toISOString() },
    });
  } catch (err) {
    console.error('  Fel vid revokering av API-nyckel:', err.message);
    res.status(500).json({ error: 'Kunde inte revokera API-nyckel' });
  }
});

// --- GET /api/system/keys/:id/usage — Användningsstatistik ---

router.get('/:id/usage', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id || id < 1) {
    return res.status(400).json({ error: 'Ogiltigt nyckel-ID' });
  }

  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    // Hämta nyckelinfo
    const [keyRows] = await pool.execute(
      'SELECT id, label, key_prefix, project_id, total_requests, last_used_at, created_at FROM api_keys WHERE id = ?',
      [id]
    );
    if (keyRows.length === 0) {
      return res.status(404).json({ error: 'API-nyckel hittades inte' });
    }

    // Sammanfattning: idag, vecka, månad
    const [todayRows] = await pool.execute(
      'SELECT COUNT(*) AS cnt FROM api_usage_log WHERE key_id = ? AND logged_at >= CURDATE()',
      [id]
    );
    const [weekRows] = await pool.execute(
      'SELECT COUNT(*) AS cnt FROM api_usage_log WHERE key_id = ? AND logged_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)',
      [id]
    );
    const [monthRows] = await pool.execute(
      'SELECT COUNT(*) AS cnt FROM api_usage_log WHERE key_id = ? AND logged_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)',
      [id]
    );

    // Per endpoint
    const [byEndpoint] = await pool.execute(
      `SELECT path, COUNT(*) AS count
       FROM api_usage_log WHERE key_id = ?
       GROUP BY path ORDER BY count DESC LIMIT 10`,
      [id]
    );

    // Per statuskod
    const [byStatus] = await pool.execute(
      `SELECT status_code, COUNT(*) AS count
       FROM api_usage_log WHERE key_id = ?
       GROUP BY status_code ORDER BY status_code`,
      [id]
    );

    // Senaste anrop
    const [recent] = await pool.execute(
      `SELECT method, path, status_code, response_ms, ip_address, logged_at
       FROM api_usage_log WHERE key_id = ?
       ORDER BY logged_at DESC LIMIT ?`,
      [id, limit]
    );

    res.json({
      data: {
        key: keyRows[0],
        summary: {
          today: todayRows[0].cnt,
          this_week: weekRows[0].cnt,
          this_month: monthRows[0].cnt,
          by_endpoint: byEndpoint,
          by_status: byStatus,
        },
        recent,
      },
    });
  } catch (err) {
    console.error('  Fel vid hämtning av användningsstatistik:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta statistik' });
  }
});

export default router;
