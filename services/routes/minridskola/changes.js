import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/minridskola/changes — Senaste ändringar
router.get('/', async (req, res) => {
  const { rider, course, field, limit = 50 } = req.query;

  let sql = `
    SELECT cl.detected_at, cl.field_name, cl.old_value, cl.new_value,
           cl.scrape_file, cl.rider_id, r.namn AS ryttare,
           ci.lnummer, ci.vecka, ci.datum, c.kursnamn, c.dag
    FROM mrs_change_log cl
    JOIN mrs_course_instances ci ON ci.id = cl.instance_id
    JOIN mrs_courses c ON c.lnummer = ci.lnummer
    LEFT JOIN mrs_riders r ON r.id = cl.rider_id
    WHERE 1=1
  `;
  const params = [];

  if (rider) {
    sql += ' AND cl.rider_id = ?';
    params.push(rider);
  }
  if (course) {
    sql += ' AND ci.lnummer = ?';
    params.push(course);
  }
  if (field) {
    sql += ' AND cl.field_name = ?';
    params.push(field);
  }

  sql += ' ORDER BY cl.detected_at DESC LIMIT ?';
  params.push(parseInt(limit));

  const [rows] = await pool.execute(sql, params);
  res.json({ data: rows, meta: { count: rows.length } });
});

// GET /api/minridskola/changes/summary — Sammanfattning per dag
router.get('/summary', async (req, res) => {
  const { days = 30 } = req.query;

  const [rows] = await pool.execute(`
    SELECT DATE(detected_at) AS datum,
           field_name,
           COUNT(*) AS antal
    FROM mrs_change_log
    WHERE detected_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY DATE(detected_at), field_name
    ORDER BY datum DESC, field_name
  `, [parseInt(days)]);

  res.json({ data: rows });
});

export default router;
