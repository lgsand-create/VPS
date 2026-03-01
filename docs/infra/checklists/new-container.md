# Checklista: Skapa ny LXC-container i Proxmox

## Forutsattningar

- Tillgang till Proxmox webb-GUI (https://192.168.1.250:8006)
- Bestam: hostname, IP, resurser, bind mounts

## Steg

- [ ] **1. Valj nasta CT-ID**
  Nuvarande: CT 100, 101, 103. Nasta lediga: CT 102 eller 105+.

- [ ] **2. Skapa container via GUI**
  - Template: Debian 12 (eller Ubuntu)
  - Hostname: `cmp-<namn>`
  - Network: `vmbr1`, IP `10.10.10.<X>/24`, Gateway `10.10.10.1`
  - Unprivileged: Ja (om inte GPU/kernel-modul behovs)

- [ ] **3. Starta och logga in:**
  ```bash
  pct start <ID>
  pct enter <ID>
  ```

- [ ] **4. Grundkonfiguration:**
  ```bash
  apt update && apt upgrade -y
  ```

- [ ] **5. Testa natverk:**
  ```bash
  ping 10.10.10.1          # Gateway (Proxmox)
  ping 10.10.10.100        # cmp-web01
  ping 8.8.8.8             # Internet (via NAT)
  ```

- [ ] **6. (Om bind mount behovs) -- Lagg till i container-config:**
  ```
  # Pa Proxmox-hosten:
  nano /etc/pve/lxc/<ID>.conf
  # Lagg till:
  mp0: /mnt/storage,mp=/data
  ```
  Starta om containern efter andring.

- [ ] **7. (Om VPS ska na containern) -- Verifiera routing:**
  ```bash
  # Fran VPS:
  ping 10.10.10.<X>
  ```
  Om det inte fungerar: kontrollera att WireGuard AllowedIPs inkluderar 10.10.10.0/24.

- [ ] **8. Dokumentera** -- Skapa `docs/infra/machines/cmp-<namn>.md`

## Att tanka pa

- **Unprivileged containers** kan inte laddakernel-moduler (NFS, GPU)
- **Bind mounts** kraver ratt rattigheter pa Proxmox-hosten
- **Onboot: 1** om containern ska starta automatiskt vid reboot
- Alla containers far internet via NAT (MASQUERADE pa Proxmox-hosten)
