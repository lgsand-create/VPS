/**
 * Laget.se — Projektkonfiguration
 *
 * Aktiviteter och närvaro för Backatorp IF:s fotbollslag (laget.se).
 * Scrapar kalenderaktiviteter, deltagarlista, LOK-status.
 */

export default {
  id: 'laget',
  name: 'Laget.se Närvaro',
  description: 'Aktiviteter och närvaro för Backatorp IF (laget.se)',
  color: '#059669',
  tablePrefix: 'lag',
  type: 'scrape',
  teamTable: 'lag_teams',       // tabell med id + aktiv — scheduler filtrerar --team

  scraper: {
    path: 'scrapers/laget/activities.js',
    dataDir: 'data/laget',
  },

  importer: 'import/laget.js',

  schedules: {
    rolling: {
      cron: '0 6,12,18 * * *',
      args: '--days 3',
      label: 'Rullande fönster (3 ggr/dag)',
    },
    full: {
      cron: '0 2 1 * *',
      args: '--year',
      label: 'Komplett år (månatlig)',
    },
  },

  statsEndpoint: '/stats',
};
