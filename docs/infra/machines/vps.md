# VPS -- vpn.compuna.se

| Egenskap | Varde |
|----------|-------|
| Leverantor | HostUp |
| Publik IP | 64.112.124.118 |
| WireGuard IP | 10.0.0.1 |
| OS | Ubuntu 24.04 LTS |
| DNS | vpn.compuna.se (DNS-only), api.compuna.se (Proxied) |
| SSL | Let's Encrypt (vpn), Cloudflare Origin (api) |

## Installerade paket

```
apache2                 # 2.4.58 -- SSL termination, reverse proxy
nodejs                  # Express runtime
npm                     # Pakethanterare
pm2                     # Process manager (compuna-hub)
wireguard               # VPN-tunnel
certbot                 # SSL-certifikat
python3-certbot-apache  # Apache-plugin
ufw                     # Brandvagg
htpasswd (apache2-utils)# HTTP Basic Auth
playwright              # Headless browser (scraping)
```

## Apache-moduler

```
proxy proxy_http headers ssl rewrite
```

## Tjanster

| Tjanst | Port | Beskrivning |
|--------|------|-------------|
| Apache | 443, 80 | SSL termination, ProxyPass till Express |
| Compuna Hub (pm2) | 3000 | Express SPA + API-router |
| WireGuard | 51820/udp | Tunnel till hemmaserver |

## Compuna Hub (Express)

**Sokvag:** `/var/www/web-tests/services/`

```
server.js                          # Entry point, middleware
routes/sportanalys/index.js        # Streaming proxy --> 10.10.10.100
routes/monitor/                    # Sajthalsaroutes/minridskola/                # Scraping kursbokningar
routes/laget/                      # Scraping lagdata
routes/vasttrafik/                 # Realtidsavgangar
routes/nyheter/                    # Nyhetsaggregering
routes/bgcheck/                    # Bakgrundskontroller
projects/sportanalys.js            # Projektdefinition (type: external)
projects/index.js                  # Projektregister
middleware/apikey.js                # API-nyckelvalidering (SHA-256, DB)
middleware/ratelimit.js             # Rate limiting per API-nyckel
middleware/dashauth.js              # Cookie-sessions for dashboard
middleware/hmac.js                  # HMAC-signaturverifiering (bgcheck)
public/                            # Dashboard SPA (index.html, js/, css/)
cron/scheduler.js                  # CRON-schemalagda jobb
db/migrations/                     # MariaDB-migrationer
```

**Databas:** MariaDB (pa VPS)

```
Tabell: projects       -- id, name, description
Tabell: api_keys       -- SHA-256 hash, prefix (chub_...), FK --> projects
Tabell: sessions       -- cookie-sessions
+ alla projekt-specifika tabeller (mrs_, mon_, vt_, etc.)
```

## Apache vhost

**Fil:** `/etc/apache2/sites-available/test-reports-le-ssl.conf`

```apache
<VirtualHost *:443>
    ServerName vpn.compuna.se
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/vpn.compuna.se/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/vpn.compuna.se/privkey.pem

    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/

    DocumentRoot /root/web-tests
    AuthType Basic
    AuthName "Compuna"
    AuthUserFile /etc/apache2/.htpasswd
    Require valid-user
</VirtualHost>
```

## Sportanalys proxy-flode

```
Browser POST /api/sportanalys/upload
  --> express.json() BYPASS (explicit check i server.js rad 37-42)
  --> validateApiKey (chub_... nyckel, eller same-origin bypass)
  --> sportanalys router
  --> req.pipe(proxyReq) --> http://10.10.10.100/api/upload
  --> Lagger till X-API-KEY: cmp-api-2026-backatorp automatiskt
```

### Proxy-routes (vidarebefordras till backend)

```
GET  /health, /jobs, /jobs/:id/status, /jobs/:id/result,
     /jobs/:id/video, /jobs/:id/tracking, /jobs/:id/stats,
     /jobs/:id/players, /annotations/:id
POST /upload, /annotations/:id
PUT  /annotations/:id
```

### Hub-only routes (kors pa VPS, nar inte backend)

```
GET /stats        -- Aggregerar jobbstatus for dashboard-kortet
GET /diagnostics  -- TCP-test + health + jobs (felsokningsverktyg)
```

## WireGuard-config

**Fil:** `/etc/wireguard/cmp-wg0.conf`

```ini
[Interface]
Address = 10.0.0.1/24
ListenPort = 51820
PrivateKey = <VPS_PRIVATE_KEY>

[Peer]
PublicKey = <HOME_PUBLIC_KEY>
AllowedIPs = 10.0.0.2/32, 10.10.10.0/24
```

## Routing

```
10.10.10.0/24 via 10.0.0.2 dev wg0
```

## Vanliga kommandon

```bash
pm2 restart compuna-hub          # Starta om Express
pm2 logs compuna-hub --lines 50  # Visa loggar
pm2 status                       # Status
cd /var/www/web-tests/services && npm run migrate  # Kor DB-migrering
```
