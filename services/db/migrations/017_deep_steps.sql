-- Migration 017: Deep test stegkonfiguration + tröskelvärden
-- Lägger till konfigurerbart login-flöde och tidsgränser för deep checks

-- Stegkonfiguration (JSON-array med åtgärder)
ALTER TABLE mon_sites
  ADD COLUMN IF NOT EXISTS deep_steps JSON DEFAULT NULL
    COMMENT 'Steg-för-steg-åtgärder [{action,name,selector,value}]';

-- Env-variabel-mappningar för deep check login
ALTER TABLE mon_sites
  ADD COLUMN IF NOT EXISTS deep_username_env VARCHAR(50) DEFAULT NULL
    COMMENT 'Env-var för inloggning (t.ex. BIF_ADMIN_USERNAME)';

ALTER TABLE mon_sites
  ADD COLUMN IF NOT EXISTS deep_password_env VARCHAR(50) DEFAULT NULL
    COMMENT 'Env-var för lösenord (t.ex. BIF_ADMIN_PASSWORD)';

-- Tröskelvärden
ALTER TABLE mon_sites
  ADD COLUMN IF NOT EXISTS deep_max_step_ms INT DEFAULT 10000
    COMMENT 'Max millisekunder per steg innan varning';

ALTER TABLE mon_sites
  ADD COLUMN IF NOT EXISTS deep_max_total_ms INT DEFAULT 30000
    COMMENT 'Max totala millisekunder innan varning';
