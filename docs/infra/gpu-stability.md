# GPU VFIO Stabilitetsproblem — cmp-yolo01 (VM 104)

## Status: OLÖST — VM 104 får EJ startas förrän fix är verifierad

## Symptom

| Datum | Händelse | Trigger |
|-------|----------|---------|
| 2026-03-01 ~08:35 | Proxmox-hosten frös helt (hård lockup) | GPU-träning (YOLO, 12 GB VRAM, epoch 27/100) |
| 2026-03-01 ~08:55 | Proxmox-hosten frös igen vid `qm start 104` | Bara att starta VM med GPU passthrough |

## Vad vi vet

1. **Inte RAM-relaterat** — 32 GB totalt, 2.1 GB använt efter reboot, VM 104 har 8 GB
2. **Inte OOM** — ingen OOM-killer i loggar
3. **Ingen kernel panic** — loggar slutar bara tyst (= hård lockup)
4. **Audit-flood från CT 105** — tusentals apparmor DENIED per minut, fyller kernel-buffert
5. **GPU hamnar i dåligt state** — efter krasch under tung GPU-last kan GPU:n inte resetas rent av VFIO, nästa `qm start` hänger hosten

## Bidragande faktorer

### A) Apparmor audit-flood (fixat)
- CT 105 (lorawan) spammade audit-loggen med rsyslogd DENIED
- **Fix applicerad:** `sysctl kernel.printk_ratelimit=5` i `/etc/sysctl.d/99-audit-ratelimit.conf`
- CT 105 är stoppad, men fixen skyddar om den startas

### B) GPU VFIO reset-problem (EJ fixat)
- NVIDIA RTX 5060 Ti via VFIO passthrough
- Efter en krasch under tung GPU-last hamnar GPU:n i ett korrupt tillstånd
- Host-kernel försöker initiera GPU vid `qm start` → hänger sig
- **Kräver troligen full strömcykel** (inte bara reboot — dra ur ström)

## Utredning som behövs

### Steg 1: Full strömcykel
1. Stäng av Proxmox helt: `shutdown -h now`
2. Dra ur strömkabeln, vänta 30 sekunder
3. Koppla in och starta
4. Logga in — starta INTE VM 104

### Steg 2: Kolla VFIO-status
```bash
dmesg | grep -i -E "vfio|iommu|nvidia|gpu|hang|stuck|error"
lspci -nnk | grep -A3 "NVIDIA"
```

### Steg 3: Kolla IOMMU-grupper
```bash
find /sys/kernel/iommu_groups/ -type l | sort -t/ -k5 -n | grep "02:00"
```

### Steg 4: Testa starta VM utan GPU först
```bash
# Tillfälligt ta bort GPU passthrough
qm set 104 -delete hostpci0
qm start 104
# Om det funkar → problemet är GPU
```

### Steg 5: Om VM startar utan GPU — lägg tillbaka GPU
```bash
qm stop 104
qm set 104 -hostpci0 02:00,pcie=1,x-vga=1
qm start 104
```

## Möjliga lösningar

### 1. vendor-reset kernel-modul (mest troligt fixar det)
NVIDIA-kort har ofta problem med VFIO reset. `vendor-reset` modulen forcerar en ren GPU-reset.
```bash
apt install dkms pve-headers-$(uname -r)
git clone https://github.com/gnif/vendor-reset.git
cd vendor-reset
dkms install .
echo "vendor-reset" >> /etc/modules
```

### 2. GRUB-parametrar
Kontrollera att dessa finns i `/etc/default/grub`:
```
GRUB_CMDLINE_LINUX_DEFAULT="quiet intel_iommu=on iommu=pt video=efifb:off"
```
- `iommu=pt` — performance mode, minskar overhead
- `video=efifb:off` — förhindrar att host-kernel tar GPU:ns framebuffer

### 3. GPU-isolering vid boot
Lägg till i `/etc/modprobe.d/vfio.conf`:
```
options vfio-pci ids=10de:2d04,10de:22eb
softdep nvidia pre: vfio-pci
```
Verifierar att VFIO tar GPU:n INNAN nvidia-drivern försöker.

### 4. Begränsa GPU-användning i VM
I tränings-scriptet: sätt `batch=4` istället för `batch=8` och eventuellt `device='cuda:0'` med `torch.cuda.set_per_process_memory_fraction(0.8)` för att inte använda 100% VRAM.

## Checklista innan VM 104 startas igen

- [ ] Full strömcykel genomförd (inte bara reboot)
- [ ] `dmesg | grep vfio` visar inga errors
- [ ] GRUB-parametrar verifierade (iommu=pt, video=efifb:off)
- [ ] `/etc/modprobe.d/vfio.conf` kontrollerad
- [ ] Överväg vendor-reset modul
- [ ] Testa starta VM utan GPU först
- [ ] Om GPU funkar: starta träning med lägre batch (4 istället för 8)

## Träningsdata — status

Träningen nådde epoch 27/100 med mAP50 = 0.879 innan kraschen.
Checkpoints sparas av ultralytics automatiskt:
- `best.pt` — bästa modellen (sparas vid varje förbättring)
- `last.pt` — senaste epoch
- Checkpoint var 10:e epoch

Filer ligger i: `/home/jonas/yolo-worker/training/runs/football-v1/weights/`
**Dessa filer är troligen intakta** — de skrevs till NFS-lagring som hanterar disk-sync.

## Historik

Se även: `docs/infra/checklists/gpu-passthrough.md` för original GPU-setup.
