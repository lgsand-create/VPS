/**
 * PM2 Ecosystem Config — Compuna Hub
 *
 * Användning:
 *   pm2 start ecosystem.config.cjs
 *   pm2 restart compuna-hub
 *   pm2 logs compuna-hub
 *
 * Watch-läge: Startar automatiskt om vid filändringar (t.ex. efter SFTP-upload).
 * Ignorerar node_modules, data, loggar etc.
 */

module.exports = {
  apps: [{
    name: 'compuna-hub',
    script: 'server.js',
    cwd: '/var/www/web-tests/services',

    // Auto-restart vid filändringar (efter SFTP-upload)
    watch: [
      'server.js',
      'routes',
      'cron',
      'monitor',
      'projects',
      'middleware',
      'import',
      'db',
      'public',
    ],
    watch_delay: 2000,       // Vänta 2s efter senaste ändring (SFTP laddar filer sekventiellt)
    ignore_watch: [
      'node_modules',
      '*.log',
      'public/screenshots',
      'public/screenshots/**',
      'data',
    ],

    // Miljö
    node_args: '--experimental-vm-modules',
    env: {
      NODE_ENV: 'production',
    },

    // Restart-policy
    max_restarts: 10,         // Max 10 restarter inom window
    restart_delay: 3000,      // 3s mellan restarter
    max_memory_restart: '256M',

    // Loggning
    error_file: '/root/.pm2/logs/compuna-hub-error.log',
    out_file: '/root/.pm2/logs/compuna-hub-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',

    // Graceful shutdown
    kill_timeout: 10000,      // 10s för graceful shutdown
    listen_timeout: 8000,     // 8s för startup
  }],
};
