<?php
/**
 * Compuna Honeypot — placeras pa klientsajter pa vanliga probe-paths
 *
 * Placera denna fil som t.ex.:
 *   /wp-admin/index.php
 *   /wp-login.php
 *   /phpmyadmin/index.php
 *   /admin/login.php
 *   /administrator/index.php
 *   /.env (som PHP-fil med .htaccess rewrite)
 *
 * NAR FILEN TRAFFAS:
 *   1. Skickar tyst POST till Compuna Hub webhook
 *   2. Visar realistisk 404-sida (avsloja inte att det ar en honeypot)
 *
 * KONFIGURATION:
 *   Andra CANARY_TOKEN och WEBHOOK_URL nedan.
 */

// --- KONFIG (andras per sajt) ---
define('CANARY_TOKEN', 'BYTTILLDINTOKEN');
define('WEBHOOK_URL', 'https://DIN-VPS-URL/webhooks/canary');
// ---------------------------------

// Samla metadata
$data = [
    'token' => CANARY_TOKEN,
    'type'  => 'honeypot',
    'meta'  => [
        'ip'        => $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        'path'      => $_SERVER['REQUEST_URI'] ?? 'unknown',
        'method'    => $_SERVER['REQUEST_METHOD'] ?? 'unknown',
        'userAgent' => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown',
        'referer'   => $_SERVER['HTTP_REFERER'] ?? null,
        'host'      => $_SERVER['HTTP_HOST'] ?? 'unknown',
    ],
];

// Skicka tyst till Compuna Hub (fire-and-forget)
$ch = curl_init(WEBHOOK_URL);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($data),
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 3,
    CURLOPT_CONNECTTIMEOUT => 2,
]);
curl_exec($ch);
curl_close($ch);

// Visa realistisk 404
http_response_code(404);
?>
<!DOCTYPE html>
<html><head><title>404 Not Found</title></head>
<body>
<h1>Not Found</h1>
<p>The requested URL was not found on this server.</p>
</body></html>
