import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/nyheter/stats — Aggregerad statistik
router.get('/', async (req, res) => {
  const [stats] = await pool.execute(`
    SELECT
      COUNT(*) AS antal_artiklar,
      COALESCE(SUM(visningar), 0) AS totala_visningar,
      COALESCE(SUM(kommentarer), 0) AS totala_kommentarer,
      COUNT(DISTINCT forfattare) AS antal_forfattare,
      MIN(datum) AS aldsta_artikel,
      MAX(datum) AS senaste_artikel
    FROM nyh_articles
  `);

  const [lastScrape] = await pool.execute(
    "SELECT * FROM scrape_log WHERE project = 'nyheter' ORDER BY started_at DESC LIMIT 1"
  );

  res.json({
    data: {
      ...stats[0],
      totala_visningar: Number(stats[0].totala_visningar) || 0,
      totala_kommentarer: Number(stats[0].totala_kommentarer) || 0,
      senaste_scrape: lastScrape[0] || null,
    }
  });
});

export default router;
