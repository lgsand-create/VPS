-- Migration 012: Forvantade admin-konton (borvardet for health-check)
-- Konfigurerbart per sajt via dashboarden

ALTER TABLE mon_sites
  ADD COLUMN IF NOT EXISTS health_expected_admins INT DEFAULT 0 COMMENT 'Forvantade admin-konton (0 = rapportera utan larm)';
