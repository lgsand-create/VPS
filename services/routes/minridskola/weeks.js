import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/minridskola/weeks — Lista alla scrapade veckor
router.get('/', async (req, res) => {
  const { year } = req.query;

  let sql = `
    SELECT ci.vecka,
           MIN(ci.datum) AS from_date,
           MAX(ci.datum) AS to_date,
           COUNT(DISTINCT ci.lnummer) AS kurser,
           COUNT(e.id) AS bokningar,
           SUM(e.narvaro) AS narvarande,
           SUM(e.avbokad) AS avbokade
    FROM mrs_course_instances ci
    LEFT JOIN mrs_enrollments e ON e.instance_id = ci.id
  `;
  const params = [];

  if (year) {
    sql += ' WHERE ci.vecka LIKE ?';
    params.push(`Vecka ${year}-%`);
  }

  sql += ' GROUP BY ci.vecka ORDER BY ci.vecka DESC';

  const [rows] = await pool.execute(sql, params);
  res.json({ data: rows, meta: { count: rows.length } });
});

// GET /api/minridskola/weeks/:week — Specifik vecka med alla kurser + deltagare
router.get('/:week', async (req, res) => {
  const veckaStr = `Vecka ${req.params.week}`;

  const [instances] = await pool.execute(`
    SELECT ci.id, ci.lnummer, ci.datum, c.kursnamn, c.dag, c.tid, c.plats, c.ridlarare
    FROM mrs_course_instances ci
    JOIN mrs_courses c ON c.lnummer = ci.lnummer
    WHERE ci.vecka = ?
    ORDER BY FIELD(c.dag, 'Måndag','Tisdag','Onsdag','Torsdag','Fredag','Lördag','Söndag'), c.tid
  `, [veckaStr]);

  if (instances.length === 0) {
    return res.status(404).json({ error: 'Vecka hittades inte' });
  }

  const result = [];
  for (const inst of instances) {
    const [enrollments] = await pool.execute(`
      SELECT e.rider_id, r.namn AS ryttare,
             h.id AS horse_id, h.hnummer AS horse_hnummer, h.namn AS hast,
             e.avbokad, e.narvaro
      FROM mrs_enrollments e
      JOIN mrs_riders r ON r.id = e.rider_id
      LEFT JOIN mrs_horses h ON h.id = e.horse_id
      WHERE e.instance_id = ?
      ORDER BY r.namn
    `, [inst.id]);

    result.push({
      lnummer: inst.lnummer,
      kursnamn: inst.kursnamn,
      dag: inst.dag,
      tid: inst.tid,
      plats: inst.plats,
      ridlarare: inst.ridlarare,
      datum: inst.datum,
      deltagare: enrollments,
    });
  }

  res.json({
    data: { vecka: veckaStr, kurser: result },
    meta: { kurser: result.length },
  });
});

export default router;
