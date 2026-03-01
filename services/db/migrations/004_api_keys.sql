-- API-nyckelhantering: nycklar med hashad lagring + användningslogg
-- Säkerhetsprincip: Bara SHA-256 hash + prefix sparas, aldrig hela nyckeln

CREATE TABLE IF NOT EXISTS api_keys (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  label          VARCHAR(100) NOT NULL,
  key_prefix     CHAR(12) NOT NULL,
  key_hash       CHAR(64) NOT NULL,
  project_id     VARCHAR(30) NOT NULL,
  consumer_type  ENUM('web','mobile','server','other') DEFAULT 'server',
  rate_limit     INT DEFAULT 100,
  allowed_origins TEXT,
  expires_at     TIMESTAMP NULL DEFAULT NULL,
  revoked        BOOLEAN DEFAULT FALSE,
  revoked_at     TIMESTAMP NULL DEFAULT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at   TIMESTAMP NULL DEFAULT NULL,
  total_requests BIGINT DEFAULT 0,
  UNIQUE KEY uq_key_hash (key_hash),
  INDEX idx_key_prefix (key_prefix),
  INDEX idx_key_project (project_id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Användningslogg (auditlogg per API-anrop)
CREATE TABLE IF NOT EXISTS api_usage_log (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  key_id       INT NOT NULL,
  method       VARCHAR(10) NOT NULL,
  path         VARCHAR(500) NOT NULL,
  status_code  SMALLINT,
  response_ms  INT,
  ip_address   VARCHAR(45),
  user_agent   VARCHAR(500),
  logged_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_usage_key_time (key_id, logged_at),
  FOREIGN KEY (key_id) REFERENCES api_keys(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;
