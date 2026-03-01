/**
 * API-nyckelhantering — generering, hashning, validering och användningsloggning
 *
 * Säkerhetsprinciper:
 *   - Nycklar genereras med crypto.randomBytes (256 bitar entropi)
 *   - Bara SHA-256 hash + prefix sparas i DB, aldrig hela nyckeln
 *   - Jämförelse sker med timingSafeEqual (förhindrar timing-attacker)
 *   - API-nycklar maskeras i all loggning
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import pool from '../db/connection.js';

const KEY_PREFIX = 'chub_';
const PREFIX_LENGTH = 12; // "chub_" (5) + 7 tecken av random-delen

// --- Nyckelgenerering ---

/**
 * Generera en ny API-nyckel
 * @returns {{ fullKey: string, prefix: string, hash: string }}
 */
export function generateKey() {
  const bytes = randomBytes(32);
  const randomPart = bytes.toString('base64url');
  const fullKey = KEY_PREFIX + randomPart;
  const prefix = fullKey.slice(0, PREFIX_LENGTH);
  const hash = createHash('sha256').update(fullKey).digest('hex');

  return { fullKey, prefix, hash };
}

/**
 * Hasha en nyckel med SHA-256
 * @param {string} key
 * @returns {string} hex-hash
 */
export function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

// --- Validerings-middleware ---

/**
 * Express-middleware: Validerar API-nyckel för projekt-endpoints
 *
 * Extraherar nyckel från:
 *   1. Header: X-API-Key (rekommenderat)
 *   2. Query param: ?api_key=... (fallback)
 *
 * Sätter req.apiKey vid lyckad validering.
 */
export async function validateApiKey(req, res, next) {
  // Same-origin bypass: dashboard-anrop från samma server kräver ingen nyckel
  // Skyddas av VPN-gränsen istället (samma som /api/system/*)
  const referer = req.headers.referer || '';
  const host = req.headers.host || '';
  if (referer && host) {
    try {
      if (new URL(referer).host === host) return next();
    } catch { /* ogiltigt referer — fortsätt med nyckelvalidering */ }
  }

  // Extrahera nyckel
  const key = req.headers['x-api-key'] || req.query.api_key;

  if (!key) {
    return res.status(401).json({ error: 'API-nyckel saknas. Skicka via X-API-Key header.' });
  }

  // Validera format
  if (typeof key !== 'string' || key.length < PREFIX_LENGTH) {
    return res.status(401).json({ error: 'Ogiltigt nyckelformat' });
  }

  try {
    const prefix = key.slice(0, PREFIX_LENGTH);
    const keyHash = hashKey(key);
    const keyHashBuffer = Buffer.from(keyHash, 'hex');

    // Slå upp kandidater via prefix
    const [rows] = await pool.execute(
      'SELECT * FROM api_keys WHERE key_prefix = ? AND revoked = FALSE',
      [prefix]
    );

    let matchedKey = null;
    for (const row of rows) {
      const rowHashBuffer = Buffer.from(row.key_hash, 'hex');

      // Timing-safe jämförelse — förhindrar timing-attacker
      if (keyHashBuffer.length === rowHashBuffer.length &&
          timingSafeEqual(keyHashBuffer, rowHashBuffer)) {
        matchedKey = row;
        break;
      }
    }

    if (!matchedKey) {
      return res.status(401).json({ error: 'Ogiltig API-nyckel' });
    }

    // Kontrollera utgångsdatum
    if (matchedKey.expires_at && new Date(matchedKey.expires_at) < new Date()) {
      return res.status(401).json({ error: 'API-nyckel har gått ut' });
    }

    // Kontrollera projektscoping
    const projectId = req.params.projectId;
    if (projectId && matchedKey.project_id !== projectId) {
      return res.status(403).json({ error: 'Nyckeln har inte behörighet till detta projekt' });
    }

    // Kontrollera allowed_origins (för webb-konsumenter)
    if (matchedKey.allowed_origins) {
      const origin = req.headers.origin;
      try {
        const allowed = JSON.parse(matchedKey.allowed_origins);
        if (Array.isArray(allowed) && allowed.length > 0 && origin) {
          if (!allowed.includes(origin)) {
            return res.status(403).json({ error: 'Origin ej tillåten för denna nyckel' });
          }
        }
      } catch {
        // Felaktig JSON i allowed_origins — ignorera kontrollen
      }
    }

    // Bifoga nyckelmetadata till request
    // keyHash exponeras för HMAC-signaturverifiering (bgcheck)
    req.apiKey = {
      id: matchedKey.id,
      label: matchedKey.label,
      projectId: matchedKey.project_id,
      consumerType: matchedKey.consumer_type,
      rateLimit: matchedKey.rate_limit,
      keyHash: matchedKey.key_hash,
    };

    // Uppdatera last_used_at + räknare (icke-blockerande)
    pool.execute(
      'UPDATE api_keys SET last_used_at = NOW(), total_requests = total_requests + 1 WHERE id = ?',
      [matchedKey.id]
    ).catch(() => {});

    next();
  } catch (err) {
    console.error('  API-nyckelvalidering misslyckades:', err.message);
    return res.status(500).json({ error: 'Internt fel vid nyckelvalidering' });
  }
}

// --- Användningsloggning ---

/**
 * Express-middleware: Loggar API-användning till api_usage_log
 * Körs efter response (res.on('finish')) för att inte blockera.
 */
export function usageLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    // Logga bara autentiserade anrop
    if (!req.apiKey) return;

    const ms = Date.now() - start;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || '';
    const ua = (req.headers['user-agent'] || '').slice(0, 500);
    const path = req.path.slice(0, 500);

    pool.execute(
      'INSERT INTO api_usage_log (key_id, method, path, status_code, response_ms, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.apiKey.id, req.method, path, res.statusCode, ms, ip, ua]
    ).catch(() => {});
  });

  next();
}
