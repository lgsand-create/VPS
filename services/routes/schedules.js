/**
 * CRON-schemahantering — API-endpoints
 *
 * Monteras under /api/system/schedules
 * Skyddas av VPN (inte av API-nycklar) — samma som övriga system-endpoints.
 */

import { Router } from 'express';
import pool from '../db/connection.js';
import { getProject, getAllProjects } from '../projects/index.js';
import { reloadScheduler, validateCronExpr, runPipeline } from '../cron/scheduler.js';

const router = Router();

// --- GET /api/system/schedules — Alla scheman (alla projekt) ---

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM cron_schedules ORDER BY project_id, mode'
    );
    res.json({ data: rows, meta: { count: rows.length } });
  } catch (err) {
    console.error('  Fel vid hämtning av scheman:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta scheman' });
  }
});

// --- GET /api/system/schedules/:projectId — Scheman för ett projekt ---

router.get('/:projectId', async (req, res) => {
  const { projectId } = req.params;

  try {
    getProject(projectId);
  } catch {
    return res.status(404).json({ error: `Projekt "${projectId}" finns inte` });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT * FROM cron_schedules WHERE project_id = ? ORDER BY mode',
      [projectId]
    );
    res.json({ data: rows, meta: { count: rows.length } });
  } catch (err) {
    console.error('  Fel vid hämtning av scheman:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta scheman' });
  }
});

// --- PUT /api/system/schedules/:projectId/:mode — Uppdatera ett schema ---

router.put('/:projectId/:mode', async (req, res) => {
  const { projectId, mode } = req.params;
  const { cron_expr, label, args, enabled } = req.body;

  // Validera projekt
  try {
    getProject(projectId);
  } catch {
    return res.status(404).json({ error: `Projekt "${projectId}" finns inte` });
  }

  // Validera att schemat finns
  const [existing] = await pool.execute(
    'SELECT * FROM cron_schedules WHERE project_id = ? AND mode = ?',
    [projectId, mode]
  );
  if (existing.length === 0) {
    return res.status(404).json({ error: `Schema "${mode}" finns inte för ${projectId}` });
  }

  // Validera cron-uttryck om det ändras (stödjer semikolon-separerade)
  if (cron_expr !== undefined) {
    if (typeof cron_expr !== 'string') {
      return res.status(400).json({ error: 'cron_expr måste vara en sträng' });
    }
    const check = validateCronExpr(cron_expr);
    if (!check.valid) {
      return res.status(400).json({ error: `Ogiltigt CRON-uttryck: "${check.invalid}"` });
    }
  }

  // Validera label
  if (label !== undefined) {
    if (typeof label !== 'string' || label.trim().length === 0 || label.length > 100) {
      return res.status(400).json({ error: 'Label måste vara 1–100 tecken' });
    }
  }

  // Validera args
  if (args !== undefined && typeof args !== 'string') {
    return res.status(400).json({ error: 'args måste vara en sträng' });
  }

  try {
    // Bygg UPDATE dynamiskt baserat på vad som skickades
    const updates = [];
    const params = [];

    if (cron_expr !== undefined) {
      updates.push('cron_expr = ?');
      params.push(cron_expr);
    }
    if (label !== undefined) {
      updates.push('label = ?');
      params.push(label.trim());
    }
    if (args !== undefined) {
      updates.push('args = ?');
      params.push(args);
    }
    if (enabled !== undefined) {
      updates.push('enabled = ?');
      params.push(Boolean(enabled));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Inga fält att uppdatera' });
    }

    params.push(projectId, mode);
    await pool.execute(
      `UPDATE cron_schedules SET ${updates.join(', ')} WHERE project_id = ? AND mode = ?`,
      params
    );

    // Ladda om schedulern med nya inställningar
    await reloadScheduler();

    // Returnera uppdaterat schema
    const [rows] = await pool.execute(
      'SELECT * FROM cron_schedules WHERE project_id = ? AND mode = ?',
      [projectId, mode]
    );

    res.json({ data: rows[0], message: 'Schema uppdaterat och scheduler omladdad' });
  } catch (err) {
    console.error('  Fel vid uppdatering av schema:', err.message);
    res.status(500).json({ error: 'Kunde inte uppdatera schema' });
  }
});

// --- POST /api/system/schedules/:projectId/:mode/run — Kör pipeline manuellt ---

router.post('/:projectId/:mode/run', async (req, res) => {
  const { projectId, mode } = req.params;

  // Validera projekt
  try {
    getProject(projectId);
  } catch {
    return res.status(404).json({ error: `Projekt "${projectId}" finns inte` });
  }

  // Validera att schemat finns
  const [existing] = await pool.execute(
    'SELECT * FROM cron_schedules WHERE project_id = ? AND mode = ?',
    [projectId, mode]
  );
  if (existing.length === 0) {
    return res.status(404).json({ error: `Schema "${mode}" finns inte för ${projectId}` });
  }

  const schedule = existing[0];
  console.log(`  [API] Manuell körning: ${projectId}/${mode} (${schedule.label})`);

  // Starta pipeline i bakgrunden (blocka inte requesten)
  runPipeline(projectId, mode, schedule.args || '', `${schedule.label} (manuell)`);

  res.json({ message: `Pipeline ${projectId}/${mode} startad`, label: schedule.label });
});

export default router;
