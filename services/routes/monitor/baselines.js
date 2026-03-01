/**
 * Monitor Baselines — POST /api/monitor/baselines/:siteId
 *
 * Uppdaterar filintegritets-baseline via SSH/SFTP.
 */

import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// POST /api/monitor/baselines/:siteId — Uppdatera baseline
router.post('/:siteId', async (req, res) => {
  try {
    const [sites] = await pool.execute(
      'SELECT * FROM mon_sites WHERE id = ?',
      [req.params.siteId]
    );

    if (sites.length === 0) {
      return res.status(404).json({ error: 'Sajt ej funnen' });
    }

    const site = sites[0];

    if (!site.ssh_host || !site.check_integrity) {
      return res.status(400).json({
        error: 'Sajten har inte SSH-konfiguration eller integrity-check avslaget',
      });
    }

    // Lazy-import integrity-modulen
    const { updateBaselines } = await import('../../monitor/checks/integrity.js');
    const results = await updateBaselines(site);

    res.json({
      data: results,
      meta: { count: results.length, siteId: req.params.siteId },
      message: 'Baselines uppdaterade',
    });
  } catch (err) {
    console.error('  [MONITOR] Baseline-fel:', err.message);
    res.status(500).json({ error: `Kunde inte uppdatera baselines: ${err.message}` });
  }
});

export default router;
