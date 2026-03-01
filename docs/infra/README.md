# Compuna Infrastruktur

> Dokumentation for all servrar, natverk och deployment i Compuna-plattformen.
> Anvands av Jonas + alla AI-agenter som kontext vid setup och felskning.

## Arkitektur i korthet

```
INTERNET
    |
    v
VPS (64.112.124.118) -- vpn.compuna.se
    | wg0: 10.0.0.1
    | WireGuard (UDP :51820)
    v
CT 103 cmp-vpn01 (10.0.0.2 / 10.10.10.103)
    |
--- vmbr1 (10.10.10.0/24) --------------------------------
    |              |              |              |
CT 100          CT 101        VM 104          CT 105
cmp-web01       cmp-files01   cmp-yolo01      cmp-lorawan01
.100            .101          .104 + GPU      .105
```

**VPS** hanterar all publik trafik. **Hemmaservern** (Proxmox) kor AI och lagrar data.
WireGuard kopplar ihop dem -- hemmaservern exponeras aldrig mot internet.

## Maskiner

| Maskin | IP | Typ | Roll | Dok |
|--------|-----|-----|------|-----|
| VPS | 64.112.124.118 | Ubuntu 24.04 | Publik server, Express, Apache | [vps.md](machines/vps.md) |
| cmp-prox01 | 192.168.1.250 / 10.10.10.1 | Proxmox VE 8.x | Hypervisor, gateway, NFS | [cmp-prox01.md](machines/cmp-prox01.md) |
| cmp-web01 | 10.10.10.100 | LXC CT 100 | Backend API (Nginx+PHP+MariaDB) | [cmp-web01.md](machines/cmp-web01.md) |
| cmp-files01 | 10.10.10.101 | LXC CT 101 | Fillagring (3.6 TB bind mount) | [cmp-files01.md](machines/cmp-files01.md) |
| cmp-vpn01 | 10.10.10.103 / 10.0.0.2 | LXC CT 103 | WireGuard VPN-gateway | [cmp-vpn01.md](machines/cmp-vpn01.md) |
| cmp-yolo01 | 10.10.10.104 | KVM VM 104 | YOLO ML-worker (GPU) | [cmp-yolo01.md](machines/cmp-yolo01.md) |
| cmp-lorawan01 | 10.10.10.105 | LXC CT 105 | ChirpStack LoRaWAN | [cmp-lorawan01.md](machines/cmp-lorawan01.md) |
| cmp-dev01 | 10.10.10.200 | KVM VM 200 | Dev/test (on-demand) | -- |

## Ovriga dokument

| Fil | Innehall |
|-----|----------|
| [topology.md](topology.md) | Natverkstopologi, routing, WireGuard |
| [auth.md](auth.md) | API-nycklar, autentisering, sessioner |
| [troubleshooting.md](troubleshooting.md) | Kanda problem och losningar |

## Checklistor

| Checklista | Nar |
|------------|-----|
| [deploy-vps.md](checklists/deploy-vps.md) | Deploya andring till VPS (SFTP + pm2) |
| [new-container.md](checklists/new-container.md) | Skapa ny LXC-container i Proxmox |
| [new-proxy-route.md](checklists/new-proxy-route.md) | Lagga till ny proxy-route pa VPS |
| [gpu-passthrough.md](checklists/gpu-passthrough.md) | GPU passthrough till VM |
| [wireguard-debug.md](checklists/wireguard-debug.md) | Felsok WireGuard-tunnel |

## For agenter

Nar du far ett uppdrag som berr denna infrastruktur:

1. Las **README.md** (denna fil) for oversikt
2. Las relevant **maskin-fil** for detaljer om den specifika servern
3. Folj relevant **checklista** for deployment/setup
4. Uppdatera **troubleshooting.md** om du hittar nya problem/losningar
