-- Health secret direkt i databasen (istallet for bara env-variabel)
-- Gor att nyckeln kan konfigureras via dashboarden
ALTER TABLE mon_sites ADD COLUMN IF NOT EXISTS health_secret VARCHAR(500) DEFAULT NULL AFTER health_secret_env;
