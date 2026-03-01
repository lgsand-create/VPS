/**
 * Monitor — Projektkonfiguration
 *
 * Uptime-kontroll och hälsobevakning av alla Compuna-sajter.
 * Typ: 'monitor' — kör egna scheman internt (inte scrape-pipeline).
 */

export default {
  id: 'monitor',
  name: 'Site Monitor',
  description: 'Uptime och hälsobevakning av alla Compuna-sajter',
  color: '#dc2626',
  tablePrefix: 'mon',
  type: 'monitor',

  // Sajter att bevaka (seedas till mon_sites vid start)
  sites: [
    {
      id: 'backatorpif',
      name: 'Backatorp IF Portal',
      url: 'https://portal.backatorpif.se',
      hosting: 'loopia',
      healthUrl: 'https://portal.backatorpif.se/api/health.php',
      healthSecretEnv: 'MON_BACKATORPIF_HEALTH_SECRET',
      checks: { http: true, ssl: true, health: true, deep: true, integrity: true, dns: true, headers: true, content: true },
      healthConfig: {
        admin_users: { table: 'admin_users', role_col: 'role', roles: ['admin', 'super_admin'] },
        watch_tables: ['members', 'admin_users', 'member_auth_log'],
      },
      ssh: {
        host: 'ssh.backatorpif.se',
        method: 'ssh',
        userEnv: 'MON_BIF_SSH_USER',
        keyEnv: 'MON_BIF_SSH_KEY',
        webroot: '/customers/b/a/backatorpif.se/httpd.www',
      },
    },
    {
      id: 'dev-backatorpif',
      name: 'Backatorp IF Dev',
      url: 'https://dev.backatorpif.se',
      hosting: 'loopia',
      healthUrl: 'https://dev.backatorpif.se/api/health.php',
      healthSecretEnv: 'MON_DEV_BACKATORPIF_HEALTH_SECRET',
      checks: { http: true, ssl: true, health: true, deep: true, integrity: true, dns: true, headers: true, content: true },
      healthConfig: {
        admin_users: { table: 'admin_users', role_col: 'role', roles: ['admin', 'super_admin'] },
        watch_tables: ['members', 'admin_users', 'member_auth_log'],
      },
      ssh: {
        host: 'ssh.loopia.se',
        method: 'ssh',
        userEnv: 'MON_BIF_SSH_USER',
        keyEnv: 'MON_BIF_SSH_KEY',
        webroot: '/customers/b/a/backatorpif.se/dev.backatorpif.se',
      },
    },
    {
      id: 'equicard',
      name: 'EQUICARD',
      url: 'https://equicard.se',
      hosting: 'loopia',
      healthUrl: 'https://equicard.se/api/health.php',
      healthSecretEnv: 'MON_EQUICARD_HEALTH_SECRET',
      checks: { http: true, ssl: true, health: true, deep: false, integrity: true, dns: true, headers: true, content: true },
      // healthConfig: anpassas nar equicard deployar health.php
      ssh: {
        host: 'ssh.equicard.se',
        method: 'ssh',
        userEnv: 'MON_EQ_SSH_USER',
        keyEnv: 'MON_EQ_SSH_KEY',
        webroot: '/customers/e/q/equicard.se/httpd.www',
      },
    },
    {
      id: 'stalladams',
      name: 'Stall Adams RF',
      url: 'https://new.stalladamsrf.se',
      hosting: 'one.com',
      healthUrl: 'https://new.stalladamsrf.se/api/health.php',
      healthSecretEnv: 'MON_STALLADAMS_HEALTH_SECRET',
      checks: { http: true, ssl: true, health: true, deep: true, integrity: true, dns: true, headers: true, content: true },
      acceptedStatuses: [200, 302, 403],
      healthConfig: {
        admin_users: { table: 'admin_users', role_col: 'is_active', roles: ['1'], expected: 3 },
        watch_tables: ['members', 'admin_users', 'member_auth_log', 'member_sessions', 'admin_audit_log'],
      },
      ssh: {
        host: 'ssh.stalladamsrf.se',
        method: 'sftp',
        userEnv: 'MON_STALLADAMS_SSH_USER',
        passwordEnv: 'MON_STALLADAMS_SSH_PASS',
        webroot: '/new.stalladamsrf.se',
      },
    },
  ],

  // Check-intervall (node-cron uttryck)
  intervals: {
    fast: '* * * * *',            // Var minut: HTTP + health
    ssl: '0 */6 * * *',          // Var 6:e timme: SSL-certifikat
    deep: '*/5 * * * *',         // Var 5:e minut: Playwright
    integrity: '0 */6 * * *',    // Var 6:e timme: filintegritet via SSH
    dns: '0 * * * *',            // Varje timme: DNS-upplösning
    rollup: '5 0 * * *',         // 00:05: daglig metrics-aggregering
    cleanup: '10 0 * * *',       // 00:10: radera >30 dagar gamla checks
  },

  // Tystare period — reducerad frekvens nattetid (som minridskola)
  quietPeriod: {
    startHour: 23,                // Tyst period börjar 23:00
    endHour: 6,                   // Tyst period slutar 06:00
    multiplier: 5,                // Intervall x5 under tyst period
  },

  // Larm-konfiguration
  alerting: {
    consecutiveFailuresBeforeAlert: 3,
    channels: ['console', 'email'],
    maxAlertsPerHourPerSite: 10,
    emailRecipients: 'MON_EMAIL_RECIPIENTS',
    smtpHost: 'MON_SMTP_HOST',
    smtpPort: 'MON_SMTP_PORT',
    smtpUser: 'MON_SMTP_USER',
    smtpPass: 'MON_SMTP_PASS',
    smtpFrom: 'MON_SMTP_FROM',
  },

  // Maskiner att bevaka (seedas till mon_machines vid start)
  machines: [
    {
      id: 'vps',
      name: 'VPS (HostUp)',
      host: 'localhost',
      description: 'Apache, Express/PM2, WireGuard',
      collectMethod: 'local',
      services: ['apache2', 'pm2-root', 'wg-quick@cmp-wg0'],
      diskPaths: ['/', '/var'],
      interval: 2,
    },
    {
      id: 'cmp-prox01',
      name: 'cmp-prox01 (Proxmox)',
      host: '10.10.10.1',
      description: 'Proxmox host, gateway',
      collectMethod: 'ssh',
      sshKeyEnv: 'MON_PROX_SSH_KEY',
      services: ['pvedaemon', 'pveproxy'],
      diskPaths: ['/', '/mnt/storage'],
      interval: 2,
    },
    {
      id: 'cmp-web01',
      name: 'cmp-web01 (Web)',
      host: '10.10.10.100',
      description: 'Nginx, PHP, MariaDB',
      collectMethod: 'ssh',
      sshKeyEnv: 'MON_PROX_SSH_KEY',
      services: ['nginx', 'php8.2-fpm', 'mariadb'],
      diskPaths: ['/'],
      interval: 2,
    },
    {
      id: 'cmp-files01',
      name: 'cmp-files01 (Lagring)',
      host: '10.10.10.101',
      description: '3.6 TB fillagring',
      collectMethod: 'ssh',
      sshKeyEnv: 'MON_PROX_SSH_KEY',
      services: ['smbd'],
      diskPaths: ['/', '/mnt/storage'],
      interval: 5,
    },
    {
      id: 'cmp-vpn01',
      name: 'cmp-vpn01 (VPN)',
      host: '10.10.10.103',
      description: 'WireGuard endpoint',
      collectMethod: 'ssh',
      sshKeyEnv: 'MON_PROX_SSH_KEY',
      services: ['wg-quick@cmp-wg0'],
      diskPaths: ['/'],
      interval: 2,
    },
    {
      id: 'cmp-yolo01',
      name: 'cmp-yolo01 (GPU)',
      host: '10.10.10.104',
      description: 'GPU (5060 Ti), Ollama',
      collectMethod: 'ssh',
      sshKeyEnv: 'MON_PROX_SSH_KEY',
      checkGpu: true,
      services: ['ollama'],
      diskPaths: ['/'],
      interval: 5,
    },
    {
      id: 'cmp-lorawan01',
      name: 'cmp-lorawan01 (LoRa)',
      host: '10.10.10.105',
      description: 'ChirpStack, MQTT, PostgreSQL',
      collectMethod: 'ssh',
      sshKeyEnv: 'MON_PROX_SSH_KEY',
      services: ['chirpstack', 'mosquitto', 'postgresql'],
      diskPaths: ['/'],
      interval: 5,
    },
  ],

  statsEndpoint: '/sites',
};
