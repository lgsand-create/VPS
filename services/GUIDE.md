# Compuna Hub — Guide

Multi-projekt scraping, import och REST API-plattform.

## Översikt

Compuna Hub är en samlad Express-server som hanterar flera scraping-projekt med gemensam infrastruktur:

- **En server** — en port, ett PM2-process
- **En databas** (`compuna_hub`) — projektprefixade tabeller
- **Delad CRON-scheduler** — per-projekt schema och locks
- **Hub-dashboard** — översikt av alla projekt + detaljvyer

### Arkitektur

```
                             ┌─────────────────┐
                             │  Compuna Hub     │
                             │  (Express)       │
                             │                  │
    ┌────────────────────────┼──────────────────┤
    │ /api                   │  Hub-info        │
    │ /api/system/*          │  CRON-logg, hälsa│
    │ /api/minridskola/*     │  Kurser, ryttare │
    │ /api/laget/*           │  (framtida)      │
    └────────────────────────┼──────────────────┤
                             │  MariaDB         │
                             │  mrs_*, lgt_*    │
                             └─────────────────┘
```

## Snabbstart

```bash
cd services/

# 1. Installera dependencies
npm install

# 2. Konfigurera .env
cp .env.example .env
# Redigera .env med databasuppgifter och credentials

# 3. Kör migrations
npm run migrate

# 4. Starta servern
npm start

# 5. (Produktion) Kör med PM2
pm2 start server.js --name compuna-hub
```

## Mappstruktur

```
services/
├── server.js                     # Laddar alla projekt dynamiskt
├── package.json                  # name: "compuna-hub"
├── GUIDE.md                      # Denna fil
│
├── projects/                     # Projektregister
│   ├── index.js                  # getAllProjects(), getProject(id)
│   ├── _template.js              # Kopiera för nytt projekt
│   └── minridskola.js            # MinRidskola-konfiguration
│
├── routes/
│   ├── system.js                 # /api/system/* (scrape-log, projects, health)
│   └── {projektid}/              # /api/{projektid}/*
│       ├── index.js              # Mountar alla sub-routers
│       ├── courses.js            # Projektets API-routes
│       └── ...
│
├── import/
│   └── {projektid}.js            # JSON → MariaDB import-pipeline
│
├── cron/
│   └── scheduler.js              # Multi-projekt scheduler
│
├── db/
│   ├── connection.js             # Delad DB-pool
│   ├── migrate.js                # Migrationsrunner
│   └── migrations/               # SQL-migrationer (körs i ordning)
│
└── public/
    └── index.html                # Hub-dashboard
```

## Projekttyper

Compuna Hub stöder två mönster:

| Typ | Dataflöde | Exempel |
|-----|-----------|---------|
| `scrape` | CRON → Scraper → JSON → Import → DB | MinRidskola, Laget |
| `webhook` | Extern källa → POST `/api/{id}/ingest` → DB | LORA/Chirpstack |

**Scrape-projekt** har en scraper som körs periodiskt via CRON. Data sparas som JSON och importeras till DB.

**Webhook-projekt** tar emot data via HTTP POST direkt i en route. Ingen scraper eller import-pipeline behövs — datan skrivs direkt till DB i route-handlern.

---

## Lägg till scrape-projekt (steg för steg)

### 1. Skapa scraper

```
scrapers/{projektid}/
└── scrape.js          # Scraping-script med Playwright
```

Scrapern ska spara output till `data/{projektid}/` som JSON.

### 2. Registrera i projektregistret

Kopiera template:
```bash
cp services/projects/_template.js services/projects/{projektid}.js
```

Fyll i alla fält:
```js
export default {
  id: 'projektid',
  name: 'Visningsnamn',
  description: 'Kort beskrivning',
  color: '#10b981',            // Färg i dashboard
  tablePrefix: 'xxx',          // 3-bokstavs prefix för DB-tabeller
  type: 'scrape',              // 'scrape' eller 'webhook'

  // scraper.path resolvas från projekt-root (ovanför services/)
  // importer resolvas från services/
  scraper: {
    path: 'scrapers/projektid/scrape.js',
    dataDir: 'data/projektid',
  },
  importer: 'import/projektid.js',

  schedules: {
    daily: { cron: '0 6 * * *', args: '', label: 'Daglig (kl 06)' },
  },
};
```

Importera i `services/projects/index.js`:
```js
import projektid from './projektid.js';

const PROJECTS = {
  minridskola,
  projektid,       // Lägg till här
};
```

### 3. Skapa databasmigrering

```
services/db/migrations/00N_{projektid}_initial.sql
```

**Konvention:** Alla tabeller ska ha projektprefix:
```sql
-- Exempelvis för projekt med prefix "xxx":
CREATE TABLE IF NOT EXISTS xxx_articles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(500),
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Kör: `npm run migrate`

### 4. Bygg import-pipeline

```
services/import/{projektid}.js
```

Import-filen läser scrapad JSON och skriver till prefixade tabeller. Använd samma mönster som `import/minridskola.js`:
- Läs JSON från `data/{projektid}/`
- Normalisera format
- Upsert till DB med hash-baserad change detection
- Logga till `scrape_log` med `project = '{projektid}'`

### 5. Skapa API-routes

```
services/routes/{projektid}/
├── index.js          # Mountar alla sub-routers
├── articles.js       # GET /api/{projektid}/articles
└── stats.js          # GET /api/{projektid}/stats
```

**index.js** — Samlings-router:
```js
import { Router } from 'express';
import articlesRouter from './articles.js';
import statsRouter from './stats.js';

const router = Router();
router.use('/articles', articlesRouter);
router.use('/stats', statsRouter);

export default router;
```

Servern importerar routern automatiskt via `routes/{projektid}/index.js`.

### 6. Uppdatera dashboard (valfritt)

Lägg till endpoints i `public/index.html` under `PROJECT_ENDPOINTS`:
```js
const PROJECT_ENDPOINTS = {
  minridskola: [...],
  projektid: [
    { label: 'Artiklar', path: '/articles' },
    { label: 'Statistik', path: '/stats' },
  ],
};
```

### 7. Lägg till credentials i .env

```
# Projektid
PROJEKTID_USERNAME=...
PROJEKTID_PASSWORD=...
```

### 8. Testa

```bash
npm run migrate                          # Kör nya migrationer
node import/projektid.js latest          # Testa import
npm start                                # Starta servern
# Besök /api/projektid/stats
```

## Lägg till webhook-projekt (t.ex. LORA/Chirpstack)

Webhook-projekt tar emot data via POST istället för att scrapa. Hoppa över steg 1 (scraper) och 4 (import-pipeline) ovan.

### Projektkonfiguration

```js
export default {
  id: 'lora',
  name: 'LORA Sensorer',
  description: 'IoT-sensordata via Chirpstack',
  color: '#7c3aed',
  tablePrefix: 'lor',
  type: 'webhook',

  webhook: {
    secret: 'LORA_WEBHOOK_SECRET',  // Env-variabel
  },
  // Inget scraper, importer eller schedules
};
```

### Ingest-route

Skapa `routes/{id}/ingest.js` som tar emot POST:
```js
import { Router } from 'express';
import pool from '../../db/connection.js';

const router = Router();

// POST /api/lora/ingest — Ta emot sensordata
router.post('/', async (req, res) => {
  // Validera webhook-secret
  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.LORA_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Ogiltig webhook-secret' });
  }

  const { deviceName, data, timestamp } = req.body;
  await pool.execute(
    'INSERT INTO lor_readings (device, payload, received_at) VALUES (?, ?, ?)',
    [deviceName, JSON.stringify(data), timestamp]
  );

  res.json({ ok: true });
});

export default router;
```

Webhook-projekt har inget CRON-schema — schedulern hoppar automatiskt över dem.

---

## Konventioner

| Område | Konvention | Exempel |
|--------|-----------|---------|
| Tabellprefix | 3 bokstäver + underscore | `mrs_courses`, `lgt_articles` |
| Env-prefix | Versaler + underscore | `MRS_USERNAME`, `LGT_API_KEY` |
| API-URL | `/api/{projektid}/{resurs}` | `/api/minridskola/courses` |
| Responsformat | `{ data: [...], meta: { count } }` | Alla list-endpoints |
| Scrape-logg | project-kolumn i scrape_log | `project = 'minridskola'` |
| Filnamn | lowercase, bindestreck | `scrape-news.js` |
| Kommentarer | Svenska | `// Hämta senaste veckan` |
| Variabelnamn | Engelska | `const articles = [...]` |

## CRON-schema

Schemat definieras i projektets konfigurationsfil (`projects/{id}.js`). Schedulern startar automatiskt vid serverstart och skapar en lock per projekt för att undvika parallella körningar.

```js
schedules: {
  quick: { cron: '*/15 * * * *', args: '', label: 'Snabb' },
  full:  { cron: '0 3 1 * *', args: '--year', label: 'Fullscan' },
}
```

Pipeline per körning: **Scraper** (Node-script) → **Import** (JSON → DB) → **Logg** (scrape_log)

## Deploy

### Serverstruktur

Scrape-projekts sökvägar resolvas relativt till `services/`. Servern behöver ha:

```
/var/www/web-tests/            ← projekt-root
├── services/                  ← Express-server (cwd vid npm start)
│   ├── server.js
│   ├── projects/
│   ├── routes/
│   ├── import/
│   └── ...
├── scrapers/                  ← Scraper-scripts (utanför services!)
│   └── minridskola/
│       └── scrape.js
└── data/                      ← Scrapad output (utanför services!)
    └── minridskola/
```

`project.scraper.path` (t.ex. `scrapers/minridskola/scrape.js`) resolvas från projekt-root (`/var/www/web-tests/`).
`project.importer` (t.ex. `import/minridskola.js`) resolvas från `services/`.
Säkerställ att `scrapers/` och `data/` deployats till rätt relativ position.

### Deploy-steg

```bash
pm2 stop compuna-hub
# SFTP: services/, scrapers/, data/ till /var/www/web-tests/
cd /var/www/web-tests/services
npm run migrate
pm2 start compuna-hub

# Verifiera:
curl https://vpn.compuna.se/api
curl https://vpn.compuna.se/api/system/health
```

### Apache-konfiguration

```apache
# /etc/apache2/sites-available/compuna-hub.conf
<VirtualHost *:443>
    ServerName vpn.compuna.se
    SSLEngine on
    # ... SSL-cert ...
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
</VirtualHost>
```
