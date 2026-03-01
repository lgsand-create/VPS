# Nyheter API

REST API för nyhetsartiklar från Backatorp IF:s hemsida (backatorpif.se / laget.se).

**Bas-URL:** `https://vpn.compuna.se/api/nyheter`

**Autentisering:** Alla anrop kräver en giltig API-nyckel skickad som header:

```
X-API-Key: din-nyckel-här
```

API-nycklar skapas under Verktyg → API-nycklar i dashboarden.

---

## Endpoints

| Grupp | Endpoint | Beskrivning |
|-------|----------|-------------|
| Statistik | `GET /stats` | Aggregerad statistik |
| Artiklar | `GET /articles` | Lista artiklar med filter |
| Artiklar | `GET /articles/:id` | Artikeldetalj med full text |

---

## Statistik

### GET /stats

Aggregerad statistik för alla artiklar i databasen.

**Svar:**

```json
{
  "data": {
    "antal_artiklar": 42,
    "totala_visningar": 18500,
    "totala_kommentarer": 15,
    "antal_forfattare": 5,
    "aldsta_artikel": "2025-01-15",
    "senaste_artikel": "2026-02-14",
    "senaste_scrape": {
      "started_at": "2026-02-14T07:00:00",
      "status": "success",
      "records": 3
    }
  }
}
```

---

## Artiklar

### GET /articles

Lista artiklar med valfria filter. Sorteras efter datum (senaste först).

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `from` | datum | — | Filtrera från datum (YYYY-MM-DD) |
| `to` | datum | — | Filtrera till datum (YYYY-MM-DD) |
| `author` | sträng | — | Filtrera på författare (delmatchning) |
| `search` | sträng | — | Sök i rubrik och brödtext (delmatchning) |
| `limit` | heltal | 50 | Max antal artiklar |

**Svar:**

```json
{
  "data": [
    {
      "id": 1,
      "news_id": "7951842",
      "rubrik": "Välkomna till säsongen 2025!",
      "datum": "2025-09-24",
      "visningar": 1380,
      "kommentarer": 2,
      "forfattare": "Backatorp IF Kansli",
      "url": "https://www.backatorpif.se/BackatorpIF/News/7951842/...",
      "bild": "bilder/7951842.jpg",
      "bild_url": "https://az729104.cdn.laget.se/11783254.jpg",
      "text_preview": "De första 200 tecknen av brödtexten..."
    }
  ],
  "meta": { "count": 42 }
}
```

---

### GET /articles/:id

Fullständig artikeldetalj med komplett brödtext.

**URL-parametrar:**

| Param | Typ | Beskrivning |
|-------|-----|-------------|
| `id` | heltal | Artikelns databas-ID |

**Svar:**

```json
{
  "data": {
    "id": 1,
    "news_id": "7951842",
    "rubrik": "Välkomna till säsongen 2025!",
    "datum": "2025-09-24",
    "datum_raw": "20250924",
    "visningar": 1380,
    "kommentarer": 2,
    "forfattare": "Backatorp IF Kansli\nKanslist/Övergångsansvarig",
    "url": "https://www.backatorpif.se/BackatorpIF/News/7951842/...",
    "bild": "bilder/7951842.jpg",
    "bild_url": "https://az729104.cdn.laget.se/11783254.jpg",
    "text_content": "Fullständig brödtext här...",
    "data_hash": "a1b2c3d4e5f6...",
    "created_at": "2026-02-14T07:05:00",
    "updated_at": "2026-02-14T07:05:00"
  }
}
```

---

## Lyssna på nya artiklar

### Polling (enklast)

Fråga API:et regelbundet efter nya artiklar. Spara senast sett datum och filtrera med `from`:

```bash
curl -H "X-API-Key: din-nyckel" \
  "https://vpn.compuna.se/api/nyheter/articles?from=2026-02-13"
```

**Rekommenderat intervall:** Var 30:e minut eller en gång per timme. Scrapern körs dagligen kl 07:00, så nya artiklar dyker upp strax efter det.

### Exempelflöde (Node.js)

```javascript
const API_URL = 'https://vpn.compuna.se/api/nyheter';
const API_KEY = 'din-nyckel-här';

async function checkForNewArticles(sinceDate) {
  const res = await fetch(
    `${API_URL}/articles?from=${sinceDate}`,
    { headers: { 'X-API-Key': API_KEY } }
  );
  const { data } = await res.json();
  return data;
}

// Kör var 30:e minut
setInterval(async () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const since = yesterday.toISOString().slice(0, 10);

  const articles = await checkForNewArticles(since);
  if (articles.length > 0) {
    console.log(`${articles.length} nya/uppdaterade artiklar`);
    // Gör något med artiklarna...
  }
}, 30 * 60 * 1000);
```

### Exempelflöde (bash / cron)

Kör t.ex. kl 08:00 varje dag (en timme efter scrapern):

```bash
#!/bin/bash
YESTERDAY=$(date -d "yesterday" +%Y-%m-%d)
curl -s -H "X-API-Key: din-nyckel" \
  "https://vpn.compuna.se/api/nyheter/articles?from=$YESTERDAY" \
  | jq '.data[] | "\(.datum) — \(.rubrik) (\(.visningar) visn.)"'
```

---

## CRON-schema

| Jobb | Schema | Beskrivning |
|------|--------|-------------|
| Daglig | `0 7 * * *` | Scrapar alla nyheter från backatorpif.se, importerar till databas |

Scrapern hämtar artiklar publicerade från 2025-01-01 och framåt. Redan importerade artiklar uppdateras (visningar, kommentarer) vid varje körning.

---

## Felhantering

Alla fel returneras som JSON med `error`-fält:

```json
{
  "error": "Beskrivning av felet"
}
```

| HTTP-kod | Betydelse |
|----------|-----------|
| 401 | Ogiltig eller saknad API-nyckel |
| 404 | Artikeln finns inte |
| 429 | Rate limit överskriden |
| 500 | Internt serverfel |

---

## Exempel

### Hämta statistik

```bash
curl -H "X-API-Key: din-nyckel" \
  https://vpn.compuna.se/api/nyheter/stats
```

### Sök artiklar

```bash
curl -H "X-API-Key: din-nyckel" \
  "https://vpn.compuna.se/api/nyheter/articles?search=träning"
```

### Hämta artiklar från en viss författare

```bash
curl -H "X-API-Key: din-nyckel" \
  "https://vpn.compuna.se/api/nyheter/articles?author=Kansli"
```

### Hämta specifik artikel

```bash
curl -H "X-API-Key: din-nyckel" \
  https://vpn.compuna.se/api/nyheter/articles/1
```
