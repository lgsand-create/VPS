import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/minridskola/horses — Lista alla hästar (med utökade fält)
router.get('/', async (req, res) => {
  const { search, typ } = req.query;

  let sql = `
    SELECT h.id, h.hnummer, h.namn, h.typ, h.kon, h.fodelsear, h.ras,
           h.mankhojd, h.ponnykategori, h.farg, h.bortrest, h.lektionshast,
           h.inkopsdatum, h.avford_datum,
           COUNT(DISTINCT e.rider_id) AS ryttare,
           COUNT(DISTINCT ci.lnummer) AS kurser,
           COUNT(e.id) AS tillfallen,
           MAX(ci.datum) AS senast_sedd
    FROM mrs_horses h
    LEFT JOIN mrs_enrollments e ON e.horse_id = h.id
    LEFT JOIN mrs_course_instances ci ON ci.id = e.instance_id
  `;
  const params = [];
  const conditions = [];

  if (search) {
    conditions.push('h.namn LIKE ?');
    params.push(`%${search}%`);
  }
  if (typ) {
    conditions.push('h.typ = ?');
    params.push(typ);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' GROUP BY h.id ORDER BY h.namn';

  const [rows] = await pool.execute(sql, params);
  res.json({ data: rows, meta: { count: rows.length } });
});

// GET /api/minridskola/horses/:id — En häst med all data
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const [horses] = await pool.execute('SELECT * FROM mrs_horses WHERE id = ?', [id]);
  if (horses.length === 0) {
    return res.status(404).json({ error: 'Häst hittades inte' });
  }

  // Statistik från närvaro
  const [stats] = await pool.execute(`
    SELECT
      COUNT(DISTINCT e.rider_id) AS ryttare,
      COUNT(DISTINCT ci.lnummer) AS kurser,
      COUNT(e.id) AS tillfallen,
      MIN(ci.datum) AS forst_sedd,
      MAX(ci.datum) AS senast_sedd
    FROM mrs_enrollments e
    JOIN mrs_course_instances ci ON ci.id = e.instance_id
    WHERE e.horse_id = ?
  `, [id]);

  // Vilka kurser hästen går i
  const [courses] = await pool.execute(`
    SELECT c.lnummer, c.kursnamn, c.dag, c.tid, c.ridlarare,
           COUNT(e.id) AS tillfallen,
           MAX(ci.datum) AS senast
    FROM mrs_enrollments e
    JOIN mrs_course_instances ci ON ci.id = e.instance_id
    JOIN mrs_courses c ON c.lnummer = ci.lnummer
    WHERE e.horse_id = ?
    GROUP BY c.lnummer
    ORDER BY tillfallen DESC
  `, [id]);

  // Vilka ryttare hästen haft
  const [riders] = await pool.execute(`
    SELECT r.id, r.namn,
           COUNT(e.id) AS tillfallen,
           MAX(ci.datum) AS senast
    FROM mrs_enrollments e
    JOIN mrs_course_instances ci ON ci.id = e.instance_id
    JOIN mrs_riders r ON r.id = e.rider_id
    WHERE e.horse_id = ?
    GROUP BY r.id
    ORDER BY tillfallen DESC
  `, [id]);

  // Foder
  const [feed] = await pool.execute(
    'SELECT rad_nr, fodersort, fodring_1, fodring_2, fodring_3, fodring_4, fodring_5 FROM mrs_horse_feed WHERE horse_id = ? ORDER BY rad_nr',
    [id]
  );

  // Journaler
  const [journals] = await pool.execute(
    'SELECT typ, datum, till_datum, beskrivning FROM mrs_horse_journals WHERE horse_id = ? ORDER BY datum DESC',
    [id]
  );

  // Sjukskrivningar
  const [sickLeave] = await pool.execute(
    'SELECT datum_from, datum_to, orsak FROM mrs_horse_sick_leave WHERE horse_id = ? ORDER BY datum_from DESC',
    [id]
  );

  // Skoningar
  const [shoeing] = await pool.execute(
    'SELECT datum, notering FROM mrs_horse_shoeing WHERE horse_id = ? ORDER BY datum DESC',
    [id]
  );

  res.json({
    data: {
      ...horses[0],
      stats: stats[0],
      courses,
      riders,
      feed,
      journals,
      sickLeave,
      shoeing,
    },
  });
});

export default router;
