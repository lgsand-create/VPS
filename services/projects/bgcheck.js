/**
 * Bakgrundskontroll — Projektkonfiguration
 *
 * Verifierar belastningsregisterutdrag mot Polisens kontrolltjänst
 * via Playwright. Tar emot 4 fält (parsade ur PDF av sändande system),
 * returnerar verifikationsintyg från polisen.
 *
 * Typ: 'service' — on-demand request/response (varken scrape eller webhook).
 *
 * Säkerhetslager:
 *   1. API-nyckel       → autentisering + rate limiting + loggning (befintligt system)
 *   2. HMAC-signatur    → payload-integritet + replay-skydd
 *   3. IP-begränsning   → bara localhost
 *   4. Kö               → max 1 Playwright-session åt gången
 */

export default {
  id: 'bgcheck',
  name: 'Bakgrundskontroll',
  description: 'Verifiering av belastningsregisterutdrag via Polisen',
  color: '#7c3aed',
  tablePrefix: 'bgc',
  type: 'service',

  // HMAC: Signeringsnyckeln härleds från API-nyckeln (SHA-256).
  // Ingen separat hemlighet behövs.

  // Playwright-kö
  queue: {
    maxLength: 10,
    timeoutMs: 60_000,
  },

  // Striktare rate limit — rekommenderat vid nyckelgenerering
  recommendedRateLimit: 10,

  statsEndpoint: '/status',
};
