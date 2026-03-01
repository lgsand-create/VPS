-- Migration 008: Per-sajt check-intervall + security headers check
-- Möjliggör individuell intervallkonfiguration per sajt och check-typ

-- Per-sajt intervall
ALTER TABLE mon_sites
  ADD COLUMN IF NOT EXISTS interval_http      SMALLINT NOT NULL DEFAULT 1    COMMENT 'Minuter mellan HTTP-checks',
  ADD COLUMN IF NOT EXISTS interval_ssl       SMALLINT NOT NULL DEFAULT 360  COMMENT 'Minuter mellan SSL-checks',
  ADD COLUMN IF NOT EXISTS interval_health    SMALLINT NOT NULL DEFAULT 1    COMMENT 'Minuter mellan health-checks',
  ADD COLUMN IF NOT EXISTS interval_deep      SMALLINT NOT NULL DEFAULT 5    COMMENT 'Minuter mellan deep/Playwright-checks',
  ADD COLUMN IF NOT EXISTS interval_integrity SMALLINT NOT NULL DEFAULT 360  COMMENT 'Minuter mellan integritets-checks',
  ADD COLUMN IF NOT EXISTS interval_dns       SMALLINT NOT NULL DEFAULT 60   COMMENT 'Minuter mellan DNS-checks',
  ADD COLUMN IF NOT EXISTS check_headers      BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS interval_headers   SMALLINT NOT NULL DEFAULT 360  COMMENT 'Minuter mellan security headers-checks';

-- Lägg till 'headers' i check_type ENUM (inkluderar 'content' som kan finnas redan)
ALTER TABLE mon_checks
  MODIFY COLUMN check_type ENUM('http','ssl','health','deep','integrity','dns','headers','content') NOT NULL;

ALTER TABLE mon_incidents
  MODIFY COLUMN check_type ENUM('http','ssl','health','deep','integrity','dns','headers','content') NOT NULL;
