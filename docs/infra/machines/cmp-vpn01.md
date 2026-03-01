# CT 103 -- cmp-vpn01

| Egenskap | Varde |
|----------|-------|
| Intern IP | 10.10.10.103 |
| WireGuard IP | 10.0.0.2 |
| Typ | LXC, Debian 12 |
| Roll | VPN-gateway (WireGuard) |

## Installerade paket

```
wireguard
wireguard-tools
```

## IP-forwarding

```
net.ipv4.ip_forward = 1
```

## WireGuard-config

**Fil:** `/etc/wireguard/cmp-wg0.conf`

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

```
default         via 10.10.10.1   dev eth0
10.0.0.0/24     direkt           dev cmp-wg0
10.10.10.0/24   direkt           dev eth0
```

## Funktion

Denna container ar en ren gateway -- den tar emot WireGuard-trafik fran VPS:en
och vidarebefordrar till det interna natverket (vmbr1).

Trafik fran VPS (10.0.0.1) till t.ex. cmp-web01 (10.10.10.100):

```
VPS --> wg0 --> cmp-vpn01 (10.0.0.2) --> eth0 --> vmbr1 --> cmp-web01 (10.10.10.100)
```

## Felskning

```bash
wg show                          # Visa tunnel-status
ping 10.0.0.1                    # Testa VPS-anslutning
systemctl status wg-quick@cmp-wg0  # Tjanststatus
journalctl -u wg-quick@cmp-wg0    # Loggar
```
