/**
 * MailWise Routes — Projektrouter
 *
 * Monterar sub-routers för brevlådor, meddelanden, jobb, FAQ och statistik.
 * Skyddade med API-nyckel (monteras under /api/mailwise/).
 */

import { Router } from 'express';
import mailboxesRouter from './mailboxes.js';
import messagesRouter from './messages.js';
import jobsRouter from './jobs.js';
import faqsRouter from './faqs.js';
import statsRouter from './stats.js';
import diagnosticsRouter from './diagnostics.js';

const router = Router();

router.use('/mailboxes', mailboxesRouter);
router.use('/messages', messagesRouter);
router.use('/jobs', jobsRouter);
router.use('/faqs', faqsRouter);
router.use('/stats', statsRouter);
router.use('/diagnostics', diagnosticsRouter);

export default router;
