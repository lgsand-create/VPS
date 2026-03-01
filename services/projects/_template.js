/**
 * TEMPLATE — Kopiera denna fil för nytt projekt.
 *
 * Steg:
 *   1. Kopiera till services/projects/{id}.js
 *   2. Fyll i alla fält
 *   3. Importera i services/projects/index.js
 *   4. Skapa routes, migration och (scraper eller webhook-route)
 *   5. Se GUIDE.md för fullständig instruktion
 *
 * Två projekttyper stöds:
 *   - 'scrape'  → CRON-driven: scraper → import → DB
 *   - 'webhook' → Tar emot data via POST (t.ex. Chirpstack LORA)
 */

export default {
  id: 'projektid',
  name: 'Projektnamn',
  description: 'Kort beskrivning',
  color: '#10b981',
  tablePrefix: 'xxx',
  type: 'scrape',                // 'scrape' eller 'webhook'

  // --- Scrape-projekt (type: 'scrape') ---
  // scraper.path resolvas från projekt-root (ovanför services/)
  // importer resolvas från services/
  scraper: {
    path: 'scrapers/projektid/scrape.js',
    dataDir: 'data/projektid',
  },
  importer: 'import/projektid.js',
  schedules: {
    // daily: { cron: '0 6 * * *', args: '', label: 'Daglig (kl 06)' },
  },

  // --- Webhook-projekt (type: 'webhook') ---
  // Inget scraper/importer-fält behövs.
  // Data tas emot via POST i routes/{projektid}/ingest.js
  // webhook: {
  //   secret: 'PROJEKTID_WEBHOOK_SECRET',   // Env-variabel för att validera avsändare
  // },

  statsEndpoint: '/stats',
};
