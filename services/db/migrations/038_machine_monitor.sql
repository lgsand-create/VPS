-- Migration 038: Maskinovervakning
-- Overvakar VPS, Proxmox-host och alla containers/VMs

-- Maskiner att bevaka
CREATE TABLE IF NOT EXISTS mon_machines (
  id                  VARCHAR(30) PRIMARY KEY,
  name                VARCHAR(100) NOT NULL,
  host                VARCHAR(200) NOT NULL        COMMENT 'IP eller hostname',
  description         VARCHAR(300),
  collect_method      ENUM('local','ssh') NOT NULL DEFAULT 'ssh',
  ssh_port            SMALLINT DEFAULT 22,
  ssh_user            VARCHAR(50) DEFAULT 'root',
  ssh_key_env         VARCHAR(50)                  COMMENT 'Env-variabel for SSH-nyckelfil',
  ssh_password_env    VARCHAR(50)                  COMMENT 'Env-variabel for SSH-losenord',
  check_ping          BOOLEAN DEFAULT TRUE,
  check_system        BOOLEAN DEFAULT TRUE,
  check_services      BOOLEAN DEFAULT TRUE,
  services            TEXT                         COMMENT 'Tjanster att kontrollera (JSON-array)',
  disk_paths          TEXT DEFAULT '/'             COMMENT 'Disksokvagar (JSON-array)',
  interval_minutes    SMALLINT DEFAULT 2           COMMENT 'Minuter mellan checks',
  threshold_cpu_warn  SMALLINT DEFAULT 90,
  threshold_cpu_crit  SMALLINT DEFAULT 95,
  threshold_ram_warn  SMALLINT DEFAULT 85,
  threshold_ram_crit  SMALLINT DEFAULT 95,
  threshold_disk_warn SMALLINT DEFAULT 80,
  threshold_disk_crit SMALLINT DEFAULT 90,
  status              ENUM('up','degraded','down','unknown') DEFAULT 'unknown',
  last_check_at       TIMESTAMP NULL,
  consecutive_failures INT DEFAULT 0,
  enabled             BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Check-resultat for maskiner
CREATE TABLE IF NOT EXISTS mon_machine_checks (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  machine_id      VARCHAR(30) NOT NULL,
  check_type      ENUM('ping','system','services') NOT NULL,
  status          ENUM('ok','warning','critical','error') NOT NULL,
  response_ms     INT,
  message         TEXT,
  details         JSON,
  checked_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mmc_machine_time (machine_id, checked_at),
  INDEX idx_mmc_type_time (check_type, checked_at),
  FOREIGN KEY (machine_id) REFERENCES mon_machines(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Incidenter for maskiner
CREATE TABLE IF NOT EXISTS mon_machine_incidents (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  machine_id        VARCHAR(30) NOT NULL,
  check_type        ENUM('ping','system','services') NOT NULL,
  severity          ENUM('warning','critical') NOT NULL,
  title             VARCHAR(300) NOT NULL,
  message           TEXT,
  status            ENUM('open','acknowledged','resolved') DEFAULT 'open',
  failure_count     INT DEFAULT 1,
  opened_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at   TIMESTAMP NULL,
  resolved_at       TIMESTAMP NULL,
  resolved_message  TEXT,
  alert_sent        BOOLEAN DEFAULT FALSE,
  recovery_sent     BOOLEAN DEFAULT FALSE,
  INDEX idx_mmi_machine (machine_id, status),
  INDEX idx_mmi_open (status, opened_at),
  FOREIGN KEY (machine_id) REFERENCES mon_machines(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Dagliga metrics for maskiner
CREATE TABLE IF NOT EXISTS mon_machine_daily_metrics (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  machine_id      VARCHAR(30) NOT NULL,
  date            DATE NOT NULL,
  avg_cpu_pct     DECIMAL(5,2),
  max_cpu_pct     DECIMAL(5,2),
  avg_ram_pct     DECIMAL(5,2),
  max_ram_pct     DECIMAL(5,2),
  avg_disk_pct    DECIMAL(5,2),
  max_disk_pct    DECIMAL(5,2),
  uptime_pct      DECIMAL(5,2),
  total_checks    INT DEFAULT 0,
  failed_checks   INT DEFAULT 0,
  incidents       INT DEFAULT 0,
  UNIQUE KEY uq_mmd_daily (machine_id, date),
  FOREIGN KEY (machine_id) REFERENCES mon_machines(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;
