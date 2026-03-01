# CT 105 -- cmp-lorawan01

| Egenskap | Varde |
|----------|-------|
| IP | 10.10.10.105 |
| Typ | LXC, Debian 12 |
| Resurser | 2 cores, 4 GB RAM, 20 GB disk |
| Roll | ChirpStack LoRaWAN Network Server |
| Status | Uppsatt 2026-02-25 |

## Installerade paket

```
postgresql                   # ChirpStack kraver PostgreSQL (ej MariaDB)
redis-server
mosquitto, mosquitto-clients # MQTT broker
chirpstack                   # v4, via officiell APT-repo
chirpstack-gateway-bridge
apt-transport-https, dirmngr
curl, wget, vim
```

## PostgreSQL

```sql
CREATE ROLE chirpstack WITH LOGIN PASSWORD '<losenord>';
CREATE DATABASE chirpstack WITH OWNER chirpstack;
CREATE DATABASE chirpstack_integration WITH OWNER chirpstack;
```

## ChirpStack

**Fil:** `/etc/chirpstack/chirpstack.toml`

```toml
[logging]
level = "info"

[postgresql]
dsn = "postgres://chirpstack:<losenord>@localhost/chirpstack?sslmode=disable"

[redis]
servers = ["redis://localhost/"]

[network]
net_id = "000000"
enabled_regions = ["eu868"]

[api]
bind = "0.0.0.0:8080"
secret = "<genererad-hemlighet>"

[integration]
enabled = ["mqtt"]

[integration.mqtt]
server = "tcp://localhost:1883/"
```

## Gateway Bridge

**Fil:** `/etc/chirpstack-gateway-bridge/chirpstack-gateway-bridge.toml`

EU868 topic prefix konfigurerat.

## Tjanster

```bash
systemctl enable --now chirpstack
systemctl enable --now chirpstack-gateway-bridge
systemctl enable --now mosquitto
systemctl enable --now postgresql
systemctl enable --now redis-server
```

## Portar

| Port | Tjanst |
|------|--------|
| 8080/tcp | ChirpStack webb-GUI |
| 1700/udp | LoRa Gateway Bridge (packet forwarder) |
| 1883/tcp | MQTT (Mosquitto) |
| 5432/tcp | PostgreSQL |
| 6379/tcp | Redis |

## Webb-GUI

```
URL:  http://10.10.10.105:8080
Auth: admin / admin (byt vid forsta inloggning)
```

Narbart via SSH-tunnel eller direkt fran Proxmox-natverket.

## Vanliga kommandon

```bash
systemctl status chirpstack
journalctl -u chirpstack -f
systemctl status chirpstack-gateway-bridge
systemctl status mosquitto
systemctl status postgresql
systemctl status redis-server
```

## Anteckningar

- ChirpStack kraver PostgreSQL -- MariaDB funkar inte
- Redis anvands for device session storage och deduplication
- MQTT ar broker for gateway <--> ChirpStack kommunikation
- APT-repo nyckel: anvand `gpg --dearmor` + `/etc/apt/keyrings/` (nytt format)
