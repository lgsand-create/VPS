import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/laget/changes — Senaste ändringar
router.get('/', async (req, res) => {
  const { team, member, field, activity, limit = 50 } = req.query;

  let sql = `
    SELECT cl.created_at, cl.field_name, cl.old_value, cl.new_value,
           cl.scrape_file, cl.activity_id, cl.member_id,
           m.namn AS medlem,
           a.datum, a.typ, a.plats, a.team_id,
           t.namn AS lag_namn
    FROM lag_change_log cl
    LEFT JOIN lag_activities a ON a.id = cl.activity_id
    LEFT JOIN lag_teams t ON t.id = a.team_id
    LEFT JOIN lag_members m ON m.id = cl.member_id
    WHERE 1=1
  `;
  const params = [];

  if (team) {
    sql += ' AND a.team_id = ?';
    params.push(team);
  }
  if (member) {
    sql += ' AND cl.member_id = ?';
    params.push(member);
  }
  if (field) {
    sql += ' AND cl.field_name = ?';
    params.push(field);
  }
  if (activity) {
    sql += ' AND cl.activity_id = ?';
    params.push(activity);
  }

  sql += ' ORDER BY cl.created_at DESC LIMIT ?';
  params.push(parseInt(limit));

  const [rows] = await pool.execute(sql, params);
  res.json({ data: rows, meta: { count: rows.length } });
});

export default router;
