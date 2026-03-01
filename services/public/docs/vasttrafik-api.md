# Västtrafik API

Realtidsavgångar och förseningsstatistik från Västtrafiks Planera Resa v4.

## Autentisering

Alla `/api/vasttrafik/`-endpoints kräver API-nyckel (`X-API-Key` header).
PWA-endpoints under `/api/avg/` är öppna (ingen auth).

## Endpoints

### Hållplatser

| Metod | Endpoint | Beskrivning |
|-------|----------|-------------|
| GET | `/api/vasttrafik/stops` | Lista alla hållplatser |
| POST | `/api/vasttrafik/stops` | Lägg till hållplats |
| PUT | `/api/vasttrafik/stops/:id` | Uppdatera hållplats |
| DELETE | `/api/vasttrafik/stops/:id` | Ta bort hållplats |
| POST | `/api/vasttrafik/stops/search` | Sök hållplatser via Västtrafik API |
| POST | `/api/vasttrafik/stops/:id/test` | Testa hämta avgångar |
| POST | `/api/vasttrafik/stops/test-api` | Testa API-anslutning |

### Avgångar

| Metod | Endpoint | Beskrivning |
|-------|----------|-------------|
| GET | `/api/vasttrafik/departures` | Filtrerade avgångar från DB |
| GET | `/api/vasttrafik/departures/live` | Realtid från memory-cache |
| GET | `/api/vasttrafik/departures/delays` | Förseningsstatistik |

### Statistik

| Metod | Endpoint | Beskrivning |
|-------|----------|-------------|
| GET | `/api/vasttrafik/stats` | Sammanfattning |

### PWA (öppna)

| Metod | Endpoint | Beskrivning |
|-------|----------|-------------|
| GET | `/api/avg/stops` | Aktiva hållplatser |
| GET | `/api/avg/stops/search?q=` | Sök hållplatser |
| GET | `/api/avg/departures?stop=X` | Avgångar (cache) |
| GET | `/api/avg/push/vapid-key` | VAPID public key |
| POST | `/api/avg/push/subscribe` | Registrera push |
| POST | `/api/avg/push/unsubscribe` | Avregistrera push |

## Exempel

### Lägg till hållplats

```bash
curl -X POST http://localhost:3000/api/vasttrafik/stops \
  -H "X-API-Key: chub_..." \
  -H "Content-Type: application/json" \
  -d '{"id":"skogome","name":"Skogome, Göteborg","stop_area_gid":"9022014006520001"}'
```

### Sök hållplatser

```bash
curl -X POST http://localhost:3000/api/vasttrafik/stops/search \
  -H "X-API-Key: chub_..." \
  -H "Content-Type: application/json" \
  -d '{"query":"skogome"}'
```

### Hämta realtidsavgångar

```bash
curl http://localhost:3000/api/avg/departures?stop=skogome
```
