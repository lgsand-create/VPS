-- Canary/honeypot-system: per-sajt token for webhook-validering
-- Varje sajt far en unik token som honeypot-filer och JS-snippets anvander for att identifiera sig

ALTER TABLE mon_sites
  ADD COLUMN IF NOT EXISTS canary_token VARCHAR(64) DEFAULT NULL
    COMMENT 'Unik token for canary/honeypot webhooks (genereras via dashboard)';

-- Lagg till 'canary' i check_type ENUM
ALTER TABLE mon_checks
  MODIFY COLUMN check_type ENUM('http','ssl','health','deep','integrity','dns','headers','content','canary') NOT NULL;

ALTER TABLE mon_incidents
  MODIFY COLUMN check_type ENUM('http','ssl','health','deep','integrity','dns','headers','content','canary') NOT NULL;
