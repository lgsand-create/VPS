# CLAUDE.md – Projektkontext för AI-agenter

## Vad är detta?

Modulärt Playwright-projekt för automatiserad testning och scraping av flera webbaserade system. Ägs och utvecklas av Jonas på Compuna AB.

## Tech stack

- **Runtime:** Node.js (ESM – alla filer använder `import/export`, `"type": "module"` i package.json)
- **Testramverk:** Playwright Test (`@playwright/test`)
- **Scraping:** Playwright (inte Playwright Test – körs som vanliga Node-scripts)
- **Env-hantering:** dotenv
- **Browser:** Chromium (installerat via `npx playwright install chromium`)

## Installerade beroenden

```
@playwright/test  ^1.49.0   – Testramverk med runner, expect, reporter
playwright         ^1.49.0   – Browser automation (används av scrapers)
dotenv             ^16.4.0   – Läser .env-filer
```

## Projektstruktur

```
playwright-project/
├── sites/                     ← CENTRALT: En config-fil per system
│   ├── index.js               ← Registry + getActiveSite()
│   ├── backatorpif.js         ← Backatorp IF portal (aktiv)
│   └── _template.js           ← Kopiera för nytt system
│
├── tests/                     ← Playwright Test-filer
│   ├── helpers/
│   │   ├── auth.js            ← Generisk login/logout (site-agnostisk)
│   │   └── assertions.js      ← assertPageLoads, collectJsErrors, overflow
│   ├── global-setup.js        ← Loggar in + sparar session till .auth/
│   ├── admin/                 ← Admin-paneltester
│   │   ├── auth.spec.js       ← Login, skydd, utloggning
│   │   ├── pages.spec.js      ← Smoke-test ~120 routes
│   │   ├── js-errors.spec.js  ← JS-konsolfel på kritiska sidor
│   │   └── responsive.spec.js ← Mobilvy 375px
│   ├── public/                ← (tomt – framtida publika tester)
│   └── api/                   ← (tomt – framtida API-tester)
│
├── scrapers/                  ← Fristående scraping-scripts
│   ├── helpers/
│   │   ├── browser.js         ← createBrowser(), createAuthenticatedPage()
│   │   ├── storage.js         ← saveJson(), saveCsv() → data/
│   │   └── retry.js           ← withRetry(), createRateLimiter()
│   ├── example.js             ← Exempelscraper som visar mönstret
│   ├── fogis/                 ← (tomt – framtida FOGIS-scrapers)
│   └── laget/                 ← (tomt – framtida Laget.se-scrapers)
│
├── data/                      ← Scrapad output (gitignored, datumstämplad)
├── scripts/                   ← (tomt – framtida automation)
├── playwright.config.js       ← Läser aktiv site från SITE env
├── .env                       ← Credentials (gitignored)
└── .gitignore
```

## Arkitekturprincip: Site-driven

Alla tester och scrapers är **generiska** – de läser konfiguration från `sites/`.
En site-config (`sites/backatorpif.js`) innehåller:

- `baseURL` – systemets URL
- `auth` – login-path, selektorer, credentials, extra fält
- `routes` – alla admin-routes grupperade per kategori
- `responsivePages` – sidor att testa i mobilvy
- `criticalPages` – sidor att kontrollera JS-fel på

**Att byta system:** `SITE=stalladams npm test` – alla tester kör mot den siten istället.

**Att lägga till nytt system:**
1. Kopiera `sites/_template.js` → `sites/nyttnamn.js`
2. Fyll i config
3. Importera och registrera i `sites/index.js`
4. Lägg till credentials i `.env` med prefix (t.ex. `NYTTNAMN_USERNAME`)

## Konfiguration

### Playwright-projekt (playwright.config.js)

Tre projekt konfigurerade:
- **setup** – Kör `global-setup.js` som loggar in och sparar session
- **desktop** – Chromium 1280×720, använder sparad session
- **mobile** – Chromium 375×812 (iPhone-liknande), kör bara `responsive.spec.js`

Session sparas i `tests/.auth/{siteId}.json`.

### Aktiv site

Styrs av `SITE` i `.env` eller som env-variabel vid körning.
Default: `backatorpif`.

## ⚠️ KRITISKT: Lösenord med specialtecken

Admin-lösenordet för portal.backatorpif.se börjar med `"` (citattecken) och slutar med `#` (hash). Båda är specialtecken som kräver hantering:

| Kontext | Problem | Lösning |
|---------|---------|---------|
| `.env` (dotenv) | `#` tolkas som kommentar | Wrappa i enkla citattecken: `PASSWORD='"h999ztkp#'` |
| JSON (t.ex. sftp.json) | `"` bryter strängen | Backslash-escapa: `"password": "\"h999ztkp#"` |
| Shell / bash | Båda kan ställa till det | Enkla citattecken: `export PASSWORD='"h999ztkp#'` |

**Verifiera att .env parsas korrekt:**
```bash
node -e "import('dotenv').then(d => { d.config(); console.log(JSON.stringify(process.env.BIF_ADMIN_PASSWORD)); })"
```
Förväntat: `"\"h999ztkp#"` (strängen ska börja med `"` och sluta med `#`)

`tests/helpers/auth.js` har en inbyggd `validateCredentials()` som varnar om lösenordet ser felparsat ut.

## Hur man kör

### Tester

```bash
npm test                          # Alla tester
npm run test:auth                 # Bara auth-tester
npm run test:pages                # Smoke-test alla routes
npm run test:js                   # JS-felkontroll
npm run test:responsive           # Mobilvy-tester
npm run test:headed               # Med synlig webbläsare
npm run test:debug                # Stegvis debugging
npm run report                    # Visa HTML-rapport
SITE=stalladams npm test          # Kör mot annat system
```

### Scrapers

```bash
node scrapers/example.js                  # Default site
node scrapers/example.js backatorpif      # Specifik site
node scrapers/fogis/games.js              # Framtida scraper
```

Scrapers sparar output till `data/{siteId}/{namn}_{datum}.json`.

## Mönster och konventioner

### Tester
- Alla `.spec.js`-filer importerar `getActiveSite()` och läser routes/selektorer därifrån
- Accepterar HTTP 200, 302, 303 och 403 som giltiga svar (403 = behörighetsbegränsad, hoppas över)
- JS-konsolfel loggas som varningar på smoke-tester, men failar på criticalPages
- Responsivitetstester kontrollerar horisontell overflow och att element inte sticker ut

### Scrapers
- Använd `createAuthenticatedPage(siteId)` för att få en inloggad sida
- Använd `createRateLimiter(ms)` för att inte hamra servern
- Använd `withRetry(fn, { retries: 3 })` för robusthet
- Spara alltid via `saveJson()` / `saveCsv()` – hanterar mappar och datumstämpling

### Kodstil
- ESM (`import/export`) – aldrig CommonJS (`require`)
- Kommentarer och UI-text på svenska
- Kod, variabelnamn och teknisk dokumentation på engelska
- Inga externa dependencies utöver de installerade – håll det minimalt

## System vi testar/scrapar

### Backatorp IF Portal (aktiv)
- **URL:** https://portal.backatorpif.se
- **Stack:** PHP + MySQL + vanilla JS
- **Auth:** Username + password + association_id select + CSRF-token
- **Routes:** ~120 admin-sidor i 19 kategorier
- **Site-config:** `sites/backatorpif.js`
- **Env-prefix:** `BIF_`

### Framtida system (förberedda i .env)
- Stall Adams RF – env-prefix `STALLADAMS_`
- EQUICARD – env-prefix `EQUICARD_`

## Filer som INTE ska committas
- `.env` – credentials
- `tests/.auth/` – sparade sessions
- `data/` – scrapad output
- `test-results/` – screenshots vid failure
- `playwright-report/` – HTML-rapporter
