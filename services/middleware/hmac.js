/**
 * HMAC-middleware — payload-integritet för server-till-server-anrop
 *
 * Använder API-nyckelns SHA-256-hash som HMAC-hemlighet.
 * Ingen separat hemlighet behövs — båda sidor härleder den från API-nyckeln:
 *
 *   Portal:  $hmacKey = hash('sha256', $apiKey);
 *   Hub:     hmacKey  = req.apiKey.keyHash;  (redan beräknad vid nyckelvalidering)
 *
 * Protokoll:
 *   X-Timestamp: <unix-sekunder>
 *   X-Signature: HMAC-SHA256("${timestamp}.${rawBody}", SHA256(apiKey))  → hex
 *
 * Kräver:
 *   - req.rawBody (sätts av express.json({ verify }) i server.js)
 *   - req.apiKey.keyHash (sätts av validateApiKey middleware)
 *
 * PHP-exempel:
 *   $hmacKey   = hash('sha256', $apiKey);         // API-nyckelns hash
 *   $payload   = json_encode($fields);
 *   $timestamp = time();
 *   $signature = hash_hmac('sha256', "$timestamp.$payload", $hmacKey);
 */

import { createHmac, timingSafeEqual } from 'crypto';

const TIMESTAMP_TOLERANCE_SECONDS = 60;

/**
 * Express-middleware: Verifierar HMAC-signatur med API-nyckelns hash.
 * Måste monteras EFTER validateApiKey.
 */
export function verifyHmac(req, res, next) {
  // API-nyckeln måste redan vara validerad
  const keyHash = req.apiKey?.keyHash;
  if (!keyHash) {
    return res.status(500).json({ error: 'HMAC: API-nyckel ej validerad' });
  }

  const timestamp = req.headers['x-timestamp'];
  const signature = req.headers['x-signature'];

  if (!timestamp || !signature) {
    return res.status(401).json({
      error: 'Signatur saknas',
      required: ['X-Timestamp', 'X-Signature'],
    });
  }

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) {
    return res.status(401).json({ error: 'Ogiltigt X-Timestamp-format' });
  }

  // Tidsfönster: max 60s gammalt, max 5s framåt (klockdrift)
  const now = Math.floor(Date.now() / 1000);
  const age = now - ts;
  if (age > TIMESTAMP_TOLERANCE_SECONDS || age < -5) {
    return res.status(401).json({
      error: 'Signatur har gått ut',
      age,
      tolerance: TIMESTAMP_TOLERANCE_SECONDS,
    });
  }

  // rawBody sätts av express.json({ verify }) i server.js
  const rawBody = req.rawBody ?? '';

  const signingString = `${timestamp}.${rawBody}`;
  const expected = createHmac('sha256', keyHash)
    .update(signingString)
    .digest('hex');

  // Timing-safe jämförelse
  let match = false;
  try {
    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length === receivedBuf.length) {
      match = timingSafeEqual(expectedBuf, receivedBuf);
    }
  } catch {
    match = false;
  }

  if (!match) {
    return res.status(401).json({ error: 'Ogiltig signatur' });
  }

  // Rensa rawBody — innehåller potentiellt personnummer
  req.rawBody = null;

  next();
}
