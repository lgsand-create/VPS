/**
 * MinRidskola — API-routes
 *
 * Mountas på /api/minridskola av server.js
 */

import { Router } from 'express';
import coursesRouter from './courses.js';
import ridersRouter from './riders.js';
import attendanceRouter from './attendance.js';
import weeksRouter from './weeks.js';
import statsRouter from './stats.js';
import changesRouter from './changes.js';
import horsesRouter from './horses.js';

const router = Router();

router.use('/courses', coursesRouter);
router.use('/riders', ridersRouter);
router.use('/horses', horsesRouter);
router.use('/attendance', attendanceRouter);
router.use('/weeks', weeksRouter);
router.use('/stats', statsRouter);
router.use('/changes', changesRouter);

export default router;
