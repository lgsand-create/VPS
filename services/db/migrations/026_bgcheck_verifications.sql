-- Migration 026: Verifieringslogg för bakgrundskontroll
-- Lagrar resultat per verifiering. Aldrig personnummer i klartext (bara hash).

CREATE TABLE IF NOT EXISTS bgc_verifications (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  arendenummer        VARCHAR(20) NOT NULL,
  pnr_hash            VARCHAR(16) NOT NULL,
  utfardandedatum     DATE NOT NULL,
  authentic           TINYINT(1) DEFAULT NULL,
  verification_number VARCHAR(64) DEFAULT NULL,
  warnings            TEXT DEFAULT NULL,
  response_ms         INT DEFAULT NULL,
  error_message       TEXT DEFAULT NULL,
  key_id              INT DEFAULT NULL,
  created_at          DATETIME DEFAULT NOW(),

  INDEX idx_bgc_arende (arendenummer),
  INDEX idx_bgc_created (created_at),
  INDEX idx_bgc_key (key_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;
