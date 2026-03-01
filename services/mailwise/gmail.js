/**
 * Gmail API-klient — OAuth2 Authorization Code Flow + Gmail REST API
 *
 * Varje brevlåda har egna OAuth2-tokens (Authorization Code flow).
 * Tokens krypteras med AES-256-GCM via crypto.js.
 * Rate limiting: 429 → 2 min cooldown (mönster från vasttrafik/api.js).
 */

import { getProject } from '../projects/index.js';
import { getSettings } from '../db/settings.js';
import { encryptToken, decryptToken } from './crypto.js';
import pool from '../db/connection.js';

// --- Google OAuth2 URLs ---
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

// --- Per-mailbox tokencache ---
const tokenCache = new Map();  // Map<mailboxId, { accessToken, expiresAt }>

// --- Global rate-limit backoff ---
let rateLimitUntil = 0;

function isRateLimited() {
  return Date.now() < rateLimitUntil;
}

function setRateLimitCooldown() {
  rateLimitUntil = Date.now() + 2 * 60_000;
  console.warn('  [MAILWISE] Gmail API rate limit — pausar i 2 min');
}

// --- OAuth2 Authorization Code Flow ---

/**
 * Bygg Google OAuth2 authorize-URL
 */
export function generateAuthUrl(clientId, redirectUri, state) {
  const config = getProject('mailwise');
  const scopes = config.gmail.scopes.join(' ');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    state: state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Byt authorization code mot tokens
 */
export async function exchangeCode(code, clientId, clientSecret, redirectUri) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange misslyckades: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Hämta giltig access_token för en brevlåda (auto-refresh)
 */
export async function getAccessToken(mailboxId) {
  // Cache-first
  const cached = tokenCache.get(mailboxId);
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) {
    return cached.accessToken;
  }

  // Hämta från DB
  const [rows] = await pool.execute(
    `SELECT access_token, refresh_token, token_expires_at, client_id, client_secret
     FROM mw_mailboxes WHERE id = ? AND enabled = TRUE`,
    [mailboxId]
  );

  if (rows.length === 0) {
    throw new Error(`Brevlåda ${mailboxId} finns inte eller är inaktiverad`);
  }

  const mailbox = rows[0];

  // Dekryptera tokens
  const accessToken = await decryptToken(mailbox.access_token);
  const refreshToken = await decryptToken(mailbox.refresh_token);
  const clientSecret = await decryptToken(mailbox.client_secret);

  // Kolla om token fortfarande är giltig
  const expiresAt = mailbox.token_expires_at ? new Date(mailbox.token_expires_at).getTime() : 0;
  if (accessToken && expiresAt > Date.now() + 5 * 60_000) {
    tokenCache.set(mailboxId, { accessToken, expiresAt });
    return accessToken;
  }

  // Förnya med refresh_token
  if (!refreshToken) {
    throw new Error(`Brevlåda ${mailboxId}: refresh_token saknas — koppla om Gmail`);
  }

  return refreshAccessToken(mailboxId, refreshToken, mailbox.client_id, clientSecret);
}

/**
 * Förnya access_token med refresh_token
 */
export async function refreshAccessToken(mailboxId, refreshToken, clientId, clientSecret) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`  [MAILWISE] Token refresh ${res.status}: ${text}`);

    // Markera brevlåda som felaktig
    await pool.execute(
      `UPDATE mw_mailboxes SET sync_status = 'error', sync_error = ? WHERE id = ?`,
      [`Token refresh misslyckades: ${res.status}`, mailboxId]
    );

    throw new Error(`Token refresh misslyckades: ${res.status}`);
  }

  const data = await res.json();
  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  const expiresAtStr = new Date(expiresAt).toISOString().slice(0, 19).replace('T', ' ');

  // Kryptera och spara
  const encryptedAccess = await encryptToken(data.access_token);

  await pool.execute(
    `UPDATE mw_mailboxes SET access_token = ?, token_expires_at = ? WHERE id = ?`,
    [encryptedAccess, expiresAtStr, mailboxId]
  );

  // Uppdatera cache
  tokenCache.set(mailboxId, { accessToken: data.access_token, expiresAt });

  return data.access_token;
}

// --- Gmail API-anrop ---

/**
 * Generisk Gmail API-anrop med auth och rate limiting
 */
async function gmailFetch(mailboxId, path, options = {}) {
  if (isRateLimited()) {
    throw new Error('Gmail API rate limited — försök igen om en stund');
  }

  const accessToken = await getAccessToken(mailboxId);
  const url = `${GMAIL_API_BASE}/users/me${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      ...options.headers,
    },
  });

  if (res.status === 429) {
    setRateLimitCooldown();
    throw new Error('Gmail API rate limit (429)');
  }

  if (res.status === 401) {
    // Token ogiltig — rensa cache och försök en gång till
    tokenCache.delete(mailboxId);
    const newToken = await getAccessToken(mailboxId);
    const retryRes = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${newToken}`,
        ...options.headers,
      },
    });
    if (!retryRes.ok) {
      const text = await retryRes.text().catch(() => '');
      throw new Error(`Gmail API ${retryRes.status}: ${text}`);
    }
    return retryRes.json();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gmail API ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * Lista meddelanden (med sökfråga)
 */
export async function fetchMessages(mailboxId, query = '', maxResults = 50, pageToken = null) {
  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (query) params.set('q', query);
  if (pageToken) params.set('pageToken', pageToken);
  return gmailFetch(mailboxId, `/messages?${params}`);
}

/**
 * Hämta enskilt meddelande
 */
export async function fetchMessage(mailboxId, messageId, format = 'full') {
  return gmailFetch(mailboxId, `/messages/${messageId}?format=${format}`);
}

/**
 * Hämta tråd med alla meddelanden
 */
export async function fetchThread(mailboxId, threadId) {
  return gmailFetch(mailboxId, `/threads/${threadId}?format=full`);
}

/**
 * Hämta alla etiketter
 */
export async function fetchLabels(mailboxId) {
  return gmailFetch(mailboxId, '/labels');
}

/**
 * Hämta historik (inkrementell synk)
 */
export async function fetchHistory(mailboxId, startHistoryId) {
  const params = new URLSearchParams({ startHistoryId });
  for (const type of ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']) {
    params.append('historyTypes', type);
  }
  return gmailFetch(mailboxId, `/history?${params}`);
}

/**
 * Hämta användarprofil (e-post, totalt antal meddelanden)
 */
export async function fetchProfile(mailboxId) {
  return gmailFetch(mailboxId, '/profile');
}

/**
 * Testa Gmail API-anslutning
 */
export async function testConnection(mailboxId) {
  try {
    const profile = await fetchProfile(mailboxId);
    return {
      ok: true,
      email: profile.emailAddress,
      messagesTotal: profile.messagesTotal,
      threadsTotal: profile.threadsTotal,
      historyId: profile.historyId,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
    };
  }
}

/**
 * Rensa tokencache (vid borttagning av brevlåda etc.)
 */
export function clearTokenCache(mailboxId) {
  if (mailboxId) {
    tokenCache.delete(mailboxId);
  } else {
    tokenCache.clear();
  }
}
