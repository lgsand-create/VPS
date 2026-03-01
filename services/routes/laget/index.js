/**
 * Laget.se — API-routes
 *
 * Mountas på /api/laget av server.js
 */

import { Router } from 'express';
import teamsRouter from './teams.js';
import activitiesRouter from './activities.js';
import membersRouter from './members.js';
import statsRouter from './stats.js';
import changesRouter from './changes.js';

const router = Router();

router.use('/teams', teamsRouter);
router.use('/activities', activitiesRouter);
router.use('/members', membersRouter);
router.use('/stats', statsRouter);
router.use('/changes', changesRouter);

export default router;
