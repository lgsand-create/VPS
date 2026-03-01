-- Migration 009: Direktvärden för SSH (istället för bara env-variabelnamn)
-- Möjliggör att fylla i SSH-user och nyckelsökväg direkt i dashboarden.
-- Env-variablerna behålls som fallback.

ALTER TABLE mon_sites
  ADD COLUMN IF NOT EXISTS ssh_user     VARCHAR(100) DEFAULT NULL COMMENT 'SSH-användarnamn (direkt, eller via ssh_user_env)',
  ADD COLUMN IF NOT EXISTS ssh_key_path VARCHAR(500) DEFAULT NULL COMMENT 'Sökväg till privat SSH-nyckel (direkt, eller via ssh_key_env)';
