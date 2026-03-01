# Kanda problem och losningar

## Natverk

| Problem | Orsak | Losning |
|---------|-------|---------|
| 100% packet loss VPS --> 10.10.10.x | Proxmox saknar return-route for WireGuard | `ip route add 10.0.0.0/24 via 10.10.10.103` pa Proxmox. Permanent: `post-up` i `/etc/network/interfaces` |
| WireGuard ingen handshake | Peer-config fel, eller ISP-avbrott | Kolla `wg show` pa bada sidor. Se [wireguard-debug.md](checklists/wireguard-debug.md) |
| Timeout mot backend | WireGuard nere eller routing trasig | Testa steg-for-steg: `ping 10.0.0.2` --> `ping 10.10.10.100` --> `curl health` |

## Upload / Sportanalys

| Problem | Orsak | Losning |
|---------|-------|---------|
| Upload 400 "No video file" | PHP `post_max_size` for liten (default 8 MB) | Skapa `99-uploads.ini` med 5120M limits |
| Upload 500 "Failed to save file" | Bind mount dir ags av nobody:nogroup | `chmod 777` pa katalogerna fran Proxmox-hosten |
| express.json() stor uploads | Body parser konsumerar stream | Explicit bypass i server.js for sportanalys upload |
| Coach app 401 "Ogiltig API-nyckel" | Backend-nyckel != Hub-nyckel | Skapa `chub_...`-nyckel via dashboard. Migration 034 kravs for FK |
| `<video>` 404/401 fran annan doman | Kan inte skicka X-API-Key header | Anvand `?api_key=chub_...` query parameter |

## Dashboard

| Problem | Orsak | Losning |
|---------|-------|---------|
| "Kunde inte skapa API-nyckel" | Projekt saknas i `projects`-tabellen (FK) | Skapa migration med `INSERT IGNORE INTO projects` |
| Knapp gor inget (inga fel) | Browsern cachar gammal JS | `Ctrl+Shift+R` eller incognito-fonster |
| Resultatvy visar inget | Section ar i gomd tab | `switchSaTab()` maste anropas forst |

## GPU / YOLO

| Problem | Orsak | Losning |
|---------|-------|---------|
| GPU-hang vid VM-start | Framebuffer-konflikt | `video=efifb:off` i GRUB, koppla ur monitor fran GPU |
| VM startar inte med GPU | IOMMU-konfiguration | Kontrollera `intel_iommu=on iommu=pt` i GRUB, kolla IOMMU-grupper |
| nvidia-smi "failed to initialize" | Fel driver-version | `sudo apt install nvidia-driver-570`, reboot |

## NFS

| Problem | Orsak | Losning |
|---------|-------|---------|
| NFS i unprivileged CT | Kernel-modul saknas | Kor NFS fran Proxmox-hosten istallet |
| Permission denied pa /data | Bind mount rattigheter | `chmod 777` eller `no_root_squash` i exports |

## PM2 / Deploy

| Problem | Orsak | Losning |
|---------|-------|---------|
| `compuna-hu not found` | Stavfel i pm2-kommando | Skriv `compuna-hub` (med b) |
| Andring syns inte | Glom SFTP-upload | Kolla filens tidsstampel: `ls -la <fil>` |
| Migration misslyckas | SQL-syntax / redan kord | Skriv idempotenta SQL (`IF NOT EXISTS`, `INSERT IGNORE`) |

## ChirpStack / LoRaWAN

| Problem | Orsak | Losning |
|---------|-------|---------|
| ChirpStack APT repo-nyckel | Keyring-format andrades | Anvand `gpg --dearmor` + `/etc/apt/keyrings/` |
| CT kan inte skapa WireGuard tun-device | Unprivileged container | Privileged container + cgroup device allow |

---

*Uppdatera denna fil nar nya problem/losningar upptacks.*
