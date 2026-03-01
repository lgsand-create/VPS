import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/minridskola/stats — Aggregerad statistik
router.get('/', async (req, res) => {
  const { from, to } = req.query;

  let dateFilter = '';
  const params = [];

  if (from) {
    dateFilter += ' AND ci.datum >= ?';
    params.push(from);
  }
  if (to) {
    dateFilter += ' AND ci.datum <= ?';
    params.push(to);
  }

  const [stats] = await pool.execute(`
    SELECT
      COUNT(DISTINCT ci.id) AS tillfallen,
      COUNT(DISTINCT ci.lnummer) AS kurser,
      COUNT(DISTINCT e.rider_id) AS ryttare,
      COUNT(DISTINCT CASE WHEN NOT e.avbokad THEN e.horse_id END) AS hastar,
      COUNT(e.id) AS bokningar,
      SUM(e.avbokad) AS avbokade,
      SUM(e.narvaro) AS narvarande,
      SUM(CASE WHEN NOT e.avbokad THEN 1 ELSE 0 END) AS aktiva_platser
    FROM mrs_course_instances ci
    LEFT JOIN mrs_enrollments e ON e.instance_id = ci.id
    WHERE 1=1 ${dateFilter}
  `, params);

  const s = stats[0];
  const narvarograd = s.aktiva_platser > 0
    ? Math.round(s.narvarande / s.aktiva_platser * 100)
    : 0;

  // Senaste scrape-info för detta projekt
  const [lastScrape] = await pool.execute(
    "SELECT * FROM scrape_log WHERE project = 'minridskola' ORDER BY started_at DESC LIMIT 1"
  );

  const [weekCount] = await pool.execute(`
    SELECT COUNT(DISTINCT vecka) AS veckor FROM mrs_course_instances
    WHERE 1=1 ${dateFilter}
  `, params);

  res.json({
    data: {
      veckor: weekCount[0].veckor,
      tillfallen: s.tillfallen,
      kurser: s.kurser,
      ryttare: s.ryttare,
      hastar: s.hastar,
      bokningar: s.bokningar,
      avbokade: Number(s.avbokade) || 0,
      narvarande: Number(s.narvarande) || 0,
      aktiva_platser: Number(s.aktiva_platser) || 0,
      narvarograd,
      senaste_scrape: lastScrape[0] || null,
    },
  });
});

export default router;
