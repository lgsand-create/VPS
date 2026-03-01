# Laget.se Närvaro API

REST API för aktiviteter, närvaro och LOK-stöd för Backatorp IF:s fotbollslag (laget.se).

**Bas-URL:** `https://vpn.compuna.se/api/laget`

**Autentisering:** Alla anrop kräver en giltig API-nyckel skickad som header:

```
X-API-Key: din-nyckel-här
```

---

## Endpoints

| Grupp | Endpoint | Beskrivning |
|-------|----------|-------------|
| Statistik | `GET /stats` | Aggregerad statistik |
| Lag | `GET /teams` | Lista alla lag |
| Lag | `GET /teams/:id` | Lagdetalj med aktiviteter |
| Aktiviteter | `GET /activities` | Lista aktiviteter med filter |
| Aktiviteter | `GET /activities/:id` | Aktivitetsdetalj med deltagare |
| Medlemmar | `GET /members` | Alla medlemmar med närvarostatistik |
| Medlemmar | `GET /members/:id` | Medlemsdetalj med historik |
| Ändringar | `GET /changes` | Senaste ändringar |

---

## Statistik

### GET /stats

Aggregerad statistik för all data.

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `team` | sträng | — | Filtrera på lag-ID (t.ex. `u17`) |
| `from` | datum | — | Filtrera från datum (YYYY-MM-DD) |
| `to` | datum | — | Filtrera till datum (YYYY-MM-DD) |

**Svar:**

```json
{
  "data": {
    "aktiviteter": 245,
    "lag": 19,
    "lok_aktiviteter": 180,
    "unika_deltagare": 312,
    "unika_ledare": 45,
    "totalt_deltar": 2800,
    "totalt_deltar_ej": 450,
    "totalt_ej_svarat": 120,
    "per_lag": [
      { "team_id": "u17", "namn": "U17 (Herr)", "aktiviteter": 24, "lok_aktiviteter": 18 }
    ],
    "senaste_scrape": {
      "started_at": "2026-02-14T06:00:00",
      "status": "success",
      "records": 50
    }
  }
}
```

---

## Lag

### GET /teams

Lista alla registrerade lag.

**Svar:**

```json
{
  "data": [
    { "id": "u17", "slug": "BackatorpIF-Fotboll-U17Herr", "namn": "U17 (Herr)", "aktiv": true, "antal_aktiviteter": 24 }
  ]
}
```

---

### GET /teams/:id

Lagdetalj med alla aktiviteter.

**URL-parametrar:**

| Param | Typ | Beskrivning |
|-------|-----|-------------|
| `id` | sträng | Lagets ID (t.ex. `u17`, `alag`, `p12`) |

**Svar:**

```json
{
  "data": {
    "id": "u17",
    "slug": "BackatorpIF-Fotboll-U17Herr",
    "namn": "U17 (Herr)",
    "aktiv": true,
    "aktiviteter": [
      { "id": 1, "event_id": "12345", "datum": "2026-02-10", "starttid": "18:00", "typ": "Träning", "plats": "Backavallen" }
    ]
  }
}
```

---

## Aktiviteter

### GET /activities

Lista aktiviteter med filter.

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `team` | sträng | — | Filtrera på lag-ID |
| `from` | datum | — | Filtrera från datum (YYYY-MM-DD) |
| `to` | datum | — | Filtrera till datum (YYYY-MM-DD) |
| `lok` | sträng | — | Filtrera på LOK-stöd (`true`/`false`) |
| `typ` | sträng | — | Filtrera på aktivitetstyp (delmatchning) |

**Svar:**

```json
{
  "data": [
    {
      "id": 1,
      "event_id": "12345",
      "team_id": "u17",
      "lag_namn": "U17 (Herr)",
      "datum": "2026-02-10",
      "starttid": "18:00",
      "sluttid": "19:30",
      "typ": "Träning",
      "plats": "Backavallen",
      "lok_aktivitet": true,
      "deltar_count": 14,
      "ledare_count": 3
    }
  ]
}
```

Sorteras efter datum (senaste först). Max 500 rader.

---

### GET /activities/:id

Aktivitetsdetalj med fullständig deltagarlista.

**URL-parametrar:**

| Param | Typ | Beskrivning |
|-------|-----|-------------|
| `id` | heltal | Aktivitetens databas-ID |

**Svar:**

```json
{
  "data": {
    "id": 1,
    "event_id": "12345",
    "team_id": "u17",
    "lag_namn": "U17 (Herr)",
    "datum": "2026-02-10",
    "starttid": "18:00",
    "sluttid": "19:30",
    "typ": "Träning",
    "plats": "Backavallen",
    "lok_aktivitet": true,
    "deltagare": [
      { "id": 1, "member_id": 42, "namn": "Erik Svensson", "roll": "deltagare", "status": "Deltar", "kommentar": "" }
    ],
    "ledare": [
      { "id": 2, "member_id": 5, "namn": "Jonas Andersson", "roll": "ledare", "status": "Deltar", "kommentar": "" }
    ]
  }
}
```

---

## Medlemmar

### GET /members

Alla medlemmar med aggregerad närvarostatistik.

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `team` | sträng | — | Filtrera på lag-ID |
| `from` | datum | — | Filtrera från datum (YYYY-MM-DD) |
| `to` | datum | — | Filtrera till datum (YYYY-MM-DD) |

**Svar:**

```json
{
  "data": [
    {
      "id": 42,
      "namn": "Erik Svensson",
      "antal_kallad": 20,
      "antal_deltar": 16,
      "antal_deltar_ej": 2,
      "antal_ej_svarat": 1,
      "antal_schemalagd": 1
    }
  ]
}
```

Sorteras alfabetiskt.

---

### GET /members/:id

Medlemsdetalj med fullständig närvarohistorik.

**URL-parametrar:**

| Param | Typ | Beskrivning |
|-------|-----|-------------|
| `id` | heltal | Medlemmens ID |

**Svar:**

```json
{
  "data": {
    "id": 42,
    "namn": "Erik Svensson",
    "historik": [
      {
        "status": "Deltar",
        "roll": "deltagare",
        "kommentar": "",
        "datum": "2026-02-10",
        "starttid": "18:00",
        "typ": "Träning",
        "plats": "Backavallen",
        "lag_namn": "U17 (Herr)"
      }
    ]
  }
}
```

---

## Ändringar

### GET /changes

Ändringslogg — spårar status-ändringar, rollbyten m.m.

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `team` | sträng | — | Filtrera på lag-ID |
| `member` | heltal | — | Filtrera på medlems-ID |
| `field` | sträng | — | Filtrera på fältnamn |
| `limit` | heltal | 50 | Max antal rader |

**Fältnamn:**

| Fält | Beskrivning |
|------|-------------|
| `status` | Ändring av deltagarstatus (Deltar/Deltar ej/Ej svarat) |
| `roll` | Ändring av roll (deltagare/ledare) |
| `lok_aktivitet` | Ändring av LOK-stöd |
| `kommentar` | Ändrad kommentar |

**Svar:**

```json
{
  "data": [
    {
      "created_at": "2026-02-14T06:00:00",
      "field_name": "status",
      "old_value": "Ej svarat",
      "new_value": "Deltar",
      "medlem": "Erik Svensson",
      "datum": "2026-02-10",
      "typ": "Träning",
      "plats": "Backavallen",
      "lag_namn": "U17 (Herr)"
    }
  ],
  "meta": { "count": 25 }
}
```

---

## Lag-ID:n

Alla 19 fotbollslag i Backatorp IF:

| ID | Namn |
|----|------|
| `alag` | A-Lag (Herr) |
| `u17` | U17 (Herr) |
| `p12` | P-12 Fotboll |
| `p13` | P-13 Fotboll |
| `p14` | P-14 Fotboll |
| `p15` | P-15 Fotboll |
| `p16` | P-16 Fotboll |
| `p17` | P-2017 Fotboll |
| `p18` | P-2018 Fotboll |
| `p19` | P-2019 Fotboll |
| `p20` | P-2020 Fotboll |
| `uflick` | U-flickor Fotboll |
| `f1112` | F-11/12 Fotboll |
| `f1314` | F-13/14 Fotboll |
| `f1516` | F-15/16 Fotboll |
| `f17` | F-2017 Fotboll |
| `f18` | F-2018 Fotboll |
| `f19` | F-2019 Fotboll |
| `f20` | F-2020 Fotboll |

---

## CRON-scheman

| Jobb | Schema | Beskrivning |
|------|--------|-------------|
| Rullande fönster | `0 6,12,18 * * *` | Scrapar 2 dagar bakåt + 3 dagar framåt, alla 19 lag, 3 gånger per dag |
| Komplett år | `0 2 1 * *` | Scrapar hela året, alla 19 lag, 1:a varje månad kl 02:00 |

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
| 400 | Ogiltiga parametrar |
| 401 | Ogiltig eller saknad API-nyckel |
| 404 | Resurs hittades inte |
| 429 | Rate limit överskriden |
| 500 | Internt serverfel |

---

## Exempel

### Hämta statistik för U17

```bash
curl -H "X-API-Key: din-nyckel" \
  https://vpn.compuna.se/api/laget/stats?team=u17
```

### Hämta alla LOK-aktiviteter

```bash
curl -H "X-API-Key: din-nyckel" \
  https://vpn.compuna.se/api/laget/activities?lok=true
```

### Hämta en medlems närvarohistorik

```bash
curl -H "X-API-Key: din-nyckel" \
  https://vpn.compuna.se/api/laget/members/42
```
