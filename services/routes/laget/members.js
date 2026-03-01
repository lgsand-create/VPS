import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/laget/members — Alla medlemmar med närvarostatistik
router.get('/', async (req, res) => {
  const { team, from, to } = req.query;

  let dateFilter = '';
  const params = [];
  if (team) { dateFilter += ' AND a.team_id = ?'; params.push(team); }
  if (from) { dateFilter += ' AND COALESCE(a.datum_till, a.datum) >= ?'; params.push(from); }
  if (to)   { dateFilter += ' AND a.datum <= ?'; params.push(to); }

  const [members] = await pool.execute(`
    SELECT m.id, m.namn,
      COUNT(DISTINCT att.activity_id) AS antal_kallad,
      SUM(att.status = 'Deltar') AS antal_deltar,
      SUM(att.status = 'Deltar ej') AS antal_deltar_ej,
      SUM(att.status = 'Ej svarat') AS antal_ej_svarat,
      SUM(att.status = 'Ej kallad') AS antal_ej_kallad,
      SUM(att.status = 'Schemalagd') AS antal_schemalagd
    FROM lag_members m
    JOIN lag_attendance att ON att.member_id = m.id
    JOIN lag_activities a ON a.id = att.activity_id
    WHERE 1=1 ${dateFilter}
    GROUP BY m.id
    ORDER BY m.namn
  `, params);

  res.json({ data: members });
});

// GET /api/laget/members/:id — Specifik medlem med historik
router.get('/:id', async (req, res) => {
  const [members] = await pool.execute('SELECT * FROM lag_members WHERE id = ?', [req.params.id]);
  if (members.length === 0) return res.status(404).json({ error: 'Medlemmen finns inte' });

  const [attendance] = await pool.execute(`
    SELECT att.status, att.roll, att.kommentar, a.datum, a.starttid, a.typ, a.plats, t.namn AS lag_namn
    FROM lag_attendance att
    JOIN lag_activities a ON a.id = att.activity_id
    JOIN lag_teams t ON t.id = a.team_id
    WHERE att.member_id = ?
    ORDER BY a.datum DESC
  `, [req.params.id]);

  res.json({ data: { ...members[0], historik: attendance } });
});

export default router;
