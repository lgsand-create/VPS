-- Västtrafik — Realtidsavgångar och förseningsstatistik
-- Tabeller för hållplatser, avgångar, daglig statistik och push-prenumerationer.

-- Bevakade hållplatser
CREATE TABLE IF NOT EXISTS vt_stops (
  id              VARCHAR(30) PRIMARY KEY,
  name            VARCHAR(200) NOT NULL,
  stop_area_gid   VARCHAR(50) NOT NULL UNIQUE,
  latitude        DECIMAL(9,6),
  longitude       DECIMAL(9,6),
  enabled         BOOLEAN DEFAULT TRUE,
  sort_order      SMALLINT DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Enskilda avgångar (snapshot per poll)
CREATE TABLE IF NOT EXISTS vt_departures (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  stop_id         VARCHAR(30) NOT NULL,
  journey_id      VARCHAR(100),
  line_name       VARCHAR(20) NOT NULL,
  line_short_name VARCHAR(10),
  direction       VARCHAR(200),
  scheduled_at    DATETIME NOT NULL,
  estimated_at    DATETIME,
  delay_seconds   INT DEFAULT 0,
  is_cancelled    BOOLEAN DEFAULT FALSE,
  is_deviation    BOOLEAN DEFAULT FALSE,
  track           VARCHAR(20),
  fg_color        VARCHAR(10),
  bg_color        VARCHAR(10),
  transport_type  VARCHAR(20),
  fetched_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vt_dep_stop_sched (stop_id, scheduled_at),
  INDEX idx_vt_dep_line_sched (line_name, scheduled_at),
  INDEX idx_vt_dep_fetched (fetched_at),
  UNIQUE KEY uq_vt_journey (journey_id, stop_id, scheduled_at),
  FOREIGN KEY (stop_id) REFERENCES vt_stops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Daglig aggregerad statistik per hållplats + linje
CREATE TABLE IF NOT EXISTS vt_daily_metrics (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  stop_id           VARCHAR(30) NOT NULL,
  line_name         VARCHAR(20) NOT NULL,
  date              DATE NOT NULL,
  total_departures  INT DEFAULT 0,
  cancelled_count   INT DEFAULT 0,
  delayed_count     INT DEFAULT 0,
  avg_delay_seconds INT DEFAULT 0,
  max_delay_seconds INT DEFAULT 0,
  on_time_pct       DECIMAL(5,2),
  UNIQUE KEY uq_vt_daily (stop_id, line_name, date),
  INDEX idx_vt_daily_date (date),
  FOREIGN KEY (stop_id) REFERENCES vt_stops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Push-prenumerationer (en per enhet/webbläsare)
CREATE TABLE IF NOT EXISTS vt_push_subscriptions (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  endpoint              VARCHAR(500) NOT NULL UNIQUE,
  p256dh                VARCHAR(200) NOT NULL,
  auth_key              VARCHAR(100) NOT NULL,
  stop_ids              JSON,
  line_filters          JSON,
  delay_threshold       INT DEFAULT 180,
  consecutive_failures  INT DEFAULT 0,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at          TIMESTAMP NULL,
  INDEX idx_vt_push_endpoint (endpoint(100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;
