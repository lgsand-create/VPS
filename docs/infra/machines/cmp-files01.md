# CT 101 -- cmp-files01

| Egenskap | Varde |
|----------|-------|
| IP | 10.10.10.101 |
| Typ | LXC, unprivileged, Debian 12 |
| Resurser | 2 cores, 1 GB RAM |
| Roll | Fillagring (3.6 TB) |
| Bind mount | /data --> /mnt/storage (fran Proxmox) |

## Installerade paket

```
# Minimal Debian 12 -- inga extra paket
# NFS-server installerades men togs bort (fungerade ej i unprivileged CT)
```

## Storage

```
/data --> /mnt/storage (fran Proxmox-hosten)
/data/videos/uploads/
/data/videos/processing/
/data/videos/results/
```

## Anteckningar

- Minimal container -- inga tjanster kor aktivt
- Bind mount ger direkt tillgang till Proxmox-hostens 3.6 TB disk
- NFS fungerar inte i unprivileged LXC (kernel-modul saknas) -- NFS kors fran Proxmox-hosten istallet
- Delar samma /mnt/storage som CT 100 (cmp-web01) via bind mount
