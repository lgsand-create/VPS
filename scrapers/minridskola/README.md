# MinRidskola Scraper

Scrapar narvarodata fran MinRidskola.se (Xenophon Cloud Edition av Prosperous AB).
Site: **Stall Adams RF**, licensnr `7678-5850-0915`.

**OBS: BARA LASNING - ANDRAR INGET PA SIDAN.**

## Snabbstart

```bash
# Nuvarande vecka (~1 min)
node scrapers/minridskola/scrape.js

# Hela innevarande aret
node scrapers/minridskola/scrape.js --year

# Specifikt ar (engangskoming, ~30 min)
node scrapers/minridskola/scrape.js --year 2025

# N veckor bakat
node scrapers/minridskola/scrape.js --weeks 8
```

## Credentials (.env)

```
MRS_BASE_URL=https://www.minridskola.se
MRS_LICNR=7678-5850-0915
MRS_ADMIN_USERNAME=Jonas
MRS_ADMIN_PASSWORD=Dusty
```

## Filer

| Fil | Syfte |
|-----|-------|
| `scrape.js` | **Produktionsskriptet** - allt-i-ett med alla lagen |
| `explore.js` | Utforskning av login-flode (admin + kund) |
| `explore-avprickning.js` | Utforskning av avprickningssidan |
| `probe-avprickning.js` | Kartlade sidans knappar/overlay/JS-funktioner |
| `probe-lektion.js` | Kartlade lektionsdetaljvy (veckoknappar) |
| `scrape-avprickning.js` | Tidig vecko-scraper (ersatt av scrape.js) |
| `scrape-historik.js` | Tidig historik-scraper (ersatt av scrape.js) |
| `test-date.js` | Verifiering av ISO 8601 vecko-till-datum-berakning |

Probe/explore-filerna behover inte koras igen men bevaras som referens.

## Output

Sparas till `data/minridskola/narvaro_{datum|ar}.json`:

```json
{
  "meta": { "scraped": "ISO-timestamp", "lage": "nuvarande vecka", "nuvarandeVecka": "Vecka 2026-06" },
  "statistik": { "antalTillfallen", "antalKurser", "unikaRyttare", "unikaHastar", "deltagarplatser", "avbokade", "narvarande", "narvarograd" },
  "kurser": [{ "lnummer", "kursnamn", "dag", "tid", "plats", "ridlarare" }],
  "ryttare": [{ "id", "namn" }],
  "hastar": ["Hast1", "Hast2"],
  "tillfallen": [{
    "lnummer", "kursnamn", "dag", "vecka", "datum",
    "deltagare": [{ "ryttareId", "namn", "hast", "avbokad", "narvaro" }]
  }]
}
```

## Systemarkitektur (MinRidskola/Xenophon)

### Login-flode (5 steg)

1. **POST Default2.aspx** - Satter licensnummer (`SavedLicNr`)
2. **GET Init_LoggaIn.aspx** - Visar login-formular
3. **POST credentials** - `txbUserName` + `txbUserPasswd` + `butSubmit`
4. **POST Main_Init.aspx** - **KRITISKT**: Initierar Xenophon-session med `LicNr`
5. **Vanta** - `waitForLoadState('load')` + `waitForTimeout(3000)` + `waitForLoadState('networkidle')`

Admin redirectar genom flera sidor efter steg 4. Utan extra vantetid kraschar det med "page is navigating".

### Avprickningssidan

- **URL**: `/Xenophon/Avprickning/Avprick00_LektLista.aspx`
- **Dagknappar**: `#ContentPlaceHolder1_butVdag1` (Mandag) till `butVdag7` (Sondag)
- **Lektionsnavigering**: `GoToLektion('104A')` -> `Avprick10_LasaLektion.aspx?LNummer=104A`
- **Desktop + mobil-tabeller**: Deduplicera med `Set` pa `lnummer`

### Lektionsdetaljvy

- **Veckoknapp `<`**: `#ContentPlaceHolder1_butVeckoNr1` (bakat)
- **Veckovisning**: `#ContentPlaceHolder1_butVeckoNr2` (visar "Vecka 2026-06")
- **Veckoknapp `>`**: `#ContentPlaceHolder1_butVeckoNr3` (framat)
- **Deltagardata**: Tabell med header "Ryttare" / "Hast", checkboxar for narvaro
- **FARLIGA knappar (ROR INTE)**: `PrickaAv()`, `PrickaAvAlla()`, `VisaValbaraHastar()`

### "Laser..."-overlay

Sidan ar langsam och visar en "Laser..."-dialog under laddning:

```js
async function waitForOverlay(page) {
  await page.waitForFunction(() => {
    const d = document.getElementById('dialogWait');
    return !d || d.style.display === 'none';
  }, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}
```

### Veckostate i sessionen

Servern sparar vilken vecka som visas i sessionen. Efter att ha navigerat 53 veckor bakat i en lektion startar nasta lektion ocksa dar.

**Losning**: Ga via avprickningslistan forst (resetar veckan), klicka pa ratt dag, sedan navigera till lektionen. Se `gotoLessonCurrentWeek()`.

### Datumberakning

Sidan visar sondagens datum for alla lektioner oavsett dag. Faktiskt datum beraknas fran veckonummer + dagnamn med ISO 8601:

```js
function computeDate(veckaText, dagnamn) {
  // "Vecka 2026-06" + "Mandag" -> "2026-02-02"
  // Vecka 1 innehaller 4 januari (ISO 8601)
  // Formatera med lokalt datum (toISOString() ger UTC-shift)
}
```

**OBS**: Anvand INTE `toISOString().slice(0,10)` - det konverterar till UTC som kan shifta datum en dag bakatt i CET.

## Befintlig data

| Fil | Innehall |
|-----|----------|
| `narvaro_2025.json` | Hela 2025: 899 tillfallen, 76 ryttare, 19 hastar, 67% narvaro |
| `narvaro_2026-02-08.json` | Vecka 2026-06 (nuvarande) |
| `narvaro_historik_2026-02-08.json` | 2026 v1-v6: 129 tillfallen |

## Anvandning med intervall

For levande data, kor `node scrape.js` periodiskt (t.ex. var 15:e minut). Det tar ~1 minut per korning och hamtar bara nuvarande vecka. Historik behover bara koras en gang.

## Kursstruktur (23 lektioner)

| Dag | Kurser |
|-----|--------|
| Mandag | Allround niva 2, 3, 5, Allround niva 3 |
| Tisdag | Specialgrupp, Nyborjare, Niva 2 allround, Allround niva 3 |
| Onsdag | Allround niva 1, Allround 1 vux, Allround niva 3 |
| Torsdag | Allround Niva 3, Allround niva 4, Hoppgrupp n4, Medryttare tors |
| Fredag | Medryttare fred |
| Lordag | Allround niva 2, 3, 1, Medryttare lord |
| Sondag | Nyborjare +, Dressyrspecial, Medryttare son |
