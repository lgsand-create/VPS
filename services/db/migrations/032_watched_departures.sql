-- Bevakade avgångar — "jag tar den här bussen, meddela om den blir sen"
-- Kopplas till en push-prenumeration. Auto-rensas efter avgångstid.

CREATE TABLE IF NOT EXISTS vt_watched_departures (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  endpoint        VARCHAR(500) NOT NULL,
  journey_id      VARCHAR(100) NOT NULL,
  stop_id         VARCHAR(30) NOT NULL,
  line_name       VARCHAR(20),
  direction       VARCHAR(200),
  scheduled_at    DATETIME NOT NULL,
  delay_threshold INT DEFAULT 180,
  notified_at     TIMESTAMP NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_watch (endpoint(100), journey_id),
  INDEX idx_watch_journey (journey_id, stop_id),
  INDEX idx_watch_sched (scheduled_at),
  FOREIGN KEY (stop_id) REFERENCES vt_stops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;
