/**
 * Västtrafik — Realtidsavgångar och förseningsstatistik
 *
 * Pollar Västtrafiks API (Planera Resa v4) varje minut för konfigurerade
 * hållplatser. Sparar avgångar i DB för statistik och serverar till PWA.
 */

export default {
  id: 'vasttrafik',
  name: 'Västtrafik',
  description: 'Realtidsavgångar, förseningsstatistik och push-notiser',
  color: '#0074be',
  tablePrefix: 'vt',
  type: 'poll',

  // Pollingintervall (cron-uttryck, Europe/Stockholm)
  intervals: {
    departures: '* * * * *',           // Varje minut
    liveRollup: '*/15 * * * *',        // Var 15:e min — löpande statistik för idag
    rollup: '5 0 * * *',               // 00:05 — slutgiltig aggregering av igår
    cleanup: '15 0 * * *',             // 00:15 — radera avgångar äldre än retention_days
    subscriptionCleanup: '0 3 * * 0',  // Söndag 03:00 — rensa misslyckade push-prenumerationer
  },

  // Västtrafik API (Planera Resa v4)
  api: {
    tokenUrl: 'https://ext-api.vasttrafik.se/token',
    baseUrl: 'https://ext-api.vasttrafik.se/pr/v4',
    cacheTtlMs: 60_000,
  },

  statsEndpoint: '/stats',
};
