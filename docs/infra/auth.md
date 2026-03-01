# Autentisering och nycklar

## Oversikt

Tre separata auth-lager i plattformen:

| Lager | Vem | Hur |
|-------|-----|-----|
| Hub dashboard | Jonas (webblasare) | Cookie-session (same-origin bypass) |
| Externa appar --> Hub | Coach-app, mobilapp | `chub_...` API-nyckel (SHA-256, DB) |
| Hub proxy --> Backend | Express-proxy (automatiskt) | `X-API-KEY: cmp-api-2026-backatorp` |

## 1. Hub Dashboard (same-origin)

Nar du navigerar dashboarden pa vpn.compuna.se behovs **ingen API-nyckel**.
Middlewaren (`apikey.js`) kollar om Referer-headern matchar Host-headern.
Om de matchar: bypass -- request gar vidare utan nyckelvalidering.

```javascript
// middleware/apikey.js
const referer = req.headers.referer || '';
const host = req.headers.host || '';
if (new URL(referer).host === host) return next();
```

Dashboarden skyddas istallet av:
- Apache Basic Auth (vpn.compuna.se)
- VPN-grans (bara tillganglig via VPN)

## 2. Externa appar (Hub API-nycklar)

Appar pa andra domaner (t.ex. coach-appen pa dev.backatorpif.se) behover en `chub_...`-nyckel.

### Skapa nyckel

Via dashboarden: **Verktyg --> API-nycklar --> Valj projekt --> Skapa**

Eller via API:

```bash
curl -X POST http://localhost:3000/api/system/keys \
  -H "Content-Type: application/json" \
  -H "Referer: http://localhost:3000/" \
  -d '{"label":"Coach App","project_id":"sportanalys","consumer_type":"web"}'
```

### Anvanda nyckel

```bash
# Header (rekommenderat)
curl -H "X-API-Key: chub_..." https://vpn.compuna.se/api/sportanalys/jobs

# Query parameter (for <video> element etc.)
curl "https://vpn.compuna.se/api/sportanalys/jobs/1/video?api_key=chub_..."
```

### Nyckelformat

- Prefix: `chub_` (5 tecken)
- Random: 43 tecken (base64url, 256 bitar)
- Total: 48 tecken
- Lagring: bara SHA-256 hash + prefix (12 tecken) sparas i DB
- Nyckeln visas **bara en gang** vid skapande

### Databas

```sql
-- api_keys
id, label, key_prefix (12 char), key_hash (SHA-256),
project_id (FK --> projects), consumer_type, rate_limit,
allowed_origins, expires_at, revoked, total_requests, last_used_at
```

## 3. Hub --> Backend (intern)

Express-proxyn lagger automatiskt till `X-API-KEY: cmp-api-2026-backatorp`
pa alla requests som vidarebefordras till cmp-web01 (10.10.10.100).

```javascript
// routes/sportanalys/index.js -- buildProxyHeaders()
headers['X-API-KEY'] = API_KEY;
```

Denna nyckel ar hardkodad i Express (env: `SA_API_KEY`) och i backend-PHP:en.
Den passerar aldrig genom browsern.

## 4. Proxmox / SSH

| System | Anvandare | Metod |
|--------|-----------|-------|
| Proxmox GUI | root | https://192.168.1.250:8006 |
| VPS SSH | root | PuTTY, port 22 |
| cmp-yolo01 SSH | jonas | `ssh jonas@10.10.10.104` (fran Proxmox) |
| MariaDB (cmp-web01) | sportanalys | `cmp-sa-2026!` (databas: compuna_sportanalys) |

## 5. Apache Basic Auth (VPS)

vpn.compuna.se skyddas med HTTP Basic Auth:

```
AuthUserFile /etc/apache2/.htpasswd
```

Hantera anvandare:
```bash
htpasswd /etc/apache2/.htpasswd <anvandare>
```

## Video-access for coach-app

`<video>` element kan inte skicka custom headers. Losning: query parameter.

```html
<video src="https://vpn.compuna.se/api/sportanalys/jobs/1/video?api_key=chub_...">
```

Hub-middlewaren laser nyckeln fran bade header och query:
```javascript
const key = req.headers['x-api-key'] || req.query.api_key;
```
