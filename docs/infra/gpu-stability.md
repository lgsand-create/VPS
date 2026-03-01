# GPU VFIO Stabilitetsproblem — cmp-yolo01 (VM 104)

## Status: DELVIS LÖST — kvarstående DMA-mappningsfel under tung CUDA-last

## Sammanfattning

RTX 5060 Ti (Blackwell) via VFIO passthrough orsakar hård host-lockup under
långvarig GPU-last (YOLO-träning). Rotorsaken är en kombination av:

1. **DMA-mappningsfel** — GPU:ns VF BARs kan inte mappas av IOMMU (`vfio_container_dma_map = -22`)
2. **Blackwell D3cold-bugg** — GPU:n kan gå in i D3cold och inte vakna (firmware-bugg)
3. **P2P DMA** — NVIDIA-drivern försöker peer-to-peer minnestransaktioner som IOMMU inte stödjer

## Symptom/Historik

| Datum | Händelse | Trigger | Epoch |
|-------|----------|---------|-------|
| 2026-03-01 ~08:35 | Host frös helt (hård lockup) | GPU-träning batch=8, ~13 GB VRAM | 27/100 |
| 2026-03-01 ~08:55 | Host frös vid `qm start 104` | Bara starta VM (GPU i dåligt state) | — |
| 2026-03-01 ~10:30 | Host frös (efter fixar round 1) | GPU-träning batch=4, 7.68 GB VRAM | 68/100 |
| 2026-03-01 ~11:40 | Host frös (efter fixar round 2) | GPU-träning batch=4, 6.64 GB VRAM | 68-69/100 |

**Mönster:** Fryser alltid runt epoch 65-70 med batch=4. Ingen kernel panic, loggar slutar tyst.

## Felmeddelande (visas vid varje VM-start)

```
QEMU: vfio_container_dma_map(0x..., 0x380000000000, 0x10000000, 0x...) = -22 (Invalid argument)
QEMU: 0000:02:00.0: PCI peer-to-peer transactions on BARs are not supported.
```

Adress `0x380000000000` = GPU:ns Virtual Function BAR. IOMMU avvisar mappningen.

## Fixar applicerade (2026-03-01)

### Host: GRUB (`/etc/default/grub`)
```
GRUB_CMDLINE_LINUX_DEFAULT="quiet intel_iommu=on iommu=pt iommu.forcedac=1 video=efifb:off pcie_aspm=off crashkernel=256M"
```
- `iommu.forcedac=1` — tvingar 64-bit DMA-adressering
- `video=efifb:off` — host rör inte GPU:ns framebuffer
- `pcie_aspm=off` — stänger av PCIe power management
- ~~`pci=realloc=off`~~ — **ORSAKADE BOOT-PROBLEM, borttagen**

### Host: `/etc/modprobe.d/vfio.conf`
```
options vfio-pci ids=10de:2d04,10de:22eb disable_idle_d3=1
softdep nvidia pre: vfio-pci
softdep nouveau pre: vfio-pci
```
- `disable_idle_d3=1` — förhindrar D3cold power state (Blackwell-buggen)

### Host: `/etc/modprobe.d/kvm.conf`
```
options kvm ignore_msrs=1
```
- Fångar ogiltiga MSR-läsningar från NVIDIA-drivern (utan detta → krasch)

### Host: `/etc/sysctl.d/99-audit-ratelimit.conf`
```
kernel.printk_ratelimit = 5
kernel.printk_ratelimit_burst = 10
```

### Host: BIOS (Dell Pro Max Tower T2 FCT2250)
- Resizable BAR: **Av** (var redan av)
- Above 4G Decoding: **På**
- VT-d: **På**

### VM 104 config (`/etc/pve/qemu-server/104.conf`)
```
balloon: 0
bios: ovmf
boot: order=scsi0
cores: 4
cpu: host
efidisk0: local-lvm:vm-104-disk-0,size=4M
hostpci0: 02:00,pcie=1,rombar=0
ide2: none,media=cdrom
machine: q35
memory: 8192
name: cmp-yolo01
net0: virtio=BC:24:11:CF:08:58,bridge=vmbr1
onboot: 0
ostype: l26
scsi0: local-lvm:vm-104-disk-1,size=70G
scsihw: virtio-scsi-pci
```
Ändringar: `balloon: 0`, `rombar=0`

### VM (guest): `/etc/modprobe.d/nvidia.conf`
```
options nvidia NVreg_DmaRemapPeerMmio=0
```

### VM (guest): GPU power limit
```bash
sudo nvidia-smi -pm 1
sudo nvidia-smi -pl 150    # Minimum för detta kort (150-180W range)
```

## Vad som hjälpte

- `ignore_msrs=1` — utan detta kraschade hosten direkt vid VM-start
- `rombar=0` + `balloon: 0` — stabilare VM-start, färre GPU-resets
- `disable_idle_d3=1` — GPU-resets lyckas nu (alla "reset done" i dmesg)
- Reboot räcker nu (behöver inte längre full strömcykel efter krasch)

## Vad som INTE hjälpte

- ~~`pci=realloc=off`~~ — förhindrade Proxmox från att boota
- ~~vendor-reset modul~~ — kompilerar inte (kernel 6.17), och stödjer bara AMD
- ~~`pcie_acs_override`~~ — irrelevant, GPU redan i egen IOMMU-grupp
- Sänkt batch (8→4) — fördröjer kraschen men förhindrar den inte
- `nvidia-smi -pl 150` — fortfarande krasch

## Kvarstående DMA-mappningsfel

Felet `vfio_container_dma_map = -22` dyker upp vid **varje** VM-start.
GPU:ns Virtual Function BARs (adress 0x380000000000) avvisas av IOMMU.
Under tung CUDA-last eskalerar detta till en hård host-lockup.

## Återstående åtgärder att testa

### PRIORITET 1: Stäng av SR-IOV i BIOS
GPU:n har Virtual Functions (VF BARs) aktiverade — dessa orsakar DMA-mappningsfelet.
- Dell BIOS → **Virtualization Support** → **SR-IOV Global Enable** → Av
- Behåll VT-d PÅ

### PRIORITET 2: GPU firmware-uppdatering (NVIDIA)
NVIDIA har släppt "GPU UEFI Firmware Update Tool v2.0" specifikt för RTX 5060 Ti.
Flera användare rapporterar att detta löser passthrough-krascher helt.
- Kräver Windows (verktyget är Windows-only)
- Alternativ: tillfällig Windows VM/USB-boot
- URL: https://nvidia.custhelp.com/app/answers/detail/a_id/5665/

### PRIORITET 3: Hugepages för VM-minne
Pinnar VM-minnet i hugepages → eliminerar DMA-fragmentering under långvarig last.
```bash
# /etc/sysctl.d/10-hugepages.conf
vm.nr_hugepages = 4096    # 8 GB / 2 MB per page
```
VM config: lägg till `hugepages: 2`

### PRIORITET 4: NVIDIA open driver 570.133.07+
Uppgradera NVIDIA-drivern i VM:en till senaste som har Blackwell-specifika fixar.

## Träningsdata — status

Bästa modellen sparad som `best.pt` (epoch 64):
- **mAP50 = 0.902**
- **mAP50-95 = 0.602**
- 4 klasser: fotbollsspelare-detektion

Filer: `/home/jonas/yolo-worker/training/runs/football-v1/weights/`
- `best.pt` — 156 MB, bästa modellen
- `last.pt` — 156 MB, epoch 68-69

**Modellen är troligen tillräckligt bra** — patience=20 och mAP50 hade plateauat runt 0.90.

## Checklista innan nästa träningsförsök

- [ ] SR-IOV avstängt i BIOS
- [ ] GPU firmware uppdaterad (om möjligt)
- [ ] `dmesg | grep vfio` — inga errors vid VM-start
- [ ] Verifiera att `vfio_container_dma_map = -22` INTE dyker upp
- [ ] Starta med kort träning först (10 epochs) innan full körning

## Historik

Se även: `docs/infra/checklists/gpu-passthrough.md` för original GPU-setup.
