import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// GET /api/nyheter/articles — Artikellista med filter
router.get('/', async (req, res) => {
  const { from, to, author, search, limit = 50 } = req.query;

  let where = '1=1';
  const params = [];

  if (from)   { where += ' AND datum >= ?'; params.push(from); }
  if (to)     { where += ' AND datum <= ?'; params.push(to); }
  if (author) { where += ' AND forfattare LIKE ?'; params.push(`%${author}%`); }
  if (search) { where += ' AND (rubrik LIKE ? OR text_content LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  params.push(parseInt(limit));

  const [articles] = await pool.execute(`
    SELECT id, news_id, rubrik, datum, visningar, kommentarer,
           forfattare, url, bild, bild_url,
           LEFT(text_content, 200) AS text_preview
    FROM nyh_articles
    WHERE ${where}
    ORDER BY datum DESC
    LIMIT ?
  `, params);

  res.json({ data: articles, meta: { count: articles.length } });
});

// GET /api/nyheter/articles/:id — Specifik artikel
router.get('/:id', async (req, res) => {
  const [articles] = await pool.execute(
    'SELECT * FROM nyh_articles WHERE id = ?',
    [req.params.id]
  );

  if (articles.length === 0) {
    return res.status(404).json({ error: 'Artikeln finns inte' });
  }

  res.json({ data: articles[0] });
});

export default router;
