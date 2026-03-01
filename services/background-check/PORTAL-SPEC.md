# Bakgrundskontroll — Integrationsspec för portal

Specifikation för att integrera bakgrundskontroll av belastningsregisterutdrag
i portal.backatorpif.se (eller annan PHP-portal).

---

## 1. Översikt

Portalen tar emot en PDF (belastningsregisterutdrag från Polisen),
extraherar 4 fält, signerar anropet och skickar till Compuna Hub.
Hub:en verifierar utdraget mot Polisens kontrolltjänst och returnerar
ett officiellt verifikationsintyg (PDF med UUID).

```
Användare → Portal (PHP) → Compuna Hub (Node.js) → polisen.se
                                    ↓
                              Verifikations-PDF
                                    ↓
                              Portal visar resultat
```

---

## 2. Vad portalen behöver

### Systemkrav
- PHP 7.4+ (rekommenderat 8.x)
- `pdftotext` (CLI) — ingår i `poppler-utils` (`apt install poppler-utils`)
- cURL-extension (standard i PHP)

### Konfiguration (spara säkert, t.ex. i config-tabell eller .env)
- `BGCHECK_API_KEY` — API-nyckel från Compuna Hub (format: `chub_...`)
- `BGCHECK_API_URL` — `http://localhost:3000/api/bgcheck` (samma VPS)

Ingen separat HMAC-hemlighet. Signeringsnyckeln härleds från API-nyckeln.

---

## 3. Steg-för-steg: Vad portalen gör

### Steg 1: PDF → text → 4 fält

```php
// Spara uppladdad PDF temporärt
$tmpFile = tempnam(sys_get_temp_dir(), 'bgcheck_');
move_uploaded_file($_FILES['pdf']['tmp_name'], $tmpFile);

// Extrahera text med pdftotext
$text = shell_exec("pdftotext -layout " . escapeshellarg($tmpFile) . " -");

// Ta bort PDF direkt — lagra den aldrig
unlink($tmpFile);

// Extrahera fält med regex
preg_match('/Ärendenummer\s+(\d{8})/', $text, $m1);
$arendenummer = $m1[1] ?? null;

preg_match('/Personnummer\s+(\d{8})-?(\d{4})/', $text, $m2);
$personnummer = ($m2[1] ?? '') . ($m2[2] ?? '');  // YYYYMMDDXXXX utan bindestreck

preg_match('/Utfärdandedatum\s+(\d{4}-\d{2}-\d{2})/', $text, $m3);
$utfardandedatum = $m3[1] ?? null;

preg_match('/Utdrag för\s+(.+)/u', $text, $m4);
$utdragstyp = trim($m4[1] ?? '');

// Kontrollera att resultatmeningen finns (lokal pre-check)
$hasRecord = (stripos($text, 'inga uppgifter att redovisa') === false);
```

### Steg 2: Lokal validering (innan API-anrop)

```php
// Kontrollera att alla fält extraherades
if (!$arendenummer || !$personnummer || !$utfardandedatum || !$utdragstyp) {
    // Visa felmeddelande: "Kunde inte läsa PDFen. Kontrollera att det är ett giltigt registerutdrag."
    return;
}

// Kontrollera giltighet (utdrag gäller 1 år)
$issued  = new DateTime($utfardandedatum);
$expires = (clone $issued)->modify('+1 year');
if (new DateTime() > $expires) {
    // Visa: "Utdraget har gått ut (utfärdat {$utfardandedatum}). Be personen beställa ett nytt."
    return;
}

// Kontrollera personnummerformat (YYYYMMDDXXXX = 12 siffror)
if (!preg_match('/^\d{12}$/', $personnummer)) {
    // Visa: "Ogiltigt personnummer i utdraget."
    return;
}
```

### Steg 3: Signera och skicka

```php
$apiKey = getenv('BGCHECK_API_KEY');   // 'chub_...'
$apiUrl = getenv('BGCHECK_API_URL');   // 'http://localhost:3000/api/bgcheck'

// HMAC-nyckel = SHA-256 av API-nyckeln (båda sidor beräknar samma)
$hmacKey = hash('sha256', $apiKey);

// Payload
$payload = json_encode([
    'arendenummer'    => $arendenummer,
    'personnummer'    => $personnummer,
    'utfardandedatum' => $utfardandedatum,
    'utdragstyp'      => $utdragstyp,
]);

// Timestamp + signatur
$timestamp = time();
$signature = hash_hmac('sha256', "$timestamp.$payload", $hmacKey);

// cURL-anrop
$ch = curl_init("$apiUrl/verify");
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        "X-API-Key: $apiKey",
        "X-Timestamp: $timestamp",
        "X-Signature: $signature",
    ],
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);
```

### Steg 4: Hantera svaret

```php
if ($httpCode !== 200) {
    // Felhantering — se sektion 5 nedan
    $error = json_decode($response, true);
    logBgcheck($arendenummer, $personnummer, null, $error['error'] ?? 'Okänt fel');
    return;
}

$result = json_decode($response, true);

// Spara verifikations-PDFen (om äkta)
$verificationPdfPath = null;
if ($result['authentic'] && $result['verificationPdf']) {
    $pdfData = base64_decode($result['verificationPdf']);
    // Spara i en skyddad katalog (inte publikt tillgänglig)
    $verificationPdfPath = "/path/to/secure/bgcheck/{$arendenummer}.pdf";
    file_put_contents($verificationPdfPath, $pdfData);
}

// Logga i DB
logBgcheck(
    $arendenummer,
    $personnummer,
    $result['authentic'],
    null,  // inget fel
    $result['verificationNumber'],
    $result['checkedAt']
);
```

---

## 4. API-referens

### POST /api/bgcheck/verify

**Request:**
```
POST http://localhost:3000/api/bgcheck/verify
Content-Type: application/json
X-API-Key: chub_abc123...
X-Timestamp: 1708412164
X-Signature: a3f2b8c9d4e5f6...

{
  "arendenummer":    "12345678",
  "personnummer":    "200001011234",
  "utfardandedatum": "2025-10-21",
  "utdragstyp":      "Arbete med barn i annan verksamhet än skola och barnomsorg"
}
```

**Response 200 (äkta):**
```json
{
  "authentic":          true,
  "verificationNumber": "46024dca-6a05-43f5-89d0-8996abd9e544",
  "verificationPdf":    "JVBERi0xLjQK...",
  "checkedAt":          "2026-02-20T07:16:04.000Z",
  "warnings":           []
}
```

**Response 200 (ej äkta):**
```json
{
  "authentic":          false,
  "verificationNumber": null,
  "verificationPdf":    null,
  "checkedAt":          "2026-02-20T07:16:04.000Z",
  "warnings":           ["VERIFICATION_FAILED"]
}
```

**Fältbeskrivningar:**

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `authentic` | boolean | `true` = Polisen bekräftar att utdraget är äkta |
| `verificationNumber` | string\|null | UUID från Polisens verifikationsintyg |
| `verificationPdf` | string\|null | Base64-kodad PDF (Polisens kontrollintyg) |
| `checkedAt` | string | ISO 8601 timestamp för kontrollen |
| `warnings` | string[] | Eventuella varningar (se sektion 6) |

### GET /api/bgcheck/status

**Request:**
```
GET http://localhost:3000/api/bgcheck/status
X-API-Key: chub_abc123...
```

**Response 200:**
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

## 5. Felkoder

| HTTP | Orsak | Åtgärd |
|------|-------|--------|
| 400 | Saknade/ogiltiga fält i body | Kontrollera att alla 4 fält skickas korrekt |
| 401 | Ogiltig API-nyckel | Kontrollera `X-API-Key` |
| 401 | Ogiltig HMAC-signatur | Kontrollera signeringslogiken (se sektion 7) |
| 401 | Timestamp utgånget | Kontrollera klocka — max 60s gammalt |
| 403 | Ej localhost | Anropet måste komma från samma server |
| 429 | Rate limit | Vänta `Retry-After` sekunder |
| 503 | Kön full (10 väntande) | Försök igen om en stund |
| 504 | Polisens tjänst timeout | Försök igen — polisen.se kan vara trög |
| 500 | Internt serverfel | Kontrollera Hub-loggar (`pm2 logs compuna-hub`) |

---

## 6. Warnings

Varningar i `warnings[]`-arrayen:

| Warning | Betydelse |
|---------|-----------|
| `INVALID_ARENDENUMMER` | Ärendenummer ej 8 siffror |
| `INVALID_PERSONNUMMER` | Personnummer ej 12 siffror |
| `INVALID_DATUM` | Datumformat ej YYYY-MM-DD |
| `UNKNOWN_UTDRAGSTYP` | Utdragstypen kunde inte matchas |
| `EXPIRED` | Utdraget är äldre än 1 år |
| `VERIFICATION_FAILED` | Polisen svarade att utdraget INTE är äkta |
| `VERIFICATION_PDF_DOWNLOAD_FAILED` | Kunde inte ladda ned verifikationsintyg |

---

## 7. Felsökning: HMAC-signering

Om signaturen avvisas (401), verifiera varje steg:

```php
// 1. API-nyckeln (exakt, inga mellanslag/newlines)
$apiKey = trim(getenv('BGCHECK_API_KEY'));

// 2. HMAC-nyckeln (SHA-256 hex av API-nyckeln)
$hmacKey = hash('sha256', $apiKey);
// Skriv ut och jämför med Hub:ens key_hash i DB: SELECT key_hash FROM api_keys WHERE ...

// 3. Payload (måste vara identisk byte-för-byte med body)
$payload = json_encode($fields);
// Viktigt: json_encode UTAN JSON_PRETTY_PRINT

// 4. Signing-strängen
$timestamp = time();
$signingString = "$timestamp.$payload";
// Kontrollera: exakt en punkt mellan timestamp och payload, inga mellanslag

// 5. Signaturen
$signature = hash_hmac('sha256', $signingString, $hmacKey);

// Test: Kör detta isolerat och jämför med Hub:ens logg
echo "hmacKey:   $hmacKey\n";
echo "signing:   $signingString\n";
echo "signature: $signature\n";
```

---

## 8. DB-tabell: bgcheck_log

Portalen bör logga alla kontroller. Förslag på tabell:

```sql
CREATE TABLE IF NOT EXISTS bgcheck_log (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    arendenummer      VARCHAR(20) NOT NULL,
    pnr_hash          VARCHAR(64) NOT NULL,
    utfardandedatum   DATE NOT NULL,
    has_record        TINYINT(1) DEFAULT NULL,
    authentic         TINYINT(1) DEFAULT NULL,
    verification_id   VARCHAR(64) DEFAULT NULL,
    warnings          TEXT DEFAULT NULL,
    performed_by      INT NOT NULL,
    response_ms       INT DEFAULT NULL,
    error_message     TEXT DEFAULT NULL,
    created_at        DATETIME DEFAULT NOW(),

    INDEX idx_arendenummer (arendenummer),
    INDEX idx_performed_by (performed_by),
    INDEX idx_created (created_at)
);
```

**Viktigt:** `pnr_hash` = SHA-256 av personnummer. Aldrig personnummer i klartext.

```php
function logBgcheck($arendenummer, $personnummer, $authentic, $error = null, $verificationId = null, $checkedAt = null) {
    $pnrHash = hash('sha256', $personnummer);
    // INSERT INTO bgcheck_log ...
}
```

---

## 9. Admin-sida: Belastningsregisterhantering

### 9.1 Anslutning
- Visa konfigurerad URL + maskerad API-nyckel
- **Testa anslutning**: `GET /api/bgcheck/status` — visar kö-status
- **Testa med PDF**: Fullständigt flöde med testuppladdning

### 9.2 Kontroller (logg)
- Tabell med senaste kontroller ur `bgcheck_log`
- Kolumner: Datum, Ärendenummer, Resultat (✓/✗), Utförd av
- Klickbar rad → detaljvy med warnings, svarstid, verifikations-ID
- Möjlighet att ladda ned sparat kontrollintyg

### 9.3 Felsökning
- Senaste lyckade kontroll
- Senaste fel med felmeddelande
- Länk till Hub-loggar (eller inline-visning)

---

## 10. Säkerhetsöversikt

| Skydd | Ansvarig |
|-------|----------|
| HTTPS (användare → portal) | Portal/webbserver |
| API-nyckel (portal → Hub) | Compuna Hub |
| HMAC-signatur (payload-integritet) | Båda sidor |
| Localhost-begränsning | Compuna Hub |
| Rate limiting (10 req/min) | Compuna Hub |
| Ingen PII i loggar | Båda sidor |
| PDF kastas efter parsing | Portal |
| Verifikations-PDF utan personnummer | Polisen |

---

## 11. Testflöde

Före produktionssättning:

1. **Generera API-nyckel** i Hub-dashboarden (projekt: bgcheck, rate_limit: 10)
2. **Konfigurera** portalen med nyckeln
3. **Testa anslutning** → `GET /status` ska returnera `{ service: "bgcheck" }`
4. **Testa med riktig PDF** → verifiera att `authentic: true` returneras
5. **Testa med maniperad data** → verifiera att `authentic: false` eller 401 returneras
6. **Kontrollera logg** → `bgcheck_log` ska ha rätt data, aldrig personnummer i klartext
