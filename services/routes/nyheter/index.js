/**
 * Nyheter — API-routes
 *
 * Mountas på /api/nyheter av server.js
 */

import { Router } from 'express';
import statsRouter from './stats.js';
import articlesRouter from './articles.js';

const router = Router();

router.use('/stats', statsRouter);
router.use('/articles', articlesRouter);

export default router;
