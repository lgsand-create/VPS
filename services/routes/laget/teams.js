import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/laget/teams — Alla lag
router.get('/', async (req, res) => {
  const [teams] = await pool.execute(`
    SELECT t.*, COUNT(DISTINCT a.id) AS antal_aktiviteter
    FROM lag_teams t
    LEFT JOIN lag_activities a ON a.team_id = t.id
    GROUP BY t.id
    ORDER BY t.namn
  `);
  res.json({ data: teams });
});

// PATCH /api/laget/teams/:id — Uppdatera lag (t.ex. toggla aktiv)
router.patch('/:id', async (req, res) => {
  const { aktiv } = req.body;
  if (aktiv === undefined) return res.status(400).json({ error: 'Ange "aktiv" (true/false)' });

  const [result] = await pool.execute(
    'UPDATE lag_teams SET aktiv = ? WHERE id = ?',
    [aktiv ? 1 : 0, req.params.id]
  );

  if (result.affectedRows === 0) return res.status(404).json({ error: 'Laget finns inte' });
  res.json({ ok: true, id: req.params.id, aktiv: !!aktiv });
});

// GET /api/laget/teams/:id — Specifikt lag med aktiviteter
router.get('/:id', async (req, res) => {
  const [teams] = await pool.execute('SELECT * FROM lag_teams WHERE id = ?', [req.params.id]);
  if (teams.length === 0) return res.status(404).json({ error: 'Laget finns inte' });

  const [activities] = await pool.execute(`
    SELECT * FROM lag_activities WHERE team_id = ? ORDER BY datum DESC
  `, [req.params.id]);

  res.json({ data: { ...teams[0], aktiviteter: activities } });
});

export default router;
