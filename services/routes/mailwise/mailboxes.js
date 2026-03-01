/**
 * Brevlåde-routes — CRUD + OAuth-start + synk + test
 */

import { Router } from 'express';
import pool from '../../db/connection.js';
import { encryptToken, decryptToken } from '../../mailwise/crypto.js';
import { testConnection, clearTokenCache } from '../../mailwise/gmail.js';
import { getSettings } from '../../db/settings.js';

const router = Router();

// Standardkategorier som skapas för varje ny brevlåda
const DEFAULT_CATEGORIES = [
  { name: 'inquiry', display_name: 'Förfrågan', color: '#3b82f6' },
  { name: 'complaint', display_name: 'Klagomål', color: '#ef4444' },
  { name: 'order', display_name: 'Beställning', color: '#22c55e' },
  { name: 'support', display_name: 'Support', color: '#f59e0b' },
  { name: 'billing', display_name: 'Faktura', color: '#8b5cf6' },
  { name: 'feedback', display_name: 'Feedback', color: '#06b6d4' },
  { name: 'info', display_name: 'Information', color: '#6b7280' },
  { name: 'other', display_name: 'Övrigt', color: '#9ca3af' },
];

/**
 * GET /api/mailwise/mailboxes — Lista alla brevlådor
 */
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT m.id, m.email, m.display_name, m.enabled, m.auto_analyze,
             m.sync_status, m.sync_error, m.last_sync_at, m.created_at,
             m.sync_progress, m.sync_total,
             (SELECT COUNT(*) FROM mw_messages WHERE mailbox_id = m.id) as message_count,
             (SELECT COUNT(*) FROM mw_messages WHERE mailbox_id = m.id AND analyzed_at IS NULL) as unanalyzed_count,
             (SELECT COUNT(*) FROM mw_labels WHERE mailbox_id = m.id) as label_count,
             m.client_id IS NOT NULL AND m.refresh_token IS NOT NULL as is_connected
      FROM mw_mailboxes m
      ORDER BY m.created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error('  [MAILWISE] GET /mailboxes:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta brevlådor' });
  }
});

/**
 * GET /api/mailwise/mailboxes/:id — Detaljer för en brevlåda
 */
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT m.id, m.email, m.display_name, m.enabled, m.auto_analyze,
             m.sync_status, m.sync_error, m.last_sync_at, m.history_id,
             m.labels_filter, m.created_at, m.updated_at,
             m.client_id IS NOT NULL as has_client_id,
             m.refresh_token IS NOT NULL as is_connected,
             m.token_expires_at
      FROM mw_mailboxes m WHERE m.id = ?
    `, [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Brevlåda finns inte' });
    }

    // Lägg till statistik
    const [stats] = await pool.execute(`
      SELECT
        COUNT(*) as total_messages,
        SUM(CASE WHEN analyzed_at IS NOT NULL THEN 1 ELSE 0 END) as analyzed,
        SUM(CASE WHEN analyzed_at IS NULL THEN 1 ELSE 0 END) as unanalyzed,
        MIN(date) as oldest_message,
        MAX(date) as newest_message
      FROM mw_messages WHERE mailbox_id = ?
    `, [req.params.id]);

    const [labels] = await pool.execute(
      'SELECT gmail_label_id, name, type, message_count FROM mw_labels WHERE mailbox_id = ? ORDER BY type, name',
      [req.params.id]
    );

    res.json({
      ...rows[0],
      stats: stats[0],
      labels,
    });
  } catch (err) {
    console.error('  [MAILWISE] GET /mailboxes/:id:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta brevlåda' });
  }
});

/**
 * POST /api/mailwise/mailboxes — Skapa ny brevlåda (pre-OAuth)
 *
 * Body: { display_name, client_id, client_secret }
 */
router.post('/', async (req, res) => {
  try {
    const { display_name, client_id, client_secret } = req.body;

    if (!client_id || !client_secret) {
      return res.status(400).json({ error: 'Client ID och Client Secret krävs' });
    }

    // Kryptera client_secret
    const encryptedSecret = await encryptToken(client_secret);

    // Skapa brevlåda med temporärt e-post (uppdateras efter OAuth)
    const tempEmail = `pending-${Date.now()}@setup`;

    const [result] = await pool.execute(
      `INSERT INTO mw_mailboxes (email, display_name, client_id, client_secret, enabled)
       VALUES (?, ?, ?, ?, TRUE)`,
      [tempEmail, display_name || 'Ny brevlåda', client_id, encryptedSecret]
    );

    const mailboxId = result.insertId;

    // Skapa standardkategorier
    for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
      const cat = DEFAULT_CATEGORIES[i];
      await pool.execute(
        `INSERT IGNORE INTO mw_categories (mailbox_id, name, display_name, color, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [mailboxId, cat.name, cat.display_name, cat.color, i + 1]
      );
    }

    // Hämta redirect URI
    const settings = await getSettings('mailwise');
    const redirectUri = settings?.redirect_uri || 'https://vpn.compuna.se/api/mailwise/oauth/callback';

    res.status(201).json({
      id: mailboxId,
      message: 'Brevlåda skapad — anslut Gmail via OAuth',
      oauth_start_url: `/api/mailwise/oauth/start?mailbox_id=${mailboxId}`,
      redirect_uri: redirectUri,
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Brevlåda med denna e-post finns redan' });
    }
    console.error('  [MAILWISE] POST /mailboxes:', err.message);
    res.status(500).json({ error: 'Kunde inte skapa brevlåda' });
  }
});

/**
 * PUT /api/mailwise/mailboxes/:id — Uppdatera inställningar
 */
router.put('/:id', async (req, res) => {
  try {
    const { display_name, enabled, auto_analyze, labels_filter } = req.body;
    const updates = [];
    const values = [];

    if (display_name !== undefined) { updates.push('display_name = ?'); values.push(display_name); }
    if (enabled !== undefined) { updates.push('enabled = ?'); values.push(enabled); }
    if (auto_analyze !== undefined) { updates.push('auto_analyze = ?'); values.push(auto_analyze); }
    if (labels_filter !== undefined) { updates.push('labels_filter = ?'); values.push(JSON.stringify(labels_filter)); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Inga fält att uppdatera' });
    }

    values.push(req.params.id);
    await pool.execute(`UPDATE mw_mailboxes SET ${updates.join(', ')} WHERE id = ?`, values);

    res.json({ ok: true });
  } catch (err) {
    console.error('  [MAILWISE] PUT /mailboxes/:id:', err.message);
    res.status(500).json({ error: 'Kunde inte uppdatera brevlåda' });
  }
});

/**
 * DELETE /api/mailwise/mailboxes/:id — Ta bort brevlåda
 */
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM mw_mailboxes WHERE id = ?', [req.params.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Brevlåda finns inte' });
    }

    clearTokenCache(parseInt(req.params.id));
    res.json({ ok: true, message: 'Brevlåda och all data raderad' });
  } catch (err) {
    console.error('  [MAILWISE] DELETE /mailboxes/:id:', err.message);
    res.status(500).json({ error: 'Kunde inte ta bort brevlåda' });
  }
});

/**
 * POST /api/mailwise/mailboxes/:id/sync — Manuell synk
 */
router.post('/:id/sync', async (req, res) => {
  try {
    const mailboxId = parseInt(req.params.id);

    // Kolla att brevlådan finns
    const [rows] = await pool.execute(
      'SELECT id, email, history_id FROM mw_mailboxes WHERE id = ?',
      [mailboxId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Brevlåda finns inte' });
    }

    // Kör synk i bakgrunden
    const { initialSync, incrementalSync, syncLabels } = await import('../../mailwise/sync.js');

    res.json({ ok: true, message: 'Synk startad' });

    // Asynkron synk
    (async () => {
      try {
        await pool.execute(`UPDATE mw_mailboxes SET sync_status = 'syncing' WHERE id = ?`, [mailboxId]);

        const mailbox = rows[0];
        let result;

        if (mailbox.history_id) {
          result = await incrementalSync(mailboxId, mailbox.history_id);
          if (result.needsFullSync) {
            result = await initialSync(mailboxId);
          }
        } else {
          result = await initialSync(mailboxId);
        }

        await syncLabels(mailboxId);

        const historyId = result.historyId || result.newHistoryId || mailbox.history_id;
        await pool.execute(
          `UPDATE mw_mailboxes SET sync_status = 'idle', sync_error = NULL,
           last_sync_at = NOW(), history_id = ? WHERE id = ?`,
          [historyId, mailboxId]
        );
      } catch (err) {
        console.error(`  [MAILWISE] Synk brevlåda ${mailboxId} FEL:`, err.message);
        await pool.execute(
          `UPDATE mw_mailboxes SET sync_status = 'error', sync_error = ? WHERE id = ?`,
          [err.message.slice(0, 500), mailboxId]
        ).catch(() => {});
      }
    })();
  } catch (err) {
    console.error('  [MAILWISE] POST /mailboxes/:id/sync:', err.message);
    res.status(500).json({ error: 'Kunde inte starta synk' });
  }
});

/**
 * POST /api/mailwise/mailboxes/:id/test — Testa Gmail API-anslutning
 */
router.post('/:id/test', async (req, res) => {
  try {
    const result = await testConnection(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/mailwise/mailboxes/:id/labels — Hämta synkade etiketter
 */
router.get('/:id/labels', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT gmail_label_id, name, type, message_count, synced_at FROM mw_labels WHERE mailbox_id = ? ORDER BY type, name',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('  [MAILWISE] GET /mailboxes/:id/labels:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta etiketter' });
  }
});

export default router;
