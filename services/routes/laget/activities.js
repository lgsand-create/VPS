import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/laget/activities — Aktiviteter med filter
router.get('/', async (req, res) => {
  const { team, from, to, lok, typ } = req.query;

  let where = '1=1';
  const params = [];

  if (team) { where += ' AND a.team_id = ?'; params.push(team); }
  if (from) { where += ' AND COALESCE(a.datum_till, a.datum) >= ?'; params.push(from); }
  if (to)   { where += ' AND a.datum <= ?'; params.push(to); }
  if (lok === 'true')  { where += ' AND a.lok_aktivitet = 1'; }
  if (lok === 'false') { where += ' AND a.lok_aktivitet = 0'; }
  if (typ) { where += ' AND a.typ LIKE ?'; params.push(`%${typ}%`); }

  const [activities] = await pool.execute(`
    SELECT a.*, t.namn AS lag_namn,
      (SELECT COUNT(*) FROM lag_attendance att WHERE att.activity_id = a.id AND att.roll = 'deltagare' AND att.status = 'Deltar') AS deltar_count,
      (SELECT COUNT(*) FROM lag_attendance att WHERE att.activity_id = a.id AND att.roll = 'ledare' AND att.status IN ('Deltar','Schemalagd')) AS ledare_count
    FROM lag_activities a
    JOIN lag_teams t ON t.id = a.team_id
    WHERE ${where}
    ORDER BY a.datum DESC, a.starttid DESC
    LIMIT 500
  `, params);

  res.json({ data: activities });
});

// GET /api/laget/activities/:id — Specifik aktivitet med deltagare
router.get('/:id', async (req, res) => {
  const [activities] = await pool.execute(`
    SELECT a.*, t.namn AS lag_namn
    FROM lag_activities a
    JOIN lag_teams t ON t.id = a.team_id
    WHERE a.id = ?
  `, [req.params.id]);

  if (activities.length === 0) return res.status(404).json({ error: 'Aktiviteten finns inte' });

  const [attendance] = await pool.execute(`
    SELECT att.*, m.namn
    FROM lag_attendance att
    JOIN lag_members m ON m.id = att.member_id
    WHERE att.activity_id = ?
    ORDER BY att.roll, m.namn
  `, [req.params.id]);

  res.json({
    data: {
      ...activities[0],
      deltagare: attendance.filter(a => a.roll === 'deltagare'),
      ledare: attendance.filter(a => a.roll === 'ledare'),
    }
  });
});

export default router;
