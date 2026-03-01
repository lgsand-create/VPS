# Bakgrundskontroll API

Verifiering av belastningsregisterutdrag mot Polismyndighetens kontrolltjänst.

**Bas-URL:** `https://vpn.compuna.se/api/bgcheck`

**Autentisering:** API-nyckel + HMAC-signatur krävs för `/verify`. Dashboard-endpoints (`/stats`, `/log`, `/status`) nås via same-origin.

```
X-API-Key: chub_...
X-Timestamp: <unix-sekunder>
X-Signature: HMAC-SHA256(timestamp.body, SHA256(apiKey))
```

---

## Endpoints

| Endpoint | Metod | Beskrivning |
|----------|-------|-------------|
| `/verify` | POST | Verifiera utdrag mot Polisen |
| `/status` | GET | Kö-status (diagnostik) |
| `/stats` | GET | Aggregerad statistik |
| `/log` | GET | Verifieringslogg |

---

## POST /verify

Verifierar ett belastningsregisterutdrag mot Polisens kontrolltjänst. Kräver HMAC-signatur.

**Headers:**

| Header | Beskrivning |
|--------|-------------|
| `X-API-Key` | API-nyckel (format: `chub_...`) |
| `X-Timestamp` | Unix timestamp (sekunder). Max 60s gammalt. |
| `X-Signature` | HMAC-SHA256 av `{timestamp}.{body}` med SHA256(apiKey) som nyckel |

**Body:**

```json
{
  "arendenummer":    "12345678",
  "personnummer":    "200001011234",
  "utfardandedatum": "2025-10-21",
  "utdragstyp":      "Arbete med barn i annan verksamhet än skola och barnomsorg"
}
```

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `arendenummer` | sträng | 8 siffror |
| `personnummer` | sträng | 12 siffror (YYYYMMDDXXXX) |
| `utfardandedatum` | sträng | YYYY-MM-DD |
| `utdragstyp` | sträng | Ett av värdena nedan (exakt) |

**Giltiga utdragstyper:**

| Värde |
|-------|
| `Arbete inom skola eller förskola` |
| `Arbete med barn med funktionsnedsättning` |
| `Arbete på HVB-hem` |
| `Arbete med barn i annan verksamhet än skola och barnomsorg` |
| `Försäkringsbolag eller försäkringsförmedling` |

**Svar 200 (äkta):**

```json
{
  "authentic": true,
  "verificationNumber": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "verificationPdf": "JVBERi0xLjQK...",
  "checkedAt": "2026-02-20T07:16:04.000Z",
  "warnings": []
}
```

**Svar 200 (ej äkta — Polisen avvisar):**

```json
{
  "authentic": false,
  "verificationNumber": null,
  "verificationPdf": null,
  "checkedAt": "2026-02-20T07:16:04.000Z",
  "warnings": ["VERIFICATION_FAILED"]
}
```

**Svar 200 (ej kontrollerad — valideringsfel):**

```json
{
  "authentic": null,
  "verificationNumber": null,
  "verificationPdf": null,
  "checkedAt": "2026-02-20T07:16:04.000Z",
  "warnings": ["UNKNOWN_UTDRAGSTYP"]
}
```

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `authentic` | boolean/null | `true` = Polisen bekräftar, `false` = Polisen avvisar, `null` = ej kontrollerad (valideringsfel) |
| `verificationNumber` | sträng/null | UUID från Polisens verifikationsintyg |
| `verificationPdf` | sträng/null | Base64-kodad PDF (kontrollintyg) |
| `checkedAt` | sträng | ISO 8601 timestamp |
| `warnings` | sträng[] | Eventuella varningar |

---

## GET /status

Diagnostik — visar kö-status. Ingen autentisering krävs från dashboard.

**Svar:**

```json
{
  "service": "bgcheck",
  "queue": {
    "running": false,
    "waiting": 0,
    "maxQueue": 10
  }
}
```

---

## GET /stats

Aggregerad statistik från verifieringsloggen.

**Svar:**

```json
{
  "data": {
    "verifieringar": 5,
    "lyckade": 4,
    "misslyckade": 0,
    "fel": 1,
    "snitt_ms": 42300,
    "idag": 2,
    "ko_aktiv": false,
    "ko_vantande": 0
  }
}
```

---

## GET /log

Senaste verifieringar. Ingen PII — personnummer lagras aldrig.

**Query-parametrar:**

| Param | Typ | Default | Beskrivning |
|-------|-----|---------|-------------|
| `limit` | tal | 25 | Max antal rader (max 100) |

**Svar:**

```json
{
  "data": [
    {
      "created_at": "2026-02-20T07:16:04.000Z",
      "arendenummer": "12345678",
      "authentic": 1,
      "verification_number": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "warnings": null,
      "response_ms": 42300,
      "error_message": null,
      "key_label": "Portal BIF"
    }
  ]
}
```

---

## Felkoder

| HTTP | Orsak | Åtgärd |
|------|-------|--------|
| 400 | Saknade/ogiltiga fält | Kontrollera att alla 4 fält skickas |
| 401 | Ogiltig API-nyckel | Kontrollera `X-API-Key` |
| 401 | Ogiltig HMAC-signatur | Se felsökning nedan |
| 401 | Timestamp utgånget | Klocka synkad? Max 60s |
| 429 | Rate limit | Vänta `Retry-After` sekunder |
| 503 | Kön full (10 väntande) | Försök igen om en stund |
| 504 | Polisen timeout | polisen.se svarar inte |
| 500 | Internt fel | Kontrollera `pm2 logs compuna-hub` |

## Varningar

| Warning | Betydelse |
|---------|-----------|
| `INVALID_ARENDENUMMER` | Ej 8 siffror |
| `INVALID_PERSONNUMMER` | Ej 12 siffror |
| `INVALID_DATUM` | Ej YYYY-MM-DD |
| `UNKNOWN_UTDRAGSTYP` | Okänd utdragstyp |
| `EXPIRED` | Äldre än 1 år |
| `VERIFICATION_FAILED` | Polisen: ej äkta |
| `VERIFICATION_PDF_DOWNLOAD_FAILED` | Kunde inte ladda ned intyg |

---

## HMAC-signering

Signeringsnyckeln härleds från API-nyckeln (ingen separat hemlighet):

```
hmac_key = SHA256(api_key)
signing_string = "{timestamp}.{json_body}"
signature = HMAC-SHA256(signing_string, hmac_key)
```

**PHP-exempel:**

```php
$hmacKey = hash('sha256', $apiKey);
$payload = json_encode($fields);
$timestamp = time();
$signature = hash_hmac('sha256', "$timestamp.$payload", $hmacKey);
```

---

## Säkerhet

| Lager | Skydd |
|-------|-------|
| HTTPS | Kryptering i transit |
| API-nyckel | Autentisering + projektscoping |
| HMAC-SHA256 | Payload-integritet + replay-skydd |
| Rate limiting | Max req/min per nyckel |
| Personnummer | Aldrig i klartext — bara SHA-256-hash |
| PDF | Kastas av portalen efter parsning |
