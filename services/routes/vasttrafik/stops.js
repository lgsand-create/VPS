/**
 * Västtrafik Stops — Hållplats-CRUD + sökning + API-test
 */

import { Router } from 'express';
import pool from '../../db/connection.js';
import { searchStops, testConnection, fetchDepartures } from '../../vasttrafik/api.js';

const router = Router();

// GET /api/vasttrafik/stops — Lista alla hållplatser
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM vt_stops ORDER BY sort_order, name'
    );
    res.json({ data: rows, meta: { count: rows.length } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vasttrafik/stops — Lägg till hållplats
router.post('/', async (req, res) => {
  try {
    const { id, name, stop_area_gid, latitude, longitude } = req.body;

    if (!id || !name || !stop_area_gid) {
      return res.status(400).json({ error: 'id, name och stop_area_gid krävs' });
    }

    // Validera id-format (bara bokstäver, siffror, bindestreck)
    if (!/^[a-z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: 'id får bara innehålla a-z, 0-9 och bindestreck' });
    }

    await pool.execute(`
      INSERT INTO vt_stops (id, name, stop_area_gid, latitude, longitude)
      VALUES (?, ?, ?, ?, ?)
    `, [id, name, stop_area_gid, latitude || null, longitude || null]);

    res.json({ ok: true, message: `Hållplats "${name}" tillagd` });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Hållplats med detta id eller GID finns redan' });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vasttrafik/stops/favorites — Populära favorithållplatser (från PWA-användare)
router.get('/favorites', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT stop_area_gid, stop_name, added_count, last_added_at FROM vt_stop_favorites ORDER BY added_count DESC, last_added_at DESC LIMIT 50'
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/vasttrafik/stops/:id — Uppdatera hållplats
router.put('/:id', async (req, res) => {
  try {
    const { enabled, sort_order, name } = req.body;
    const updates = [];
    const values = [];

    if (enabled !== undefined) { updates.push('enabled = ?'); values.push(enabled); }
    if (sort_order !== undefined) { updates.push('sort_order = ?'); values.push(sort_order); }
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Inga fält att uppdatera' });
    }

    values.push(req.params.id);
    const [result] = await pool.execute(
      `UPDATE vt_stops SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Hållplats hittades inte' });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/vasttrafik/stops/:id — Ta bort hållplats
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM vt_stops WHERE id = ?',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Hållplats hittades inte' });
    }

    res.json({ ok: true, message: 'Hållplats borttagen' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vasttrafik/stops/search — Sök hållplatser via Västtrafik API
router.post('/search', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || query.length < 2) {
      return res.status(400).json({ error: 'Sökord krävs (minst 2 tecken)' });
    }

    const results = await searchStops(query);

    // Mappa till enklare format
    const stops = results
      .filter(r => r.gid && r.name)
      .map(r => ({
        gid: r.gid,
        name: r.name,
        latitude: r.latitude,
        longitude: r.longitude,
      }));

    res.json({ data: stops, meta: { count: stops.length } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vasttrafik/stops/:id/test — Testa hämta avgångar för en hållplats
router.post('/:id/test', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT stop_area_gid FROM vt_stops WHERE id = ?',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Hållplats hittades inte' });
    }

    const start = Date.now();
    const data = await fetchDepartures(rows[0].stop_area_gid);
    const ms = Date.now() - start;

    const departures = data?.results || data?.departures || [];

    res.json({
      ok: true,
      responseMs: ms,
      departures: departures.length,
      sample: departures.slice(0, 3),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vasttrafik/stops/test-api — Testa API-anslutning
router.post('/test-api', async (req, res) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
