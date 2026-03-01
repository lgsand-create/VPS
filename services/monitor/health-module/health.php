<?php
/**
 * Compuna Monitor — Health Endpoint (referensdokument)
 *
 * OBS: Den faktiska implementationen finns pa varje sajt och hanteras
 * av sajtens egen kodbas. Denna fil ar en referens for formatet.
 *
 * Faktisk arkitektur (implementerad pa backatorpif):
 *   - Standalone fil: public_html/api/health.php (utanfor ramverket)
 *   - Config lagras i tf_health_config-tabellen (1 rad, id=1)
 *   - monitor_secret krypteras med AES-256-CBC
 *   - DB-creds lases fran sajtens src/Config/config.php
 *   - Monitorn skickar POST med JSON-body for extra checks
 *   - Admin-UI pa /admin/site-health for att konfigurera
 *
 * Filer per sajt:
 *   public_html/api/health.php               — Standalone endpoint
 *   src/Services/HealthConfigService.php      — Krypterar/dekrypterar secret
 *   src/Controllers/Admin/SiteHealthController.php — Admin-sida
 *   src/Views/admin/site-health/index.php     — Admin-vy
 *   src/Config/routes.php                     — 3 routes (site_health modul)
 *   migrations/012_site_health_module.sql     — Registrerar modulen
 *   migrations/013_health_config.sql          — Skapar tf_health_config
 *
 * Sakerhet:
 *   1. is_enabled = 0 → endpoint returnerar 404 (helt osynlig)
 *   2. IP-whitelist (VPS:ens IP) i allowed_ips-kolumnen
 *   3. Header-auth (X-Monitor-Key) — aldrig query param
 *   4. hash_equals() for nyckel-jamforelse
 *   5. 404-svar pa allt felaktigt (avslojar inte att endpointen finns)
 *   6. Tabellnamn saniteras: preg_replace('/[^a-zA-Z0-9_]/')
 *   7. Rollvarden: prepared statements med ? placeholders
 *   8. $tablePrefix laggs till automatiskt pa alla tabellnamn
 *
 * Monitorn skickar POST med:
 *   Header: X-Monitor-Key: <nyckeln>
 *   Header: Content-Type: application/json
 *   Body: {
 *     "admin_users": {
 *       "table": "admin_users",
 *       "role_col": "role",
 *       "roles": ["admin", "super_admin"],
 *       "expected": 2
 *     },
 *     "watch_tables": ["members", "admin_users", "member_auth_log"]
 *   }
 *
 * OBS: Tabellnamn i POST-body ar UTAN prefix.
 * PHP-sidan lagger till $tablePrefix (t.ex. tf_) automatiskt.
 *
 * Forvantad respons:
 *   {
 *     "status": "ok|warning|critical",
 *     "timestamp": "2026-02-10T22:15:00+01:00",
 *     "checks": {
 *       "database":         { "status": "ok", "latency_ms": 3 },
 *       "disk":             { "status": "ok", "used_pct": 42.1, "free_gb": 15.2 },
 *       "writable":         { "status": "ok", "tmp": true },
 *       "error_log":        { "status": "ok", "size_mb": 1.5 },
 *       "failed_logins_1h": { "status": "ok", "count": 0 },
 *       "admin_users":      { "status": "ok", "count": 2, "expected": 2 },
 *       "table_rows":       { "status": "ok", "counts": { "members": 450, "admin_users": 2 } },
 *       "php":              { "status": "ok", "version": "8.2.15" }
 *     }
 *   }
 *
 * Checks:
 *   #1 database         — SELECT 1 med hrtime(), critical om PDO kastar
 *   #2 disk             — disk_free_space(), warning >=80%, critical >=90%
 *   #3 writable         — is_writable(sys_get_temp_dir()), warning om false
 *   #4 error_log        — filesize(logs/error_log.txt), warning >=50 MB
 *   #5 failed_logins_1h — COUNT(*) fran tf_member_auth_log senaste timmen, warning >=20
 *   #6 admin_users      — POST: raknar admin-roller, critical om count > expected
 *   #7 table_rows       — POST: COUNT(*) per tabell, monitorn sparar historik
 *   #8 php              — phpversion(), aldrig larm (informativ)
 *
 * Deploy per sajt:
 *   1. Kor migrationerna (012 + 013)
 *   2. Kopiera filerna (health.php, Service, Controller, View, routes)
 *   3. Ga till Admin → Sajt Halsa
 *   4. Aktivera endpointen, ange VPS-IP, generera nyckel
 *   5. Lagg nyckeln i VPS:ens .env som MON_{SITE}_HEALTH_SECRET
 *   6. Anpassa healthConfig i services/projects/monitor.js
 */

// Faktisk implementation finns i varje sajts kodbas.
// Se backatorpif: src/Controllers/SiteHealthController.php + api/health.php
