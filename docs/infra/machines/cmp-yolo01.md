# VM 104 -- cmp-yolo01

| Egenskap | Varde |
|----------|-------|
| IP | 10.10.10.104 |
| Typ | QEMU/KVM VM, Ubuntu (minimal) |
| GPU | NVIDIA RTX 5060 Ti 16 GB (VFIO passthrough) |
| CUDA | 12.8, Driver 570.211.01 |
| Anvandare | jonas |
| Roll | YOLO ML-worker |
| Autostart | Nej (manuell start -- GPU-beroende) |

## Installerade systempaket

```
iputils-ping            # Natverksdiagnostik
nano                    # Texteditor
net-tools               # ifconfig etc.
nfs-common              # NFS-klient
nvidia-driver-570       # NVIDIA GPU-driver
```

## Python-miljo (venv)

**Sokvag:** `/home/jonas/yolo-worker/venv/`

```
ultralytics             # YOLO v8 (yolov8m.pt + yolov8m-pose.pt)
requests                # HTTP-klient (API-anrop)
opencv-python-headless  # Bildbehandling, HSV-masking, metadata
scikit-learn            # KMeans, silhouette_score (lagklassificering)
numpy                   # Numerisk berakning
lap                     # Linear Assignment Problem (ByteTrack)
torch + torchvision     # PyTorch (CUDA backend)
```

## Netplan

**Fil:** `/etc/netplan/50-cloud-init.yaml`

```yaml
network:
  version: 2
  ethernets:
    enp6s18:
      addresses:
        - 10.10.10.104/24
      routes:
        - to: default
          via: 10.10.10.1
      nameservers:
        addresses:
          - 8.8.8.8
          - 1.1.1.1
```

## NFS-mount

**fstab:** `10.10.10.1:/mnt/storage /data nfs defaults 0 0`

Ger tillgang till samma /mnt/storage som CT 100 och CT 101.

## Systemd-tjanst: yolo-worker

**Fil:** `/etc/systemd/system/yolo-worker.service`

```ini
[Unit]
Description=YOLO Worker - Sportanalys
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=jonas
WorkingDirectory=/home/jonas/yolo-worker
ExecStart=/home/jonas/yolo-worker/venv/bin/python3 /home/jonas/yolo-worker/worker.py
Restart=always
RestartSec=10
Environment=YOLO_CONFIG_DIR=/tmp/Ultralytics

[Install]
WantedBy=multi-user.target
```

## YOLO Worker v3 pipeline

**Fil:** `/home/jonas/yolo-worker/worker.py`

```
API_BASE = http://10.10.10.100/api
API_KEY  = cmp-api-2026-backatorp
POLL_INTERVAL = 10 sek

Pass 1: Detection + tracking   (yolov8m @ 1280px, ByteTrack)
Pass 2: Pose estimation         (yolov8m-pose, 17 keypoints)
Pass 3: Trojfarg + lag          (HSV-masking, K-means, silhouette)
Pass 4: Hastighet + boll        (px/s, interpolation, nearest player)
```

## Output per jobb

```
/data/videos/results/job_{id}/
  tracking.json    # Frames x detektioner, boll, pose, hastighet
  stats.json       # Per-spelare: distans, max speed, sprint count
  players.json     # track_id --> lag, farg (hex), hastighetssammanfattning
```

## Video-metadata (i tracking.json summary)

```json
{
  "fps": 30.0,
  "video_width": 1652,
  "video_height": 1034,
  "coordinate_system": "pixels"
}
```

## Prestanda

```
Full v3-pipeline: ~15 FPS -- 90 min match ~ 4 timmar
Utan pose:        ~25 FPS -- 90 min match ~ 2 timmar
```

## Vanliga kommandon

```bash
sudo systemctl status yolo-worker     # Status
sudo systemctl restart yolo-worker    # Starta om
sudo journalctl -u yolo-worker -f     # Folj loggar
nvidia-smi                            # GPU-status
```
