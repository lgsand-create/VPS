# MinRidskola API

REST API för ridskoledata — kurser, ryttare, hästar, närvaro och ändringslogg.

**Bas-URL:** `https://vpn.compuna.se/api/minridskola`

**Autentisering:** Alla anrop kräver en giltig API-nyckel skickad som header:

```
X-API-Key: din-nyckel-här
```

---

## Endpoints

| Grupp | Endpoint | Beskrivning |
|-------|----------|-------------|
| Statistik | `GET /stats` | Aggregerad statistik |
| Kurser | `GET /courses` | Lista alla kurser |
| Kurser | `GET /courses/:lnummer` | Kursdetalj med instanser |
| Kurser | `GET /courses/:lnummer/weeks/:vecka` | Deltagare för specifik vecka |
| Ryttare | `GET /riders` | Lista alla ryttare |
| Ryttare | `GET /riders/:id` | Ryttardetalj med statistik |
| Ryttare | `GET /riders/:id/attendance` | Ryttarens närvarohistorik |
| Hästar | `GET /horses` | Lista alla hästar |
| Hästar | `GET /horses/:id` | Hästdetalj med statistik |
| Närvaro | `GET /attendance` | Sök bokningar/närvaro |
| Veckor | `GET /weeks` | Lista alla scrapade veckor |
| Veckor | `GET /weeks/:week` | Veckoöversikt med alla kurser |
| Ändringar | `GET /changes` | Senaste ändringar |
| Ändringar | `GET /changes/summary` | Ändringssammanfattning per dag |

---

## Statistik

### GET /stats

Aggregerad statistik för all data.

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `from` | datum | — | Filtrera från datum (YYYY-MM-DD) |
| `to` | datum | — | Filtrera till datum (YYYY-MM-DD) |

**Svar:**

```json
{
  "data": {
    "veckor": 12,
    "tillfallen": 276,
    "kurser": 23,
    "ryttare": 126,
    "hastar": 80,
    "bokningar": 3120,
    "avbokade": 445,
    "narvarande": 2010,
    "aktiva_platser": 2675,
    "narvarograd": 75,
    "senaste_scrape": {
      "started_at": "2026-02-09T13:02:32",
      "status": "success",
      "records": 130
    }
  }
}
```

---

## Kurser

### GET /courses

Lista alla kurser.

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `dag` | sträng | — | Filtrera på veckodag (t.ex. `Måndag`) |

**Svar:**

```json
{
  "data": [
    {
      "lnummer": "L1234",
      "kursnamn": "Nybörjare Mån 17:00",
      "dag": "Måndag",
      "tid": "17:00-18:00",
      "plats": "Ridhuset",
      "ridlarare": "Anna Svensson"
    }
  ],
  "meta": { "count": 23 }
}
```

Sorteras efter veckodag (Måndag → Söndag) och sedan tid.

---

### GET /courses/:lnummer

Kursdetalj med senaste instanser (veckor).

**URL-parametrar:**

| Param | Typ | Beskrivning |
|-------|-----|-------------|
| `lnummer` | sträng | Kursens lektionsnummer (t.ex. `L1234`) |

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `limit` | heltal | 10 | Antal instanser att hämta |

**Svar:**

```json
{
  "data": {
    "lnummer": "L1234",
    "kursnamn": "Nybörjare Mån 17:00",
    "dag": "Måndag",
    "tid": "17:00-18:00",
    "instances": [
      {
        "id": 42,
        "vecka": "6",
        "datum": "2026-02-02",
        "deltagare": 8,
        "avbokade": 1,
        "narvarande": 6
      }
    ]
  }
}
```

---

### GET /courses/:lnummer/weeks/:vecka

Deltagarlista för en specifik kursinstans.

**URL-parametrar:**

| Param | Typ | Beskrivning |
|-------|-----|-------------|
| `lnummer` | sträng | Kursens lektionsnummer |
| `vecka` | sträng | Veckonummer (t.ex. `6`) |

**Svar:**

```json
{
  "data": {
    "lnummer": "L1234",
    "kursnamn": "Nybörjare Mån 17:00",
    "vecka": "6",
    "datum": "2026-02-02",
    "deltagare": [
      {
        "rider_id": 101,
        "ryttare": "Emma Johansson",
        "horse_id": 7,
        "horse_hnummer": "14",
        "hast": "Doansen",
        "avbokad": false,
        "narvaro": true
      }
    ]
  }
}
```

---

## Ryttare

### GET /riders

Lista alla ryttare.

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `search` | sträng | — | Sök på ryttarnamn (delmatchning) |

**Svar:**

```json
{
  "data": [
    {
      "id": 101,
      "namn": "Emma Johansson"
    }
  ],
  "meta": { "count": 126 }
}
```

Sorteras alfabetiskt.

---

### GET /riders/:id

Ryttardetalj med aggregerad statistik.

**URL-parametrar:**

| Param | Typ | Beskrivning |
|-------|-----|-------------|
| `id` | heltal | Ryttarens ID |

**Svar:**

```json
{
  "data": {
    "id": 101,
    "namn": "Emma Johansson",
    "stats": {
      "tillfallen": 24,
      "narvarande": 20,
      "avbokade": 3,
      "kurser": 2
    }
  }
}
```

---

### GET /riders/:id/attendance

Ryttarens fullständiga närvarohistorik.

**URL-parametrar:**

| Param | Typ | Beskrivning |
|-------|-----|-------------|
| `id` | heltal | Ryttarens ID |

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `from` | datum | — | Filtrera från datum (YYYY-MM-DD) |
| `to` | datum | — | Filtrera till datum (YYYY-MM-DD) |
| `limit` | heltal | 50 | Max antal rader |

**Svar:**

```json
{
  "data": [
    {
      "datum": "2026-02-02",
      "vecka": "6",
      "lnummer": "L1234",
      "kursnamn": "Nybörjare Mån 17:00",
      "dag": "Måndag",
      "tid": "17:00-18:00",
      "horse_id": 7,
      "horse_hnummer": "14",
      "hast": "Doansen",
      "avbokad": false,
      "narvaro": true
    }
  ],
  "meta": { "count": 24 }
}
```

---

## Hästar

### GET /horses

Lista alla hästar med grunddata från hästindexet.

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `search` | sträng | — | Sök på hästnamn (delmatchning) |
| `typ` | sträng | — | Filtrera på typ (`Ridhast` eller `Ponny`) |

**Svar:**

```json
{
  "data": [
    {
      "id": 1,
      "hnummer": "10",
      "namn": "Diamond",
      "typ": "Ridhast",
      "kon": "Valack",
      "fodelsear": 2011,
      "ras": "Lettiskt halvbl",
      "mankhojd": 15.3,
      "ponnykategori": null,
      "farg": "Mörkbrun",
      "bortrest": false,
      "lektionshast": true,
      "inkopsdatum": "2020-10-28",
      "avford_datum": null,
      "ryttare": 12,
      "kurser": 5,
      "tillfallen": 48,
      "senast_sedd": "2026-02-02"
    }
  ],
  "meta": { "count": 19 }
}
```

---

### GET /horses/:id

Hästdetalj med all data: statistik, kurser, ryttare, foder, journaler, sjukskrivningar och skoningar.

**URL-parametrar:**

| Param | Typ | Beskrivning |
|-------|-----|-------------|
| `id` | heltal | Hästens ID |

**Svar:**

```json
{
  "data": {
    "id": 1,
    "hnummer": "10",
    "namn": "Diamond",
    "typ": "Ridhast",
    "kon": "Valack",
    "fodelsear": 2011,
    "ras": "Lettiskt halvbl",
    "mankhojd": 15.3,
    "ponnykategori": null,
    "farg": "Mörkbrun",
    "tecken": null,
    "harstamning": null,
    "uppfodare": null,
    "agare": null,
    "bortrest": false,
    "privathast": false,
    "lektionshast": true,
    "stall": null,
    "stallplats_nr": null,
    "inkopsdatum": "2020-10-28",
    "avford_datum": null,
    "stats": {
      "ryttare": 12,
      "kurser": 5,
      "tillfallen": 48,
      "forst_sedd": "2025-09-01",
      "senast_sedd": "2026-02-02"
    },
    "courses": [
      { "lnummer": "L1234", "kursnamn": "Allround niva 3", "dag": "Måndag", "tid": "17:00-18:00", "tillfallen": 10 }
    ],
    "riders": [
      { "id": "101", "namn": "Emma Johansson", "tillfallen": 8, "senast": "2026-02-02" }
    ],
    "feed": [
      { "rad_nr": 1, "fodersort": "Hösilage (kg)", "fodring_1": "3", "fodring_2": "3", "fodring_3": "", "fodring_4": "", "fodring_5": "" }
    ],
    "journals": [
      { "typ": "Vaccination", "datum": "2021-11-02", "till_datum": null, "beskrivning": "Prequenza TE" }
    ],
    "sickLeave": [
      { "datum_from": "2019-03-29", "datum_to": "2019-04-25", "orsak": "Hälta?" }
    ],
    "shoeing": [
      { "datum": "2025-10-28", "notering": "" }
    ]
  }
}
```

**Foder-struktur:** Varje rad representerar en fodertyp med mängd per fodringstillfälle (1-5 gånger/dag).
Möjliga fodersorter: Gräshage (dag), Havre (kg), Hovslagare (1), Hö (kg), Hösilage (kg), IFF (liter), Mash (liter), Maskmedel (st), Mineral (liter), Spånpellets enstaka (st), Spånpellets månad (st), Torv (st).

**Journal-typer:** Vaccination, Avmaskning, Dagbok.

---

## Närvaro

### GET /attendance

Sök bland alla bokningar/närvaroposter.

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `course` | sträng | — | Filtrera på lektionsnummer |
| `rider` | heltal | — | Filtrera på ryttare (ID) |
| `week` | sträng | — | Filtrera på vecka |
| `from` | datum | — | Filtrera från datum (YYYY-MM-DD) |
| `to` | datum | — | Filtrera till datum (YYYY-MM-DD) |
| `limit` | heltal | 100 | Max antal rader |

**Svar:**

```json
{
  "data": [
    {
      "vecka": "6",
      "datum": "2026-02-02",
      "lnummer": "L1234",
      "kursnamn": "Nybörjare Mån 17:00",
      "dag": "Måndag",
      "tid": "17:00-18:00",
      "rider_id": 101,
      "ryttare": "Emma Johansson",
      "horse_id": 7,
      "horse_hnummer": "14",
      "hast": "Doansen",
      "avbokad": false,
      "narvaro": true
    }
  ],
  "meta": { "count": 100 }
}
```

---

## Veckor

### GET /weeks

Lista alla scrapade veckor.

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `year` | sträng | — | Filtrera på år (t.ex. `2026`) |

**Svar:**

```json
{
  "data": [
    {
      "vecka": "6",
      "from_date": "2026-02-02",
      "to_date": "2026-02-08",
      "kurser": 23,
      "bokningar": 260,
      "narvarande": 195,
      "avbokade": 38
    }
  ],
  "meta": { "count": 12 }
}
```

---

### GET /weeks/:week

Veckoöversikt med alla kurser och deltagare.

**URL-parametrar:**

| Param | Typ | Beskrivning |
|-------|-----|-------------|
| `week` | sträng | Veckonummer (t.ex. `6`) |

**Svar:**

```json
{
  "data": {
    "vecka": "6",
    "kurser": [
      {
        "lnummer": "L1234",
        "kursnamn": "Nybörjare Mån 17:00",
        "dag": "Måndag",
        "tid": "17:00-18:00",
        "deltagare": [
          {
            "rider_id": 101,
            "ryttare": "Emma Johansson",
            "horse_id": 7,
            "horse_hnummer": "14",
            "hast": "Doansen",
            "avbokad": false,
            "narvaro": true
          }
        ]
      }
    ]
  },
  "meta": { "kurser": 23 }
}
```

---

## Ändringar

### GET /changes

Ändringslogg — spårar avbokningar, närvaroändringar, hästbyten m.m.

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `rider` | heltal | — | Filtrera på ryttare (ID) |
| `course` | sträng | — | Filtrera på lektionsnummer |
| `field` | sträng | — | Filtrera på fältnamn (`avbokad`, `narvaro`, `hast`, `bokning`) |
| `limit` | heltal | 50 | Max antal rader |

**Fältnamn:**

| Fält | Beskrivning |
|------|-------------|
| `avbokad` | Ändring av avbokningsstatus (true/false) |
| `narvaro` | Ändring av närvarostatus (true/false) |
| `hast` | Byte av häst |
| `bokning` | Ny bokning eller borttagen bokning |

**Svar:**

```json
{
  "data": [
    {
      "detected_at": "2026-02-09T13:02:32",
      "field_name": "avbokad",
      "old_value": "false",
      "new_value": "true",
      "scrape_file": "minridskola_2026-02-09.json",
      "rider_id": 101,
      "ryttare": "Emma Johansson",
      "lnummer": "L1234",
      "vecka": "6",
      "datum": "2026-02-02",
      "kursnamn": "Nybörjare Mån 17:00",
      "dag": "Måndag"
    }
  ],
  "meta": { "count": 50 }
}
```

---

### GET /changes/summary

Ändringssammanfattning grupperad per dag.

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `days` | heltal | 30 | Antal dagar bakåt |

**Svar:**

```json
{
  "data": [
    {
      "date": "2026-02-09",
      "avbokad": 5,
      "narvaro": 12,
      "hast": 2,
      "bokning": 8,
      "total": 27
    }
  ],
  "meta": { "count": 30 }
}
```

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

## Rate Limiting

Varje API-nyckel har en individuell rate limit (standard: 100 anrop/minut). Vid överskridande returneras `429 Too Many Requests`.

Svarshuvuden vid varje anrop:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1707483600
```

---

## Exempel

### Hämta alla kurser på måndagar

```bash
curl -H "X-API-Key: din-nyckel" \
  https://vpn.compuna.se/api/minridskola/courses?dag=Måndag
```

### Hämta en ryttares närvarohistorik

```bash
curl -H "X-API-Key: din-nyckel" \
  https://vpn.compuna.se/api/minridskola/riders/101/attendance?limit=20
```

### Hämta vecka 6 med alla deltagare

```bash
curl -H "X-API-Key: din-nyckel" \
  https://vpn.compuna.se/api/minridskola/weeks/6
```

### Senaste avbokningar

```bash
curl -H "X-API-Key: din-nyckel" \
  https://vpn.compuna.se/api/minridskola/changes?field=avbokad&limit=10
```
