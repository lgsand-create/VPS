# CT 100 -- cmp-web01

| Egenskap | Varde |
|----------|-------|
| IP | 10.10.10.100 |
| Typ | LXC, unprivileged, Debian 12 |
| Gateway | 10.10.10.1 |
| Resurser | 2 cores, 1 GB RAM |
| Roll | Backend API-server (Sportanalys) |
| Bind mount | /data --> /mnt/storage (fran Proxmox) |

## Installerade paket

```
nginx                   # 1.22.1 -- webbserver
php8.2-fpm              # PHP FastCGI
php8.2-mysqlnd          # MySQL-stod for PHP
mariadb-server          # 10.x -- databas
mariadb-client          # Klientverktyg
```

## Databas: MariaDB

```
Databas:    compuna_sportanalys
Anvandare:  sportanalys / cmp-sa-2026!

Tabeller:
  jobs      -- id, status, original_filename, stored_filename, file_size,
               match_home, match_away, match_date, match_half, model,
               progress, error_message, created_at, started_at, completed_at
  results   -- id, job_id, result_type, filename, data
  api_keys  -- enkel nyckelvalidering
```

## Nginx-konfiguration

**Fil:** `/etc/nginx/sites-enabled/api`

```nginx
server {
    listen 80;
    server_name api.compuna.se _;
    root /var/www/api/public;
    index index.php;

    client_max_body_size 5G;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_read_timeout 600;
    }
}
```

## PHP-limits

**Fil:** `/etc/php/8.2/fpm/conf.d/99-uploads.ini`

```ini
upload_max_filesize = 5120M
post_max_size = 5120M
max_execution_time = 600
max_input_time = 600
```

## API-endpoints

Auth: `X-API-KEY: cmp-api-2026-backatorp`

| Metod | Endpoint | Beskrivning |
|-------|----------|-------------|
| GET | /api/health | Halsokontroll |
| POST | /api/upload | Videouppladdning (multipart, max 5 GB) |
| GET | /api/jobs | Lista jobb (?status=filter) |
| GET | /api/jobs/{id}/status | Jobbstatus + progress |
| GET | /api/jobs/{id}/result | Tracking + stats JSON |
| GET | /api/jobs/{id}/tracking | Frame-data (?frame_start, frame_end) |
| GET | /api/jobs/{id}/video | Videostreaming (Range-stod) |
| GET | /api/jobs/{id}/stats | Per-spelare statistik |
| GET | /api/jobs/{id}/players | Track-ID till lag/farg-mapping |
| POST | /api/jobs/{id}/progress | Worker --> uppdatera progress |
| POST | /api/jobs/{id}/complete | Worker --> markera klart |
| POST | /api/jobs/{id}/fail | Worker --> markera misslyckat |
| GET | /api/annotations/{id} | Hamta ritningar |
| POST | /api/annotations/{id} | Skapa ritning |
| PUT | /api/annotations/{id} | Uppdatera ritning |

## Applikationsfiler

```
/var/www/api/public/index.php          # Huvudrouter
/var/www/api/public/extra-routes.php   # Utokade routes
/var/www/api/config/db.php             # Databasconfig
```

## Storage (bind mount)

```
/data/videos/uploads/                  # Uppladdade videor
/data/videos/processing/               # Under bearbetning
/data/videos/results/job_{id}/         # tracking.json, stats.json, players.json
```
