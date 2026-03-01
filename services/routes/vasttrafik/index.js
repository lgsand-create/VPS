/**
 * Västtrafik Routes — Projektrouter
 *
 * Monterar sub-routers för hållplatser, avgångar och statistik.
 * Skyddade med API-nyckel (monteras under /api/vasttrafik/).
 */

import { Router } from 'express';
import stopsRouter from './stops.js';
import departuresRouter from './departures.js';
import statsRouter from './stats.js';

const router = Router();

router.use('/stops', stopsRouter);
router.use('/departures', departuresRouter);
router.use('/stats', statsRouter);

export default router;
