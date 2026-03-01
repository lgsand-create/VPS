import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/laget/stats — Aggregerad statistik
router.get('/', async (req, res) => {
  const { team, from, to } = req.query;

  let dateFilter = '';
  const params = [];
  if (team) { dateFilter += ' AND a.team_id = ?'; params.push(team); }
  // Default till innevarande år om inget from-datum anges
  const fromDate = from || `${new Date().getFullYear()}-01-01`;
  dateFilter += ' AND COALESCE(a.datum_till, a.datum) >= ?'; params.push(fromDate);
  if (to)   { dateFilter += ' AND a.datum <= ?'; params.push(to); }

  const [stats] = await pool.execute(`
    SELECT
      COUNT(DISTINCT a.id) AS aktiviteter,
      COUNT(DISTINCT a.team_id) AS lag,
      COUNT(DISTINCT CASE WHEN a.lok_aktivitet = 1 THEN a.id END) AS lok_aktiviteter,
      COUNT(DISTINCT CASE WHEN att.roll = 'deltagare' THEN att.member_id END) AS unika_deltagare,
      COUNT(DISTINCT CASE WHEN att.roll = 'ledare' THEN att.member_id END) AS unika_ledare,
      SUM(CASE WHEN att.status = 'Deltar' THEN 1 ELSE 0 END) AS totalt_deltar,
      SUM(CASE WHEN att.status = 'Deltar ej' THEN 1 ELSE 0 END) AS totalt_deltar_ej,
      SUM(CASE WHEN att.status = 'Ej svarat' THEN 1 ELSE 0 END) AS totalt_ej_svarat,
      SUM(CASE WHEN att.status = 'Ej kallad' THEN 1 ELSE 0 END) AS totalt_ej_kallad,
      SUM(CASE WHEN att.status = 'Schemalagd' THEN 1 ELSE 0 END) AS totalt_schemalagd
    FROM lag_activities a
    LEFT JOIN lag_attendance att ON att.activity_id = a.id
    WHERE 1=1 ${dateFilter}
  `, params);

  const [lastScrape] = await pool.execute(
    "SELECT * FROM scrape_log WHERE project = 'laget' ORDER BY started_at DESC LIMIT 1"
  );

  const [teamStats] = await pool.execute(`
    SELECT a.team_id, t.namn,
      COUNT(DISTINCT a.id) AS aktiviteter,
      SUM(a.lok_aktivitet) AS lok_aktiviteter
    FROM lag_activities a
    JOIN lag_teams t ON t.id = a.team_id
    WHERE 1=1 ${dateFilter}
    GROUP BY a.team_id
    ORDER BY t.namn
  `, params);

  res.json({
    data: {
      ...stats[0],
      lok_aktiviteter: Number(stats[0].lok_aktiviteter) || 0,
      per_lag: teamStats,
      senaste_scrape: lastScrape[0] || null,
    }
  });
});

export default router;
