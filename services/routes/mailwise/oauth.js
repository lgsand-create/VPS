/**
 * OAuth2-callback för Gmail
 *
 * Öppen route — Google omdirigerar användaren hit efter auktorisering.
 * Monteras i server.js som: app.use('/api/mailwise/oauth', ...)
 */

import { Router } from 'express';
import { randomBytes, createHash } from 'crypto';
import { generateAuthUrl, exchangeCode, fetchProfile } from '../../mailwise/gmail.js';
import { encryptToken } from '../../mailwise/crypto.js';
import { getSettings } from '../../db/settings.js';
import pool from '../../db/connection.js';

const router = Router();

// CSRF state-tokens (in-memory, kort livslängd)
const pendingStates = new Map();  // Map<stateToken, { mailboxId, createdAt }>

// Rensa gamla states var 10:e minut
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [key, val] of pendingStates) {
    if (val.createdAt < cutoff) pendingStates.delete(key);
  }
}, 10 * 60_000);

/**
 * GET /api/mailwise/oauth/start?mailbox_id=...
 *
 * Initierar OAuth-flöde — omdirigerar till Google consent screen.
 * Kräver att brevlådan redan är skapad (med client_id).
 */
router.get('/start', async (req, res) => {
  try {
    const mailboxId = parseInt(req.query.mailbox_id);
    if (!mailboxId) {
      return res.status(400).json({ error: 'mailbox_id krävs' });
    }

    // Hämta brevlåda
    const [rows] = await pool.execute(
      'SELECT id, client_id FROM mw_mailboxes WHERE id = ?',
      [mailboxId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Brevlåda finns inte' });
    }

    const mailbox = rows[0];
    if (!mailbox.client_id) {
      return res.status(400).json({ error: 'Client ID saknas — fyll i OAuth2-uppgifter först' });
    }

    // Hämta redirect URI från settings
    const settings = await getSettings('mailwise');
    const redirectUri = settings?.redirect_uri || 'https://vpn.compuna.se/api/mailwise/oauth/callback';

    // Generera CSRF state token
    const stateToken = randomBytes(32).toString('hex');
    pendingStates.set(stateToken, { mailboxId, createdAt: Date.now() });

    // Bygg auth URL och omdirigera
    const authUrl = generateAuthUrl(mailbox.client_id, redirectUri, stateToken);
    res.redirect(authUrl);
  } catch (err) {
    console.error('  [MAILWISE] OAuth start-fel:', err.message);
    res.redirect('/#mailwise?setup=error&message=' + encodeURIComponent(err.message));
  }
});

/**
 * GET /api/mailwise/oauth/callback?code=...&state=...
 *
 * Tar emot callback från Google, sparar tokens, omdirigerar till dashboard.
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    // Google skickar error om användaren nekade
    if (error) {
      return res.redirect('/#mailwise?setup=error&message=' + encodeURIComponent(error));
    }

    if (!code || !state) {
      return res.redirect('/#mailwise?setup=error&message=' + encodeURIComponent('Saknar code eller state'));
    }

    // Verifiera CSRF state
    const stateData = pendingStates.get(state);
    if (!stateData) {
      return res.redirect('/#mailwise?setup=error&message=' + encodeURIComponent('Ogiltig eller utgången state-token'));
    }
    pendingStates.delete(state);

    // Kolla att state inte är för gammal (10 min max)
    if (Date.now() - stateData.createdAt > 10 * 60_000) {
      return res.redirect('/#mailwise?setup=error&message=' + encodeURIComponent('State-token har gått ut'));
    }

    const { mailboxId } = stateData;

    // Hämta brevlåda
    const [rows] = await pool.execute(
      'SELECT id, client_id, client_secret FROM mw_mailboxes WHERE id = ?',
      [mailboxId]
    );

    if (rows.length === 0) {
      return res.redirect('/#mailwise?setup=error&message=' + encodeURIComponent('Brevlåda finns inte'));
    }

    const mailbox = rows[0];
    const clientSecret = await import('../../mailwise/crypto.js').then(m => m.decryptToken(mailbox.client_secret));

    // Hämta redirect URI
    const settings = await getSettings('mailwise');
    const redirectUri = settings?.redirect_uri || 'https://vpn.compuna.se/api/mailwise/oauth/callback';

    // Byt code mot tokens
    const tokenData = await exchangeCode(code, mailbox.client_id, clientSecret, redirectUri);

    // Kryptera tokens
    const encryptedAccess = await encryptToken(tokenData.access_token);
    const encryptedRefresh = tokenData.refresh_token
      ? await encryptToken(tokenData.refresh_token)
      : null;

    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');

    // Spara tokens
    const updateFields = [
      'access_token = ?',
      'token_expires_at = ?',
      "sync_status = 'idle'",
      'sync_error = NULL',
    ];
    const updateValues = [encryptedAccess, expiresAt];

    if (encryptedRefresh) {
      updateFields.push('refresh_token = ?');
      updateValues.push(encryptedRefresh);
    }

    updateValues.push(mailboxId);

    await pool.execute(
      `UPDATE mw_mailboxes SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    // Hämta profil och uppdatera e-post
    try {
      const profile = await fetchProfile(mailboxId);
      if (profile.emailAddress) {
        await pool.execute(
          'UPDATE mw_mailboxes SET email = ?, history_id = ? WHERE id = ?',
          [profile.emailAddress, profile.historyId || null, mailboxId]
        );
      }
    } catch {
      // Inte kritiskt — e-post kan sättas manuellt
    }

    console.log(`  [MAILWISE] OAuth slutförd för brevlåda ${mailboxId}`);
    res.redirect('/#mailwise?setup=success');
  } catch (err) {
    console.error('  [MAILWISE] OAuth callback-fel:', err.message);
    res.redirect('/#mailwise?setup=error&message=' + encodeURIComponent(err.message));
  }
});

export default router;
