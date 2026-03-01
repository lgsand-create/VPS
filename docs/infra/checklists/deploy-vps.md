# Checklista: Deploy till VPS

Anvand vid andring av filer i `services/` som ska till VPS:en.

## Forutsattningar

- VSCode med SFTP-extension (Natizyskunk.sftp)
- PuTTY SSH till VPS

## Steg

- [ ] **1. Redigera lokalt** -- gora alla andringat i VSCode
- [ ] **2. SFTP-upload** -- hogerklicka pa fil(er) --> Upload
  - Kontrollera att ratt filer laddas upp (inte .env eller node_modules)
- [ ] **3. Verifiera pa VPS** (PuTTY):
  ```bash
  # Kolla att filen finns och ar uppdaterad
  ls -la /var/www/web-tests/services/<sokvag-till-fil>
  ```
- [ ] **4. Om DB-migrering behovs:**
  ```bash
  cd /var/www/web-tests/services
  npm run migrate
  ```
- [ ] **5. Starta om:**
  ```bash
  pm2 restart compuna-hub
  ```
- [ ] **6. Verifiera:**
  ```bash
  pm2 logs compuna-hub --lines 20
  ```
  Kontrollera att inga felmeddelanden syns.
- [ ] **7. Testa i webblasaren** -- ladda om dashboarden / testa berord endpoint

## Vanliga misstag

| Misstag | Symptom | Losning |
|---------|---------|---------|
| Glommer SFTP-upload | Gammal kod kors | Kolla filens tidsstampel pa VPS |
| Skriver `compuna-hu` | PM2 hittar inte processen | Skriv `compuna-hub` (med b) |
| Ny migration ej uppladdad | DB-tabell/kolumn saknas | SFTP-ladda upp .sql-filen forst |
| Browsern cachar JS | Ny kod syns inte | Ctrl+Shift+R (hard refresh) |

## ALDRIG

- Git pa VPS -- ingen git-repo dar
- `mysql -u root -p` -- Jonas har inte root-losenord
- Redigera filer direkt pa VPS -- redigera lokalt, ladda upp
