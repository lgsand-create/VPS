-- Migration 006: Monitoring system
-- Uptime-kontroll, incidenthantering och metrics for alla Compuna-sajter

-- Registrera monitor-projektet
INSERT IGNORE INTO projects (id, name, description) VALUES
  ('monitor', 'Site Monitor', 'Uptime och halsobevakning av alla Compuna-sajter');

-- Bevakade sajter
CREATE TABLE IF NOT EXISTS mon_sites (
  id              VARCHAR(30) PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  url             VARCHAR(500) NOT NULL,
  health_url      VARCHAR(500),
  health_secret_env VARCHAR(50),              -- Env-variabel for health-nyckel
  ssh_host        VARCHAR(200),               -- SSH/SFTP host
  ssh_port        SMALLINT DEFAULT 22,
  ssh_user_env    VARCHAR(50),                -- Env-variabel for SSH-anvandare
  ssh_key_env     VARCHAR(50),                -- Env-variabel for SSH-nyckelfil
  ssh_method      ENUM('ssh','sftp') NULL,    -- Loopia=ssh, one.com=sftp
  webroot         VARCHAR(500),               -- Sokvag till webroot pa servern
  check_http      BOOLEAN DEFAULT TRUE,
  check_ssl       BOOLEAN DEFAULT TRUE,
  check_health    BOOLEAN DEFAULT TRUE,
  check_deep      BOOLEAN DEFAULT FALSE,
  check_integrity BOOLEAN DEFAULT FALSE,
  check_dns       BOOLEAN DEFAULT TRUE,
  status          ENUM('up','degraded','down','unknown') DEFAULT 'unknown',
  last_check_at   TIMESTAMP NULL,
  consecutive_failures INT DEFAULT 0,
  enabled         BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Individuella check-resultat
CREATE TABLE IF NOT EXISTS mon_checks (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  site_id         VARCHAR(30) NOT NULL,
  check_type      ENUM('http','ssl','health','deep','integrity','dns') NOT NULL,
  status          ENUM('ok','warning','critical','error') NOT NULL,
  response_ms     INT,
  status_code     SMALLINT,
  message         TEXT,
  details         JSON,
  checked_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mon_checks_site_time (site_id, checked_at),
  INDEX idx_mon_checks_type_time (check_type, checked_at),
  INDEX idx_mon_checks_status (status, checked_at),
  FOREIGN KEY (site_id) REFERENCES mon_sites(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Incidenter med livscykel
CREATE TABLE IF NOT EXISTS mon_incidents (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  site_id         VARCHAR(30) NOT NULL,
  check_type      ENUM('http','ssl','health','deep','integrity','dns') NOT NULL,
  severity        ENUM('warning','critical') NOT NULL,
  title           VARCHAR(300) NOT NULL,
  message         TEXT,
  status          ENUM('open','acknowledged','resolved') DEFAULT 'open',
  failure_count   INT DEFAULT 1,
  opened_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TIMESTAMP NULL,
  resolved_at     TIMESTAMP NULL,
  resolved_message TEXT,
  alert_sent      BOOLEAN DEFAULT FALSE,
  recovery_sent   BOOLEAN DEFAULT FALSE,
  INDEX idx_mon_incidents_site (site_id, status),
  INDEX idx_mon_incidents_open (status, opened_at),
  FOREIGN KEY (site_id) REFERENCES mon_sites(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Dagliga metrics (for grafer och uppetidsberakning)
CREATE TABLE IF NOT EXISTS mon_daily_metrics (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  site_id         VARCHAR(30) NOT NULL,
  date            DATE NOT NULL,
  uptime_pct      DECIMAL(5,2),
  avg_response_ms INT,
  max_response_ms INT,
  min_response_ms INT,
  total_checks    INT DEFAULT 0,
  failed_checks   INT DEFAULT 0,
  incidents       INT DEFAULT 0,
  UNIQUE KEY uq_mon_daily (site_id, date),
  FOREIGN KEY (site_id) REFERENCES mon_sites(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Filintegritets-baselines
CREATE TABLE IF NOT EXISTS mon_baselines (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  site_id         VARCHAR(30) NOT NULL,
  file_path       VARCHAR(500) NOT NULL,
  file_hash       CHAR(64) NOT NULL,
  file_size       INT,
  captured_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mon_baseline (site_id, file_path),
  FOREIGN KEY (site_id) REFERENCES mon_sites(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Larm-logg (alla skickade notifieringar)
CREATE TABLE IF NOT EXISTS mon_alerts (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  incident_id     INT,
  site_id         VARCHAR(30) NOT NULL,
  channel         ENUM('console','email','sms','webhook') NOT NULL,
  alert_type      ENUM('alert','recovery','reminder') NOT NULL,
  recipient       VARCHAR(200),
  message         TEXT,
  sent_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mon_alerts_incident (incident_id),
  FOREIGN KEY (incident_id) REFERENCES mon_incidents(id),
  FOREIGN KEY (site_id) REFERENCES mon_sites(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;
