import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/minridskola/attendance — Sök bokningar/närvaro
router.get('/', async (req, res) => {
  const { course, rider, week, from, to, limit = 100 } = req.query;

  let sql = `
    SELECT ci.vecka, ci.datum, c.lnummer, c.kursnamn, c.dag, c.tid,
           e.rider_id, r.namn AS ryttare,
           h.id AS horse_id, h.hnummer AS horse_hnummer, h.namn AS hast,
           e.avbokad, e.narvaro
    FROM mrs_enrollments e
    JOIN mrs_course_instances ci ON ci.id = e.instance_id
    JOIN mrs_courses c ON c.lnummer = ci.lnummer
    JOIN mrs_riders r ON r.id = e.rider_id
    LEFT JOIN mrs_horses h ON h.id = e.horse_id
    WHERE 1=1
  `;
  const params = [];

  if (course) {
    sql += ' AND c.lnummer = ?';
    params.push(course);
  }
  if (rider) {
    sql += ' AND e.rider_id = ?';
    params.push(rider);
  }
  if (week) {
    sql += ' AND ci.vecka = ?';
    params.push(`Vecka ${week}`);
  }
  if (from) {
    sql += ' AND ci.datum >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND ci.datum <= ?';
    params.push(to);
  }

  sql += ' ORDER BY ci.datum DESC, c.kursnamn, r.namn LIMIT ?';
  params.push(parseInt(limit));

  const [rows] = await pool.execute(sql, params);
  res.json({ data: rows, meta: { count: rows.length } });
});

export default router;
