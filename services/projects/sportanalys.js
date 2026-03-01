/**
 * Sportanalys — Videoanalys av matcher
 *
 * Extern tjänst: Backend-API körs på cmp-web01 (10.10.10.100).
 * Hub-routes proxar alla anrop till backend och lägger till X-API-KEY.
 */

export default {
  id: 'sportanalys',
  name: 'Sportanalys',
  description: 'Videoanalys av matcher — upload, bearbetning och resultat',
  color: '#e74c3c',
  tablePrefix: 'sa',
  type: 'external',

  // Extern backend (nås via WireGuard-tunnel)
  backend: {
    baseUrl: 'http://10.10.10.100',
    apiPath: '/api',
    timeout: 600_000, // 10 min (stora uploads)
  },

  statsEndpoint: '/stats',
};
