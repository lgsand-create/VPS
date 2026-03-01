# Checklista: Ny proxy-route for Sportanalys

Anvand nar backend lagger till en ny endpoint som behover proxas genom hubben.

## Steg

- [ ] **1. Verifiera att backend-endpointen finns:**
  ```bash
  # Fran VPS (via WireGuard)
  curl -s -w "\n%{http_code}" -H "X-API-KEY: cmp-api-2026-backatorp" \
    http://10.10.10.100/api/<ny-endpoint>
  ```
  Ska ge 200 (eller 201, etc.) -- inte 404.

- [ ] **2. Lagg till route i `services/routes/sportanalys/index.js`:**
  ```javascript
  router.get('/ny-endpoint', (req, res) => proxyToBackend(req, res));
  // eller POST/PUT/DELETE beroende pa metod
  ```

- [ ] **3. (Valfritt) Lagg till i diagnostik-tester:**
  I `services/public/js/dashboard.js`, lagg till i `SA_ENDPOINT_TESTS`:
  ```javascript
  { method: 'GET', path: '/ny-endpoint', label: 'Ny endpoint' },
  ```

- [ ] **4. SFTP-upload:**
  - `services/routes/sportanalys/index.js`
  - `services/public/js/dashboard.js` (om diagnostik uppdaterad)

- [ ] **5. Starta om:**
  ```bash
  pm2 restart compuna-hub
  ```

- [ ] **6. Verifiera genom hela kedjan:**
  ```bash
  curl -s -w "\n%{http_code}" -H "Referer: https://vpn.compuna.se/" \
    https://vpn.compuna.se/api/sportanalys/<ny-endpoint>
  ```

## Hur proxyn fungerar

```
Browser --> Apache :443 --> Express :3000 --> proxyToBackend()
  --> http.request() till 10.10.10.100:80
  --> Lagger till X-API-KEY automatiskt
  --> req.pipe(proxyReq) -- streamar request body
  --> proxyRes.pipe(res) -- streamar response body
```

Querystrangar (t.ex. `?frame_start=0&frame_end=100`) skickas vidare automatiskt.
