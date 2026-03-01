# Checklista: Felsok WireGuard-tunnel

Anvand nar VPS inte kan na interna maskiner (10.10.10.x).

## Snabbtest

```bash
# Fran VPS:
ping 10.0.0.2            # WireGuard peer (cmp-vpn01)
ping 10.10.10.100        # cmp-web01 (genom tunnel + routing)
curl http://10.10.10.100/api/health   # Backend-API
```

## Steg-for-steg felskning

### 1. Ar tunneln uppe? (VPS)

```bash
wg show
```

Forvantat: senaste handshake < 2 minuter, TX/RX bytes okar.
Om ingen handshake: peer-konfigurationen ar fel.

### 2. Ar tunneln uppe? (Hemsida -- CT 103)

```bash
# Pa Proxmox:
pct enter 103
wg show
```

### 3. Kan VPS na peer?

```bash
# Fran VPS:
ping 10.0.0.2
```

Om timeout:
- Kontrollera UFW pa VPS: `ufw status` (port 51820/udp maste vara oppen)
- Kontrollera att hemmaservern har internet (router, ISP)
- PersistentKeepalive: 25 bor finnas pa hemsidan

### 4. Kan VPS na interna maskiner?

```bash
# Fran VPS:
ping 10.10.10.100
```

Om timeout men 10.0.0.2 svarar:
- **Routing pa VPS:** `ip route | grep 10.10.10` -- ska visa `via 10.0.0.2 dev wg0`
- **IP-forwarding pa CT 103:** `sysctl net.ipv4.ip_forward` -- ska vara 1
- **Return-route pa Proxmox:** `ip route | grep 10.0.0` -- ska visa `via 10.10.10.103`

### 5. Return-route saknas (vanligaste felet)

Pa Proxmox-hosten:
```bash
ip route add 10.0.0.0/24 via 10.10.10.103
```

For permanent: lagg till i `/etc/network/interfaces`:
```
post-up ip route add 10.0.0.0/24 via 10.10.10.103
```

### 6. Starta om WireGuard

```bash
# Pa CT 103:
systemctl restart wg-quick@cmp-wg0

# Pa VPS:
systemctl restart wg-quick@cmp-wg0
```

## Vanliga orsaker till avbrott

| Orsak | Symptom | Losning |
|-------|---------|---------|
| ISP-avbrott hemma | Alla 10.x timeout | Vanta / starta om router |
| Proxmox reboot | Return-route borta | Lagg till post-up i interfaces |
| CT 103 stoppad | Tunnel nere | `pct start 103` |
| VPS reboot | Tunnel nere | `systemctl start wg-quick@cmp-wg0` |
