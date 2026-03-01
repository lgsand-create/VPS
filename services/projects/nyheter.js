/**
 * Nyheter — Projektkonfiguration
 *
 * Nyhetsartiklar från Backatorp IF:s hemsida (www.backatorpif.se / laget.se).
 * Scrapar rubrik, datum, text, visningar, kommentarer, bilder.
 */

export default {
  id: 'nyheter',
  name: 'Nyheter',
  description: 'Nyhetsartiklar från Backatorp IF (backatorpif.se)',
  color: '#f59e0b',
  tablePrefix: 'nyh',
  type: 'scrape',

  scraper: {
    path: 'scrapers/laget/news.js',
    dataDir: 'data/nyheter',
  },

  importer: 'import/nyheter.js',

  schedules: {
    daily: {
      cron: '0 7 * * *',
      args: '',
      label: 'Daglig (kl 07)',
    },
  },

  statsEndpoint: '/stats',
};
