# cmp-prox01 -- Proxmox VE host

| Egenskap | Varde |
|----------|-------|
| LAN IP | 192.168.1.250 |
| Intern gateway | 10.10.10.1 (vmbr1) |
| Hardvara | Dell Pro Max Tower T2, Intel CPU |
| RAM | 32 GB |
| GPU | NVIDIA RTX 5060 Ti 16 GB VRAM (passthrough till VM 104) |
| OS | Proxmox VE 8.x (Debian Bookworm, PVE kernel) |
| Boot-disk | /dev/nvme0n1 (256 GB M.2 NVMe) |
| Data-disk | /dev/sda1 (Samsung 870 EVO 4 TB, ext4) -- /mnt/storage |
| Webb-GUI | https://192.168.1.250:8006 |

## Installerade paket

```
proxmox-ve              # Hypervisor
nfs-kernel-server       # NFS export till VM 104
parted                  # Diskpartitionering
```

## GRUB-konfiguration

**Fil:** `/etc/default/grub`

```
GRUB_CMDLINE_LINUX_DEFAULT="quiet intel_iommu=on iommu=pt video=efifb:off"
```

- `intel_iommu=on iommu=pt` -- GPU passthrough (VFIO)
- `video=efifb:off` -- Forhindrar att hosten tar GPU:ns framebuffer

## Natverksbryggor

**Fil:** `/etc/network/interfaces`

| Brygga | Natverk | Funktion |
|--------|---------|----------|
| vmbr0 | 192.168.1.0/24 | LAN (extern access) |
| vmbr1 | 10.10.10.0/24 | Intern (alla noder) |

## Routing

```
default         via 192.168.1.1    dev vmbr0
10.10.10.0/24   direkt             dev vmbr1
10.0.0.0/24     via 10.10.10.103   dev vmbr1    # Return-route WireGuard
```

**Permanent:** `post-up ip route add 10.0.0.0/24 via 10.10.10.103` i `/etc/network/interfaces`

## NAT

```bash
iptables -t nat -A POSTROUTING -s 10.10.10.0/24 -o vmbr0 -j MASQUERADE
```

## IP-forwarding

```
net.ipv4.ip_forward = 1
```

## NFS-export

**Fil:** `/etc/exports`

```
/mnt/storage 10.10.10.0/24(rw,sync,no_subtree_check,no_root_squash)
```

## Lagring

```
/mnt/storage/                       # 3.6 TB ext4 (/dev/sda1)
/mnt/storage/videos/uploads/        # chmod 777 (www-data write)
/mnt/storage/videos/processing/     # chmod 777
/mnt/storage/videos/results/        # chmod 777
```

**fstab:** `/dev/sda1 /mnt/storage ext4 defaults 0 2`

## Container/VM-konfigurationer

| ID | Hostname | Typ | Konfig |
|----|----------|-----|--------|
| CT 100 | cmp-web01 | LXC | `/etc/pve/lxc/100.conf` |
| CT 101 | cmp-files01 | LXC | `/etc/pve/lxc/101.conf` |
| CT 103 | cmp-vpn01 | LXC | `/etc/pve/lxc/103.conf` |
| CT 105 | cmp-lorawan01 | LXC | `/etc/pve/lxc/105.conf` |
| VM 104 | cmp-yolo01 | KVM | `/etc/pve/qemu-server/104.conf` |
| VM 200 | cmp-dev01 | KVM | `/etc/pve/qemu-server/200.conf` (on-demand) |

### CT 100 (cmp-web01)

```
hostname: cmp-web01
net0: ip=10.10.10.100/24,gw=10.10.10.1,bridge=vmbr1
mp0: /mnt/storage,mp=/data
onboot: 1, unprivileged: 1, cores: 2, memory: 1024
```

### CT 101 (cmp-files01)

```
hostname: cmp-files01
net0: ip=10.10.10.101/24,gw=10.10.10.1,bridge=vmbr1
mp0: /mnt/storage,mp=/data
onboot: 1, unprivileged: 1, cores: 2, memory: 1024
```

### CT 103 (cmp-vpn01)

```
hostname: cmp-vpn01
net0: ip=10.10.10.103/24,gw=10.10.10.1,bridge=vmbr1
```

### CT 105 (cmp-lorawan01)

```
hostname: cmp-lorawan01
net0: ip=10.10.10.105/24,gw=10.10.10.1,bridge=vmbr1
cores: 2, memory: 4096
```

### VM 104 (cmp-yolo01)

```
hostname: cmp-yolo01
net0: bridge=vmbr1
hostpci0: 02:00,pcie=1,x-vga=1    # GPU passthrough
onboot: 0                           # Manuell start (GPU-beroende)
```
