/**
 * MinRidskola — Projektkonfiguration
 *
 * Ridskolehantering för Stall Adams RF (minridskola.se).
 * Scrapar närvaro, avbokningar och hästtilldelning.
 */

export default {
  id: 'minridskola',
  name: 'MinRidskola',
  description: 'Ridskolehantering för Stall Adams RF',
  color: '#2563eb',
  tablePrefix: 'mrs',
  type: 'scrape',               // 'scrape' = CRON-driven pipeline, 'webhook' = tar emot data via POST

  scraper: {
    path: 'scrapers/minridskola/scrape.js',
    dataDir: 'data/minridskola',
  },

  importer: 'import/minridskola.js',

  schedules: {
    quick: { cron: '*/15 5-22 * * *;0 23,1,3 * * *', args: '', label: 'Snabb (var 15 min dag, var 2h natt)' },
    full: { cron: '0 3 1 * *', args: '--year', label: 'Fullscan (månatlig)' },
    horses: {
      cron: '0 4 * * *',
      args: '',
      label: 'Hästindex (daglig)',
      scraper: 'scrapers/minridskola/scrape-hastar.js',
      importer: 'import/minridskola-horses.js',
    },
  },

  // Stats-endpoint (relativt till projektets API-bas)
  statsEndpoint: '/stats',
};
