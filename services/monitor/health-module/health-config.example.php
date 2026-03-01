<?php
/**
 * Compuna Monitor — Lokal konfiguration
 *
 * Kopiera till health-config.php och fyll i varje sajts uppgifter.
 * Denna fil ska INTE versionshanteras (lagg till i .gitignore pa servern).
 */

return [
    // Hemlig nyckel — maste matcha MON_*_HEALTH_SECRET pa VPS:en
    'secret' => 'CHANGE_ME_BEFORE_DEPLOY',

    // IP-whitelist — VPS:ens IP (kommaseparerade, tomt = ingen whitelist)
    'allowed_ips' => '',

    // Databas — anpassa per sajt
    'db_host' => 'localhost',
    'db_name' => '',
    'db_user' => '',
    'db_pass' => '',
];
