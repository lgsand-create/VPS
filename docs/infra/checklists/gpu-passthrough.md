# Checklista: GPU Passthrough till VM

## Forutsattningar

- Proxmox VE med Intel VT-d / AMD-Vi stod
- GRUB redan konfigurerad med `intel_iommu=on iommu=pt`
- GPU: NVIDIA RTX 5060 Ti 16 GB

## Steg

- [ ] **1. Identifiera GPU:ns PCI-adress:**
  ```bash
  lspci | grep -i nvidia
  # Exempelvis: 02:00.0 VGA compatible controller: NVIDIA...
  ```

- [ ] **2. Lagg till i VM-config** (`/etc/pve/qemu-server/<ID>.conf`):
  ```
  hostpci0: 02:00,pcie=1,x-vga=1
  ```

- [ ] **3. Blacklista GPU-drivrutiner pa hosten:**
  ```bash
  echo "blacklist nouveau" >> /etc/modprobe.d/blacklist.conf
  echo "blacklist nvidia" >> /etc/modprobe.d/blacklist.conf
  update-initramfs -u
  ```

- [ ] **4. GRUB:**
  ```
  # /etc/default/grub
  GRUB_CMDLINE_LINUX_DEFAULT="quiet intel_iommu=on iommu=pt video=efifb:off"
  ```
  ```bash
  update-grub
  reboot
  ```

- [ ] **5. Starta VM och installera NVIDIA-drivare:**
  ```bash
  sudo apt install nvidia-driver-570
  sudo reboot
  nvidia-smi   # Verifiera
  ```

- [ ] **6. Installera CUDA:**
  ```bash
  # Folj NVIDIA:s instruktioner for CUDA toolkit
  nvidia-smi   # Ska visa CUDA version
  ```

## Kanda problem

| Problem | Losning |
|---------|---------|
| GPU-hang vid VM-start | `video=efifb:off` i GRUB, koppla ur monitor fran GPU |
| VM startar inte med GPU | Kontrollera IOMMU-grupper: `find /sys/kernel/iommu_groups/ -type l` |
| nvidia-smi ger fel | Kontrollera att ratt driver ar installerad, starta om VM |

## Viktigt

- VM med GPU passthrough kan **inte** live-migrera
- Satt `onboot: 0` -- manuell start rekommenderas
- Monitor ska INTE vara kopplad till GPU:n (framebuffer-konflikt)
