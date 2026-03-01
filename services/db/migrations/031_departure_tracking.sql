-- Tracking av försening per avgång över tid
-- Varje poll-cykel (1 min) loggar en rad per avgång som fortfarande finns i API-svaret.
-- Ger tidslinje: "i tid → 1 min sen → 3 min sen → avgick"

CREATE TABLE IF NOT EXISTS vt_departure_tracking (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  stop_id         VARCHAR(30) NOT NULL,
  journey_id      VARCHAR(100) NOT NULL,
  line_name       VARCHAR(20),
  direction       VARCHAR(200),
  scheduled_at    DATETIME NOT NULL,
  estimated_at    DATETIME,
  delay_seconds   INT DEFAULT 0,
  is_cancelled    TINYINT(1) DEFAULT 0,
  observed_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vt_track_journey (journey_id, stop_id),
  INDEX idx_vt_track_stop_sched (stop_id, scheduled_at),
  INDEX idx_vt_track_observed (observed_at),
  FOREIGN KEY (stop_id) REFERENCES vt_stops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;
