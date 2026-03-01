/**
 * Monitor Routes — mountar alla sub-routers
 *
 * Monteras automatiskt pa /api/monitor av server.js
 */

import { Router } from 'express';
import sitesRouter from './sites.js';
import checksRouter from './checks.js';
import incidentsRouter from './incidents.js';
import metricsRouter from './metrics.js';
import baselinesRouter from './baselines.js';
import toolsRouter from './tools.js';
import machinesRouter from './machines.js';

const router = Router();

router.use('/sites', sitesRouter);
router.use('/checks', checksRouter);
router.use('/incidents', incidentsRouter);
router.use('/metrics', metricsRouter);
router.use('/baselines', baselinesRouter);
router.use('/tools', toolsRouter);
router.use('/machines', machinesRouter);

export default router;
