import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/minridskola/riders — Lista alla ryttare
router.get('/', async (req, res) => {
  const { search } = req.query;

  let sql = 'SELECT * FROM mrs_riders';
  const params = [];

  if (search) {
    sql += ' WHERE namn LIKE ?';
    params.push(`%${search}%`);
  }

  sql += ' ORDER BY namn';

  const [rows] = await pool.execute(sql, params);
  res.json({ data: rows, meta: { count: rows.length } });
});

// GET /api/minridskola/riders/:id — Specifik ryttare med sammanfattning
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const [riders] = await pool.execute('SELECT * FROM mrs_riders WHERE id = ?', [id]);
  if (riders.length === 0) {
    return res.status(404).json({ error: 'Ryttare hittades inte' });
  }

  const [stats] = await pool.execute(`
    SELECT
      COUNT(*) AS tillfallen,
      SUM(narvaro) AS narvarande,
      SUM(avbokad) AS avbokade,
      COUNT(DISTINCT ci.lnummer) AS kurser
    FROM mrs_enrollments e
    JOIN mrs_course_instances ci ON ci.id = e.instance_id
    WHERE e.rider_id = ?
  `, [id]);

  res.json({
    data: {
      ...riders[0],
      stats: stats[0],
    },
  });
});

// GET /api/minridskola/riders/:id/attendance — Närvarohistorik
router.get('/:id/attendance', async (req, res) => {
  const { id } = req.params;
  const { from, to, limit = 50 } = req.query;

  let sql = `
    SELECT ci.vecka, ci.datum, c.lnummer, c.kursnamn, c.dag, c.tid,
           h.id AS horse_id, h.hnummer AS horse_hnummer, h.namn AS hast,
           e.avbokad, e.narvaro
    FROM mrs_enrollments e
    JOIN mrs_course_instances ci ON ci.id = e.instance_id
    JOIN mrs_courses c ON c.lnummer = ci.lnummer
    LEFT JOIN mrs_horses h ON h.id = e.horse_id
    WHERE e.rider_id = ?
  `;
  const params = [id];

  if (from) {
    sql += ' AND ci.datum >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND ci.datum <= ?';
    params.push(to);
  }

  sql += ' ORDER BY ci.datum DESC, c.kursnamn LIMIT ?';
  params.push(parseInt(limit));

  const [rows] = await pool.execute(sql, params);
  res.json({ data: rows, meta: { count: rows.length } });
});

export default router;
