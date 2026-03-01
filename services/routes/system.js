import { Router } from 'express';
import pool from '../db/connection.js';
import { getAllProjects } from '../projects/index.js';
import keysRouter from './keys.js';
import schedulesRouter from './schedules.js';
import settingsRouter from './settings.js';

const router = Router();

// API-nyckelhantering (/api/system/keys)
router.use('/keys', keysRouter);

// CRON-schemahantering (/api/system/schedules)
router.use('/schedules', schedulesRouter);

// Installningar (/api/system/settings)
router.use('/settings', settingsRouter);

// GET /api/system/projects — Lista alla registrerade projekt
router.get('/projects', (req, res) => {
  const projects = getAllProjects();
  const list = Object.values(projects).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    color: p.color,
    api: `/api/${p.id}`,
  }));
  res.json({ data: list, meta: { count: list.length } });
});

// GET /api/system/scrape-log — CRON-körningar (alla projekt)
router.get('/scrape-log', async (req, res) => {
  const { project, limit = 30 } = req.query;

  let sql = 'SELECT * FROM scrape_log';
  const params = [];

  if (project) {
    sql += ' WHERE project = ?';
    params.push(project);
  }

  sql += ' ORDER BY started_at DESC LIMIT ?';
  params.push(parseInt(limit));

  const [rows] = await pool.execute(sql, params);
  res.json({ data: rows, meta: { count: rows.length } });
});

// GET /api/system/health — Hälsokontroll
router.get('/health', async (req, res) => {
  try {
    await pool.execute('SELECT 1');
    res.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

export default router;
