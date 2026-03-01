-- Migration 011: Content-check + DNS hijack-detektering
-- Ny check-typ 'content' for injektionsskanning
-- DNS baseline-IP:er for hijack-detektering

-- DNS baseline-kolumn pa mon_sites
ALTER TABLE mon_sites
  ADD COLUMN IF NOT EXISTS dns_baseline_ips TEXT DEFAULT NULL COMMENT 'Baseline A-records (kommaseparerade, sorterade)';

-- Lagg till 'content' i check_type ENUM
ALTER TABLE mon_checks
  MODIFY COLUMN check_type ENUM('http','ssl','health','deep','integrity','dns','headers','content') NOT NULL;

ALTER TABLE mon_incidents
  MODIFY COLUMN check_type ENUM('http','ssl','health','deep','integrity','dns','headers','content') NOT NULL;

-- Content-check kolumner pa mon_sites
ALTER TABLE mon_sites
  ADD COLUMN IF NOT EXISTS check_content BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS interval_content INT DEFAULT 60 COMMENT 'Minuter mellan content-checks',
  ADD COLUMN IF NOT EXISTS content_urls TEXT DEFAULT NULL COMMENT 'Extra URL:er att scanna (en per rad)',
  ADD COLUMN IF NOT EXISTS content_allowed_domains TEXT DEFAULT NULL COMMENT 'Tillatna externa domaner (en per rad)';
