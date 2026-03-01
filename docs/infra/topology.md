# Natverkstopologi

## Oversikt

```
INTERNET (Cloudflare DNS)
    |
    v
VPS 64.112.124.118 (HostUp)
    | Apache :443 (SSL) --> Express :3000
    | WireGuard wg0: 10.0.0.1
    | UDP :51820
    |
=== WireGuard-tunnel (krypterad) ===
    |
    v
CT 103 cmp-vpn01
    | wg: 10.0.0.2
    | eth0: 10.10.10.103
    |
--- vmbr1: 10.10.10.0/24 --------------------------------
    |              |              |              |
CT 100          CT 101        VM 104          CT 105
cmp-web01       cmp-files01   cmp-yolo01      cmp-lorawan01
10.10.10.100    10.10.10.101  10.10.10.104    10.10.10.105
Nginx+PHP+DB    3.6 TB data   GPU (5060 Ti)   ChirpStack/LoRa
    |              |              |
--- delad: /mnt/storage (3.6 TB, Proxmox host) ---

VM 200 cmp-dev01 (10.10.10.200) -- on-demand, startas manuellt

Gateway: cmp-prox01 (10.10.10.1 / 192.168.1.250)
Hemnatverk: UniFi Gateway (192.168.1.1)
```

## IP-adresser

| Maskin | LAN IP | Intern IP | WireGuard IP |
|--------|--------|-----------|-------------|
| VPS | 64.112.124.118 | - | 10.0.0.1 |
| cmp-prox01 | 192.168.1.250 | 10.10.10.1 | - |
| cmp-web01 | - | 10.10.10.100 | - |
| cmp-files01 | - | 10.10.10.101 | - |
| cmp-vpn01 | - | 10.10.10.103 | 10.0.0.2 |
| cmp-yolo01 | - | 10.10.10.104 | - |
| cmp-lorawan01 | - | 10.10.10.105 | - |
| cmp-dev01 | - | 10.10.10.200 | - (on-demand) |

## Portar (interna tjanster)

| Port | Tjanst | Maskin |
|------|--------|--------|
| 80/tcp | Nginx (PHP API) | cmp-web01 |
| 3306/tcp | MariaDB | cmp-web01 |
| 8080/tcp | ChirpStack UI | cmp-lorawan01 |
| 1700/udp | LoRa Gateway Bridge | cmp-lorawan01 |
| 1883/tcp | MQTT (Mosquitto) | cmp-lorawan01 |
| 5432/tcp | PostgreSQL | cmp-lorawan01 |

## Natverksbryggor (Proxmox)

Konfigureras i `/etc/network/interfaces` pa cmp-prox01.

| Brygga | Nat | Funktion |
|--------|-----|----------|
| vmbr0 | 192.168.1.0/24 | LAN (externt, till router) |
| vmbr1 | 10.10.10.0/24 | Intern (alla containers/VMs) |

## WireGuard

### VPS-sida (`/etc/wireguard/cmp-wg0.conf`)

```ini
[Interface]
Address = 10.0.0.1/24
ListenPort = 51820
PrivateKey = <VPS_PRIVATE_KEY>

[Peer]
PublicKey = <HOME_PUBLIC_KEY>
AllowedIPs = 10.0.0.2/32, 10.10.10.0/24
```

### Hemsida CT 103 (`/etc/wireguard/cmp-wg0.conf`)

```ini
[Interface]
Address = 10.0.0.2/24
PrivateKey = <HOME_PRIVATE_KEY>

[Peer]
PublicKey = <VPS_PUBLIC_KEY>
Endpoint = 64.112.124.118:51820
AllowedIPs = 10.0.0.1/32
PersistentKeepalive = 25
```

## Routing

### VPS

```
10.10.10.0/24 via 10.0.0.2 dev wg0
```

VPS kan na alla interna maskiner genom WireGuard-tunneln.

### cmp-prox01

```
default         via 192.168.1.1    dev vmbr0
10.10.10.0/24   direkt             dev vmbr1
10.0.0.0/24     via 10.10.10.103   dev vmbr1    # Return-route for WireGuard
```

Return-routen ar kritisk -- utan den kan interna maskiner inte svara pa trafik fran VPS.
Konfigurerad som `post-up` i `/etc/network/interfaces`.

### cmp-vpn01 (CT 103)

```
default         via 10.10.10.1   dev eth0
10.0.0.0/24     direkt           dev cmp-wg0
10.10.10.0/24   direkt           dev eth0
```

IP-forwarding ar aktiverat: `net.ipv4.ip_forward = 1`

### Alla containers (CT 100, 101)

```
default via 10.10.10.1 (cmp-prox01)
```

## NAT

Proxmox-hosten kor NAT for att ge interna maskiner internetaccess:

```bash
iptables -t nat -A POSTROUTING -s 10.10.10.0/24 -o vmbr0 -j MASQUERADE
```

## DNS

| Doman | Pekar pa | Cloudflare | SSL |
|-------|----------|-----------|-----|
| vpn.compuna.se | 64.112.124.118 | DNS-only | Let's Encrypt |
| api.compuna.se | 64.112.124.118 | Proxied | Planerad -- ej konfigurerad an |

## Portar (VPS UFW)

```
22/tcp    SSH
80/tcp    HTTP
443/tcp   HTTPS
9090/tcp  Cockpit
51820/udp WireGuard
```

## Dataflode: Upload till analys

```
1. Tranare POST /api/sportanalys/upload (max 5 GB)
2. Apache :443 --> Express :3000 (body parser bypass)
3. Express pipe() --> 10.10.10.100:80 (genom WireGuard)
4. PHP sparar video till /data/videos/uploads/
5. cmp-yolo01 pollar /api/jobs?status=pending
6. GPU-processning (YOLO + ByteTrack, ~15 FPS)
7. Resultat sparas till /data/videos/results/job_{id}/
8. Tranare hamtar resultat via GET /tracking, /stats, /result
```
