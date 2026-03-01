import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/minridskola/courses — Lista alla kurser
router.get('/', async (req, res) => {
  const { dag } = req.query;

  let sql = 'SELECT * FROM mrs_courses';
  const params = [];

  if (dag) {
    sql += ' WHERE dag = ?';
    params.push(dag);
  }

  sql += ' ORDER BY FIELD(dag, "Måndag","Tisdag","Onsdag","Torsdag","Fredag","Lördag","Söndag"), tid';

  const [rows] = await pool.execute(sql, params);
  res.json({ data: rows, meta: { count: rows.length } });
});

// GET /api/minridskola/courses/:lnummer — Specifik kurs med senaste tillfällen
router.get('/:lnummer', async (req, res) => {
  const { lnummer } = req.params;
  const { limit = 10 } = req.query;

  const [courses] = await pool.execute('SELECT * FROM mrs_courses WHERE lnummer = ?', [lnummer]);
  if (courses.length === 0) {
    return res.status(404).json({ error: 'Kurs hittades inte' });
  }

  const [instances] = await pool.execute(`
    SELECT ci.id, ci.vecka, ci.datum,
           COUNT(e.id) AS deltagare,
           SUM(e.avbokad) AS avbokade,
           SUM(e.narvaro) AS narvarande
    FROM mrs_course_instances ci
    LEFT JOIN mrs_enrollments e ON e.instance_id = ci.id
    WHERE ci.lnummer = ?
    GROUP BY ci.id
    ORDER BY ci.vecka DESC
    LIMIT ?
  `, [lnummer, parseInt(limit)]);

  res.json({
    data: {
      ...courses[0],
      instances,
    },
    meta: { instances: instances.length },
  });
});

// GET /api/minridskola/courses/:lnummer/weeks/:vecka — Deltagare för specifikt tillfälle
router.get('/:lnummer/weeks/:vecka', async (req, res) => {
  const { lnummer, vecka } = req.params;
  const veckaStr = `Vecka ${vecka}`;

  const [instances] = await pool.execute(
    'SELECT id, vecka, datum FROM mrs_course_instances WHERE lnummer = ? AND vecka = ?',
    [lnummer, veckaStr]
  );

  if (instances.length === 0) {
    return res.status(404).json({ error: 'Tillfälle hittades inte' });
  }

  const [enrollments] = await pool.execute(`
    SELECT e.rider_id, r.namn AS ryttare,
           h.id AS horse_id, h.hnummer AS horse_hnummer, h.namn AS hast,
           e.avbokad, e.narvaro
    FROM mrs_enrollments e
    JOIN mrs_riders r ON r.id = e.rider_id
    LEFT JOIN mrs_horses h ON h.id = e.horse_id
    WHERE e.instance_id = ?
    ORDER BY r.namn
  `, [instances[0].id]);

  res.json({
    data: {
      ...instances[0],
      lnummer,
      deltagare: enrollments,
    },
  });
});

export default router;
